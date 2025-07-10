import mongoose from "mongoose";

/**
 * CashuWallet Schema
 *
 * Represents a Cashu ecash wallet for a specific user (npub).
 * Each user has one wallet per mint URL.
 *
 * @typedef {Object} CashuWallet
 * @property {string} npub - User's Nostr public key (bech32 encoded)
 * @property {string} mint_url - URL of the Cashu mint
 * @property {string} p2pk_pubkey - Public key for P2PK transactions
 * @property {string} p2pk_privkey - Encrypted private key for P2PK transactions
 * @property {Object} wallet_config - Wallet configuration options
 * @property {string} wallet_config.unit - Currency unit (default: 'sat')
 * @property {string} wallet_config.created_via - Creation method ('api' or 'nostr')
 * @property {Date} created_at - Wallet creation timestamp
 * @property {Date} updated_at - Last update timestamp
 */
const CashuWalletSchema = new mongoose.Schema(
  {
    npub: {
      type: String,
      required: [true, "NPUB is required for Cashu wallet"],
      trim: true,
      validate: {
        validator: function (v) {
          return /^npub1[a-z0-9]{58,63}$/.test(v);
        },
        message: "Invalid NPUB format",
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
    p2pk_pubkey: {
      type: String,
      required: [true, "P2PK public key is required"],
      trim: true,
      validate: {
        validator: function (v) {
          return /^[0-9a-fA-F]{64,66}$/.test(v);
        },
        message: "Invalid P2PK public key format",
      },
    },
    p2pk_privkey: {
      type: String,
      required: [true, "P2PK private key is required"],
      trim: true,
      // Note: This should be encrypted before storage in production
    },
    wallet_config: {
      unit: {
        type: String,
        default: "sat",
        enum: ["sat", "msat"],
        required: true,
      },
      created_via: {
        type: String,
        enum: ["api", "nostr"],
        default: "api",
        required: true,
      },
    },
  },
  {
    timestamps: true,
    collection: "cashu_wallets",
  }
);

// Compound index for npub + mint_url (unique wallet per user per mint)
CashuWalletSchema.index({ npub: 1, mint_url: 1 }, { unique: true });

// Individual field indexes removed to avoid duplicates with compound index
// The compound index { npub: 1, mint_url: 1 } above provides efficient lookups for both fields

/**
 * Instance method to get wallet identifier
 * @returns {string} Formatted wallet identifier
 */
CashuWalletSchema.methods.getWalletId = function () {
  return `${this.npub}:${this.mint_url}`;
};

/**
 * Static method to find wallet by npub and mint URL
 * @param {string} npub - User's NPUB
 * @param {string} mintUrl - Mint URL
 * @returns {Promise<CashuWallet|null>} Wallet document or null
 */
CashuWalletSchema.statics.findByNpubAndMint = function (npub, mintUrl) {
  return this.findOne({ npub, mint_url: mintUrl });
};

/**
 * Static method to find all wallets for a user
 * @param {string} npub - User's NPUB
 * @returns {Promise<CashuWallet[]>} Array of wallet documents
 */
CashuWalletSchema.statics.findByNpub = function (npub) {
  return this.find({ npub }).sort({ created_at: -1 });
};

const CashuWallet = mongoose.model("CashuWallet", CashuWalletSchema);
export default CashuWallet;
