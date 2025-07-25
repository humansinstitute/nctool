import mongoose from "mongoose";

/**
 * CashuToken Schema
 *
 * Represents Cashu tokens (proofs) stored for a user's wallet.
 * Each document contains one or more proofs from a single transaction.
 *
 * @typedef {Object} CashuToken
 * @property {string} npub - User's Nostr public key (bech32 encoded)
 * @property {ObjectId} wallet_id - Reference to CashuWallet document
 * @property {Array} proofs - Array of Cashu proof objects
 * @property {string} mint_url - URL of the Cashu mint that issued these proofs
 * @property {number} total_amount - Total value of all proofs in this document
 * @property {string} status - Current status of the proofs
 * @property {string} transaction_type - Type of transaction that created these proofs
 * @property {string} transaction_id - Unique identifier for the transaction
 * @property {Object} metadata - Additional transaction metadata
 * @property {Date} created_at - Token creation timestamp
 * @property {Date} spent_at - When the token was spent (if applicable)
 */
const CashuTokenSchema = new mongoose.Schema(
  {
    npub: {
      type: String,
      required: [true, "NPUB is required for Cashu token"],
      trim: true,
      validate: {
        validator: function (v) {
          return /^npub1[a-z0-9]{58,63}$/.test(v);
        },
        message: "Invalid NPUB format",
      },
    },
    wallet_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CashuWallet",
      required: [true, "Wallet ID is required"],
    },
    proofs: {
      type: [
        {
          id: {
            type: String,
            required: true,
          },
          amount: {
            type: Number,
            required: true,
            min: [1, "Proof amount must be positive"],
          },
          secret: {
            type: String,
            required: true,
          },
          C: {
            type: String,
            required: true,
          },
          // Optional fields for different proof types
          witness: {
            type: String,
          },
          dleq: {
            type: mongoose.Schema.Types.Mixed,
          },
        },
      ],
      required: [true, "Proofs array is required"],
      validate: {
        validator: function (v) {
          // Allow empty proofs array for pending transactions
          if (this.status === "pending") {
            return Array.isArray(v);
          }
          return Array.isArray(v) && v.length > 0;
        },
        message:
          "Proofs array must contain at least one proof (unless status is pending)",
      },
    },
    mint_url: {
      type: String,
      required: [true, "Mint URL is required"],
      trim: true,
      validate: {
        validator: function (v) {
          try {
            new URL(v);
            return true;
          } catch {
            return false;
          }
        },
        message: "Invalid mint URL format",
      },
    },
    total_amount: {
      type: Number,
      min: [0, "Total amount cannot be negative"],
      validate: {
        validator: function (v) {
          // Skip validation if total_amount is not set (will be calculated in pre-save)
          if (v === undefined || v === null) return true;

          // For pending transactions, allow 0 total_amount with empty proofs
          if (this.status === "pending" && this.proofs.length === 0) {
            return v === 0;
          }

          // Validate that total_amount matches sum of proof amounts
          const calculatedTotal = this.proofs.reduce(
            (sum, proof) => sum + proof.amount,
            0
          );
          return v === calculatedTotal;
        },
        message: "Total amount must match sum of proof amounts",
      },
    },
    status: {
      type: String,
      enum: ["unspent", "spent", "pending", "failed"],
      default: "unspent",
      required: true,
    },
    transaction_type: {
      type: String,
      enum: ["received", "sent", "minted", "melted", "change"],
      required: [true, "Transaction type is required"],
    },
    transaction_id: {
      type: String,
      required: [true, "Transaction ID is required"],
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      validate: {
        validator: function (v) {
          // Ensure metadata is an object and has required source field
          return v && typeof v === "object" && v.source;
        },
        message: "Metadata must be an object with a source field",
      },
    },
    spent_at: {
      type: Date,
      default: null,
      // Set when status changes to 'spent'
    },
  },
  {
    timestamps: true,
    collection: "cashu_tokens",
  }
);

// Compound indexes for efficient queries
CashuTokenSchema.index({ npub: 1, status: 1 });
CashuTokenSchema.index({ npub: 1, transaction_type: 1 });
CashuTokenSchema.index({ npub: 1, created_at: -1 });
CashuTokenSchema.index({ wallet_id: 1, status: 1 });
CashuTokenSchema.index({ transaction_id: 1 }, { unique: true });
CashuTokenSchema.index({ mint_url: 1, status: 1 });

// Index for proof secret lookups (for double-spend prevention)
CashuTokenSchema.index({ "proofs.secret": 1 });

/**
 * Pre-save middleware to calculate total_amount, validate status-dependent rules, and set spent_at
 */
CashuTokenSchema.pre("save", function (next) {
  // Calculate total amount from proofs
  if (this.proofs && this.proofs.length > 0) {
    this.total_amount = this.proofs.reduce(
      (sum, proof) => sum + proof.amount,
      0
    );
  } else if (this.status === "pending") {
    // Set total_amount to 0 for pending transactions with no proofs
    this.total_amount = 0;
  }

  // Status-dependent validation for total_amount
  if (
    this.status !== "pending" &&
    this.status !== "failed" &&
    this.total_amount <= 0
  ) {
    return next(
      new Error(
        "Total amount must be positive for non-pending, non-failed transactions"
      )
    );
  }

  // Set spent_at timestamp when status changes to spent
  if (this.status === "spent" && !this.spent_at) {
    this.spent_at = new Date();
  }

  next();
});

/**
 * Pre-update middleware to handle validation during findByIdAndUpdate operations
 */
CashuTokenSchema.pre(
  ["findOneAndUpdate", "updateOne", "updateMany"],
  function (next) {
    const update = this.getUpdate();

    // If status is being updated to non-pending, non-failed and total_amount is 0 or negative, prevent the update
    if (
      update.$set &&
      update.$set.status &&
      update.$set.status !== "pending" &&
      update.$set.status !== "failed"
    ) {
      if (
        update.$set.total_amount !== undefined &&
        update.$set.total_amount <= 0
      ) {
        return next(
          new Error(
            "Total amount must be positive for non-pending, non-failed transactions"
          )
        );
      }
    }

    // Set spent_at timestamp when status changes to spent
    if (
      update.$set &&
      update.$set.status === "spent" &&
      !update.$set.spent_at
    ) {
      update.$set.spent_at = new Date();
    }

    next();
  }
);

/**
 * Instance method to mark token as spent
 * @returns {Promise<CashuToken>} Updated token document
 */
CashuTokenSchema.methods.markAsSpent = function () {
  this.status = "spent";
  this.spent_at = new Date();
  return this.save();
};

/**
 * Instance method to get proof secrets
 * @returns {string[]} Array of proof secrets
 */
CashuTokenSchema.methods.getSecrets = function () {
  return this.proofs.map((proof) => proof.secret);
};

/**
 * Static method to find unspent tokens for a user
 * @param {string} npub - User's NPUB
 * @param {string} [mintUrl] - Optional mint URL filter
 * @returns {Promise<CashuToken[]>} Array of unspent token documents
 */
CashuTokenSchema.statics.findUnspentByNpub = function (npub, mintUrl = null) {
  const query = { npub, status: "unspent" };
  if (mintUrl) {
    query.mint_url = mintUrl;
  }
  return this.find(query).sort({ created_at: -1 });
};

/**
 * Static method to find tokens by transaction ID
 * @param {string} transactionId - Transaction ID
 * @returns {Promise<CashuToken[]>} Array of token documents
 */
CashuTokenSchema.statics.findByTransactionId = function (transactionId) {
  return this.find({ transaction_id: transactionId }).sort({ created_at: -1 });
};

/**
 * Static method to calculate total balance for a user
 * @param {string} npub - User's NPUB
 * @param {string} [status='unspent'] - Token status to include
 * @param {string} [mintUrl] - Optional mint URL filter
 * @returns {Promise<number>} Total balance
 */
CashuTokenSchema.statics.calculateBalance = async function (
  npub,
  status = "unspent",
  mintUrl = null
) {
  const query = { npub };
  if (status) {
    query.status = status;
  }
  if (mintUrl) {
    query.mint_url = mintUrl;
  }

  console.log(`[CashuToken.calculateBalance] Starting calculation:`, {
    npub,
    status,
    mintUrl,
    query,
    timestamp: new Date().toISOString(),
  });

  const pipeline = [
    { $match: query },
    {
      $match: {
        $or: [
          // Include all non-pending transactions
          { status: { $ne: "pending" } },
          // Include pending transactions only if they have proofs (non-empty array)
          {
            status: "pending",
            proofs: { $exists: true, $not: { $size: 0 } },
          },
        ],
      },
    },
    { $group: { _id: null, total: { $sum: "$total_amount" } } },
  ];

  console.log(`[CashuToken.calculateBalance] Aggregation pipeline:`, {
    npub,
    status,
    pipeline: JSON.stringify(pipeline),
    timestamp: new Date().toISOString(),
  });

  const result = await this.aggregate(pipeline);
  const balance = result.length > 0 ? result[0].total : 0;

  console.log(`[CashuToken.calculateBalance] Result:`, {
    npub,
    status,
    mintUrl,
    balance,
    resultCount: result.length,
    timestamp: new Date().toISOString(),
  });

  return balance;
};

/**
 * Static method to find tokens by proof secrets (for double-spend checking)
 * @param {string[]} secrets - Array of proof secrets
 * @returns {Promise<CashuToken[]>} Array of token documents containing these secrets
 */
CashuTokenSchema.statics.findBySecrets = function (secrets) {
  return this.find({ "proofs.secret": { $in: secrets } });
};

const CashuToken = mongoose.model("CashuToken", CashuTokenSchema);
export default CashuToken;
