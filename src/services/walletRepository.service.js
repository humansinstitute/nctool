import CashuWallet from "../models/CashuWallet.model.js";
import CashuToken from "../models/CashuToken.model.js";
import mongoose from "mongoose";

/**
 * Wallet Repository Service
 *
 * Provides data access layer for Cashu wallet operations.
 * Handles CRUD operations for wallets and tokens, balance calculations,
 * transaction history, and proof state management.
 */
class WalletRepositoryService {
  // ==================== WALLET OPERATIONS ====================

  /**
   * Create a new Cashu wallet
   * @param {Object} walletData - Wallet creation data
   * @param {string} walletData.npub - User's NPUB
   * @param {string} walletData.mint_url - Mint URL
   * @param {string} walletData.p2pk_pubkey - P2PK public key
   * @param {string} walletData.p2pk_privkey - P2PK private key (should be encrypted)
   * @param {Object} [walletData.wallet_config] - Wallet configuration
   * @returns {Promise<CashuWallet>} Created wallet document
   * @throws {Error} If wallet creation fails or wallet already exists
   */
  async createWallet(walletData) {
    try {
      // Check if wallet already exists for this npub and mint
      const existingWallet = await CashuWallet.findByNpubAndMint(
        walletData.npub,
        walletData.mint_url
      );

      if (existingWallet) {
        throw new Error(
          `Wallet already exists for npub ${walletData.npub} and mint ${walletData.mint_url}`
        );
      }

      const wallet = new CashuWallet(walletData);
      return await wallet.save();
    } catch (error) {
      throw new Error(`Failed to create wallet: ${error.message}`);
    }
  }

  /**
   * Find wallet by npub and mint URL
   * @param {string} npub - User's NPUB
   * @param {string} mintUrl - Mint URL
   * @returns {Promise<CashuWallet|null>} Wallet document or null
   */
  async findWallet(npub, mintUrl) {
    try {
      return await CashuWallet.findByNpubAndMint(npub, mintUrl);
    } catch (error) {
      throw new Error(`Failed to find wallet: ${error.message}`);
    }
  }

  /**
   * Find all wallets for a user
   * @param {string} npub - User's NPUB
   * @returns {Promise<CashuWallet[]>} Array of wallet documents
   */
  async findWalletsByNpub(npub) {
    try {
      return await CashuWallet.findByNpub(npub);
    } catch (error) {
      throw new Error(`Failed to find wallets for npub: ${error.message}`);
    }
  }

  /**
   * Update wallet configuration
   * @param {string} npub - User's NPUB
   * @param {string} mintUrl - Mint URL
   * @param {Object} updates - Fields to update
   * @returns {Promise<CashuWallet|null>} Updated wallet document
   */
  async updateWallet(npub, mintUrl, updates) {
    try {
      return await CashuWallet.findOneAndUpdate(
        { npub, mint_url: mintUrl },
        { $set: updates },
        { new: true, runValidators: true }
      );
    } catch (error) {
      throw new Error(`Failed to update wallet: ${error.message}`);
    }
  }

  // ==================== TOKEN OPERATIONS ====================

  /**
   * Store new tokens in the database with optional session support for atomic operations
   * @param {Object} tokenData - Token storage data
   * @param {string} tokenData.npub - User's NPUB
   * @param {string} tokenData.wallet_id - Wallet ID
   * @param {Array} tokenData.proofs - Array of proof objects
   * @param {string} tokenData.mint_url - Mint URL
   * @param {string} tokenData.transaction_type - Transaction type
   * @param {string} tokenData.transaction_id - Transaction ID
   * @param {Object} [tokenData.metadata] - Additional metadata
   * @param {Object} [options] - Additional options
   * @param {mongoose.ClientSession} [options.session] - MongoDB session for atomic operations
   * @returns {Promise<CashuToken>} Created token document
   */
  async storeTokens(tokenData, options = {}) {
    try {
      const { session } = options;

      // ADD DEBUG LOG:
      console.log(
        `[storeTokens] Called with transaction_type: ${
          tokenData.transaction_type
        }, proofs: ${tokenData.proofs?.length}, hasSession: ${!!session}`
      );

      // Validate that proofs don't already exist (double-spend prevention)
      // Skip this check for "melted" and "change" transactions since they reference already-spent proofs
      if (
        tokenData.transaction_type !== "melted" &&
        tokenData.transaction_type !== "change"
      ) {
        const secrets = tokenData.proofs.map((proof) => proof.secret);
        const findOptions = session ? { session } : {};
        const existingTokens = await CashuToken.findBySecrets(
          secrets,
          findOptions
        );

        if (existingTokens.length > 0) {
          throw new Error(
            "Some proofs already exist in database (potential double-spend)"
          );
        }
      }

      const token = new CashuToken(tokenData);
      const saveOptions = session ? { session } : {};
      return await token.save(saveOptions);
    } catch (error) {
      throw new Error(`Failed to store tokens: ${error.message}`);
    }
  }

  /**
   * Find unspent tokens for a user
   * @param {string} npub - User's NPUB
   * @param {string} [mintUrl] - Optional mint URL filter
   * @returns {Promise<CashuToken[]>} Array of unspent token documents
   */
  async findUnspentTokens(npub, mintUrl = null) {
    try {
      return await CashuToken.findUnspentByNpub(npub, mintUrl);
    } catch (error) {
      throw new Error(`Failed to find unspent tokens: ${error.message}`);
    }
  }

  /**
   * Mark tokens as spent with optional session support for atomic operations
   * @param {string[]} tokenIds - Array of token document IDs
   * @param {Object} [options] - Additional options
   * @param {mongoose.ClientSession} [options.session] - MongoDB session for atomic operations
   * @returns {Promise<number>} Number of tokens updated
   */
  async markTokensAsSpent(tokenIds, options = {}) {
    try {
      const { session } = options;
      const updateOptions = session ? { session } : {};

      const result = await CashuToken.updateMany(
        { _id: { $in: tokenIds } },
        {
          $set: {
            status: "spent",
            spent_at: new Date(),
          },
        },
        updateOptions
      );
      return result.modifiedCount;
    } catch (error) {
      throw new Error(`Failed to mark tokens as spent: ${error.message}`);
    }
  }

  /**
   * Execute atomic melt operation with full rollback support
   * @param {Object} meltData - Melt operation data
   * @param {string} meltData.npub - User's NPUB
   * @param {string} meltData.walletId - Wallet ID
   * @param {Array} meltData.tokenIds - Token IDs to mark as spent
   * @param {Array} meltData.sendProofs - Proofs used for melting
   * @param {Array} meltData.keepProofs - Change proofs from send operation
   * @param {Array} meltData.meltChangeProofs - Change proofs from melt operation
   * @param {string} meltData.transactionId - Transaction ID
   * @param {Object} meltData.meltQuote - Melt quote information
   * @param {string} meltData.mintUrl - Mint URL
   * @returns {Promise<Object>} Atomic operation result
   */
  async executeAtomicMelt(meltData) {
    const session = await mongoose.startSession();

    try {
      let result;

      await session.withTransaction(async () => {
        const {
          npub,
          walletId,
          tokenIds,
          sendProofs,
          keepProofs,
          meltChangeProofs,
          transactionId,
          meltQuote,
          mintUrl,
        } = meltData;

        // Step 1: Mark original tokens as spent
        const spentCount = await this.markTokensAsSpent(tokenIds, { session });

        if (spentCount !== tokenIds.length) {
          throw new Error(
            `Expected to mark ${tokenIds.length} tokens as spent, but only marked ${spentCount}`
          );
        }

        // Step 2: Store melted tokens record for transaction history
        const meltedTokenDoc = await this.storeTokens(
          {
            npub,
            wallet_id: walletId,
            proofs: sendProofs,
            mint_url: mintUrl,
            transaction_type: "melted",
            transaction_id: transactionId,
            metadata: {
              source: "lightning",
              quote_id: meltQuote.quote,
              invoice_amount: meltQuote.amount,
              fee_reserve: meltQuote.fee_reserve,
              total_amount: meltQuote.amount + meltQuote.fee_reserve,
            },
          },
          { session }
        );

        // Step 3: Store change tokens from send operation if any
        let sendChangeTokenDoc = null;
        if (keepProofs.length > 0) {
          sendChangeTokenDoc = await this.storeTokens(
            {
              npub,
              wallet_id: walletId,
              proofs: keepProofs,
              mint_url: mintUrl,
              transaction_type: "change",
              transaction_id: transactionId,
              metadata: {
                source: "change",
                change_from_selection: true,
                melt_transaction_id: transactionId,
              },
            },
            { session }
          );
        }

        // Step 4: Store change tokens from melt operation if any
        let meltChangeTokenDoc = null;
        if (meltChangeProofs && meltChangeProofs.length > 0) {
          meltChangeTokenDoc = await this.storeTokens(
            {
              npub,
              wallet_id: walletId,
              proofs: meltChangeProofs,
              mint_url: mintUrl,
              transaction_type: "change",
              transaction_id: transactionId,
              metadata: {
                source: "change",
                change_from_melt: true,
                quote_id: meltQuote.quote,
              },
            },
            { session }
          );
        }

        result = {
          transactionId,
          meltedTokenId: meltedTokenDoc._id,
          sendChangeTokenId: sendChangeTokenDoc?._id || null,
          meltChangeTokenId: meltChangeTokenDoc?._id || null,
          spentTokensCount: spentCount,
          keepProofsCount: keepProofs.length,
          meltChangeProofsCount: meltChangeProofs?.length || 0,
        };
      });

      return result;
    } catch (error) {
      // Transaction will be automatically aborted on error
      throw new Error(`Atomic melt operation failed: ${error.message}`);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Update token status
   * @param {string} tokenId - Token document ID
   * @param {string} newStatus - New status to set
   * @returns {Promise<CashuToken>} Updated token document
   */
  async updateTokenStatus(tokenId, newStatus) {
    try {
      const validStatuses = ["unspent", "spent", "pending", "failed"];
      if (!validStatuses.includes(newStatus)) {
        throw new Error(
          `Invalid status: ${newStatus}. Must be one of: ${validStatuses.join(
            ", "
          )}`
        );
      }

      const updateData = { status: newStatus };

      // Add timestamp for spent status
      if (newStatus === "spent") {
        updateData.spent_at = new Date();
      }

      // Clear spent_at for non-spent statuses
      if (newStatus !== "spent") {
        updateData.$unset = { spent_at: 1 };
      }

      const updatedToken = await CashuToken.findByIdAndUpdate(
        tokenId,
        updateData,
        { new: true, runValidators: true }
      );

      if (!updatedToken) {
        throw new Error(`Token with ID ${tokenId} not found`);
      }

      return updatedToken;
    } catch (error) {
      throw new Error(`Failed to update token status: ${error.message}`);
    }
  }

  /**
   * Find tokens by transaction ID
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<CashuToken[]>} Array of token documents
   */
  async findTokensByTransactionId(transactionId) {
    try {
      return await CashuToken.findByTransactionId(transactionId);
    } catch (error) {
      throw new Error(
        `Failed to find tokens by transaction ID: ${error.message}`
      );
    }
  }

  /**
   * Update a pending transaction with completed data
   * @param {string} tokenId - Token document ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<CashuToken>} Updated token document
   */
  async updatePendingTransaction(tokenId, updates) {
    try {
      // First, find the token to ensure it exists and get current state
      const token = await CashuToken.findById(tokenId);

      if (!token) {
        const error = new Error(`Token with ID ${tokenId} not found`);
        console.error(`[updatePendingTransaction] Token not found:`, {
          tokenId,
          timestamp: new Date().toISOString(),
        });
        throw error;
      }

      // Log the current state and intended updates for debugging
      console.log(`[updatePendingTransaction] Updating token:`, {
        tokenId,
        currentStatus: token.status,
        currentTotalAmount: token.total_amount,
        proofsCount: token.proofs?.length || 0,
        updates,
        timestamp: new Date().toISOString(),
      });

      // Validate status transitions
      if (
        updates.status &&
        token.status !== "pending" &&
        updates.status !== token.status
      ) {
        const error = new Error(
          `Invalid status transition from '${token.status}' to '${updates.status}'. Only pending transactions can be updated.`
        );
        console.error(`[updatePendingTransaction] Invalid status transition:`, {
          tokenId,
          currentStatus: token.status,
          requestedStatus: updates.status,
          timestamp: new Date().toISOString(),
        });
        throw error;
      }

      // Apply updates to the document
      Object.keys(updates).forEach((key) => {
        token[key] = updates[key];
      });

      // Save the document to trigger all validation and pre-save hooks
      const savedToken = await token.save();

      // Log successful update
      console.log(`[updatePendingTransaction] Successfully updated token:`, {
        tokenId,
        newStatus: savedToken.status,
        newTotalAmount: savedToken.total_amount,
        proofsCount: savedToken.proofs?.length || 0,
        timestamp: new Date().toISOString(),
      });

      return savedToken;
    } catch (error) {
      // Enhanced error logging with context
      console.error(`[updatePendingTransaction] Failed to update token:`, {
        tokenId,
        updates,
        errorMessage: error.message,
        errorName: error.name,
        validationErrors: error.errors ? Object.keys(error.errors) : null,
        timestamp: new Date().toISOString(),
      });

      // Provide more specific error messages based on error type
      if (error.name === "ValidationError") {
        const validationDetails = Object.values(error.errors)
          .map((err) => err.message)
          .join(", ");
        throw new Error(
          `Validation failed for pending transaction update: ${validationDetails}`
        );
      }

      if (error.name === "CastError") {
        throw new Error(
          `Invalid data type in update for token ${tokenId}: ${error.message}`
        );
      }

      // Re-throw our custom errors as-is
      if (
        error.message.includes("Token with ID") ||
        error.message.includes("Invalid status transition")
      ) {
        throw error;
      }

      // Generic error with context
      throw new Error(
        `Failed to update pending transaction ${tokenId}: ${error.message}`
      );
    }
  }

  /**
   * Check if proof secrets exist in database
   * @param {string[]} secrets - Array of proof secrets
   * @returns {Promise<Object>} Object with secret -> token mapping
   */
  async checkProofSecrets(secrets) {
    try {
      const tokens = await CashuToken.findBySecrets(secrets);
      const secretMap = {};

      tokens.forEach((token) => {
        token.proofs.forEach((proof) => {
          if (secrets.includes(proof.secret)) {
            secretMap[proof.secret] = {
              token_id: token._id,
              status: token.status,
              spent_at: token.spent_at,
            };
          }
        });
      });

      return secretMap;
    } catch (error) {
      throw new Error(`Failed to check proof secrets: ${error.message}`);
    }
  }

  // ==================== BALANCE CALCULATIONS ====================

  /**
   * Calculate total balance for a user
   * @param {string} npub - User's NPUB
   * @param {string} [mintUrl] - Optional mint URL filter
   * @returns {Promise<Object>} Balance breakdown
   */
  async calculateBalance(npub, mintUrl = null) {
    try {
      console.log(
        `[calculateBalance] Starting balance calculation for npub: ${npub}, mintUrl: ${mintUrl}`
      );

      const [unspentBalance, pendingBalance, spentBalance] = await Promise.all([
        CashuToken.calculateBalance(npub, "unspent", mintUrl),
        CashuToken.calculateBalance(npub, "pending", mintUrl),
        CashuToken.calculateBalance(npub, "spent", mintUrl),
      ]);

      // Calculate total balance as sum of unspent and pending (excluding empty pending transactions)
      // Spent balance represents tokens that have been used and should not contribute to available balance
      const totalBalance = unspentBalance + pendingBalance;

      console.log(`[calculateBalance] Balance breakdown:`, {
        npub,
        mintUrl,
        unspent_balance: unspentBalance,
        pending_balance: pendingBalance,
        spent_balance: spentBalance,
        total_balance: totalBalance,
        timestamp: new Date().toISOString(),
      });

      // Validate that balances are not negative
      if (unspentBalance < 0 || pendingBalance < 0 || spentBalance < 0) {
        console.error(`[calculateBalance] Negative balance detected:`, {
          npub,
          mintUrl,
          unspent_balance: unspentBalance,
          pending_balance: pendingBalance,
          spent_balance: spentBalance,
          timestamp: new Date().toISOString(),
        });
      }

      return {
        total_balance: Math.max(0, totalBalance), // Ensure non-negative
        unspent_balance: Math.max(0, unspentBalance),
        pending_balance: Math.max(0, pendingBalance),
        spent_balance: Math.max(0, spentBalance),
      };
    } catch (error) {
      console.error(`[calculateBalance] Failed to calculate balance:`, {
        npub,
        mintUrl,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      throw new Error(`Failed to calculate balance: ${error.message}`);
    }
  }

  /**
   * Get detailed balance information including token count
   * @param {string} npub - User's NPUB
   * @param {string} [mintUrl] - Optional mint URL filter
   * @returns {Promise<Object>} Detailed balance information
   */
  async getDetailedBalance(npub, mintUrl = null) {
    try {
      const balance = await this.calculateBalance(npub, mintUrl);

      // Count tokens by status
      const query = { npub };
      if (mintUrl) query.mint_url = mintUrl;

      const tokenCounts = await CashuToken.aggregate([
        { $match: query },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]);

      const counts = {
        unspent: 0,
        pending: 0,
        spent: 0,
      };

      tokenCounts.forEach((item) => {
        counts[item._id] = item.count;
      });

      return {
        ...balance,
        token_counts: counts,
        total_tokens: counts.unspent + counts.pending + counts.spent,
      };
    } catch (error) {
      throw new Error(`Failed to get detailed balance: ${error.message}`);
    }
  }

  // ==================== TRANSACTION HISTORY ====================

  /**
   * Get transaction history for a user
   * @param {string} npub - User's NPUB
   * @param {Object} [options] - Query options
   * @param {number} [options.limit=50] - Maximum number of transactions
   * @param {number} [options.skip=0] - Number of transactions to skip
   * @param {string} [options.transaction_type] - Filter by transaction type
   * @param {string} [options.mint_url] - Filter by mint URL
   * @returns {Promise<Object>} Transaction history with pagination info
   */
  async getTransactionHistory(npub, options = {}) {
    try {
      const { limit = 50, skip = 0, transaction_type, mint_url } = options;

      const query = { npub };
      if (transaction_type) query.transaction_type = transaction_type;
      if (mint_url) query.mint_url = mint_url;

      // Enhanced query to filter out invalid records at database level
      const enhancedQuery = {
        ...query,
        // Ensure required fields exist and are not null/undefined
        transaction_id: { $exists: true, $ne: null, $ne: "" },
        transaction_type: { $exists: true, $ne: null },
        status: { $exists: true, $ne: null },
        mint_url: { $exists: true, $ne: null, $ne: "" },
        total_amount: { $exists: true, $ne: null, $gte: 0 },
        "metadata.source": { $exists: true, $ne: null },
        // Filter out corrupted pending transactions
        $or: [
          // Non-pending transactions must have positive total_amount
          {
            status: { $ne: "pending" },
            total_amount: { $gt: 0 },
          },
          // Pending transactions can have 0 total_amount and must have either quote_id or be properly structured
          {
            status: "pending",
            total_amount: { $gte: 0 },
            $or: [
              { "metadata.quote_id": { $exists: true, $ne: null } },
              { "metadata.pending_amount": { $exists: true, $ne: null } },
              { "metadata.mint_amount": { $exists: true, $ne: null } },
            ],
          },
        ],
      };

      console.log(
        `[getTransactionHistory] Enhanced query for data integrity:`,
        {
          npub,
          originalQuery: query,
          enhancedQuery,
          timestamp: new Date().toISOString(),
        }
      );

      const [transactions, totalCount, invalidCount] = await Promise.all([
        CashuToken.find(enhancedQuery)
          .sort({ created_at: -1 })
          .limit(limit)
          .skip(skip)
          .lean(),
        CashuToken.countDocuments(enhancedQuery),
        // Count invalid records for monitoring
        CashuToken.countDocuments({
          ...query,
          $or: [
            { transaction_id: { $exists: false } },
            { transaction_id: null },
            { transaction_id: "" },
            { transaction_type: { $exists: false } },
            { transaction_type: null },
            { status: { $exists: false } },
            { status: null },
            { total_amount: { $exists: false } },
            { total_amount: null },
            { total_amount: { $lt: 0 } },
            { "metadata.source": { $exists: false } },
            { "metadata.source": null },
          ],
        }),
      ]);

      // Log data integrity metrics
      if (invalidCount > 0) {
        console.warn(`[getTransactionHistory] Found invalid records:`, {
          npub,
          validCount: totalCount,
          invalidCount,
          totalInDb: totalCount + invalidCount,
          timestamp: new Date().toISOString(),
        });
      }

      return {
        transactions,
        pagination: {
          total: totalCount,
          limit,
          skip,
          has_more: skip + limit < totalCount,
          invalid_filtered: invalidCount,
        },
      };
    } catch (error) {
      throw new Error(`Failed to get transaction history: ${error.message}`);
    }
  }

  // ==================== PROOF STATE MANAGEMENT ====================

  /**
   * Select optimal tokens for spending a specific amount
   * @param {string} npub - User's NPUB
   * @param {number} amount - Amount to spend
   * @param {string} [mintUrl] - Optional mint URL filter
   * @returns {Promise<Object>} Selected tokens and change amount
   */
  async selectTokensForSpending(npub, amount, mintUrl = null) {
    try {
      const unspentTokens = await this.findUnspentTokens(npub, mintUrl);

      if (unspentTokens.length === 0) {
        throw new Error("No unspent tokens available");
      }

      // Sort tokens by amount (smallest first for optimal selection)
      const sortedTokens = unspentTokens.sort(
        (a, b) => a.total_amount - b.total_amount
      );

      let selectedTokens = [];
      let totalSelected = 0;

      // Simple greedy selection algorithm
      for (const token of sortedTokens) {
        selectedTokens.push(token);
        totalSelected += token.total_amount;

        if (totalSelected >= amount) {
          break;
        }
      }

      if (totalSelected < amount) {
        throw new Error(
          `Insufficient balance. Required: ${amount}, Available: ${totalSelected}`
        );
      }

      const changeAmount = totalSelected - amount;

      return {
        selected_tokens: selectedTokens,
        total_selected: totalSelected,
        change_amount: changeAmount,
        exact_amount: changeAmount === 0,
      };
    } catch (error) {
      throw new Error(`Failed to select tokens for spending: ${error.message}`);
    }
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Generate unique transaction ID
   * @param {string} [prefix='tx'] - Transaction ID prefix
   * @returns {string} Unique transaction ID
   */
  generateTransactionId(prefix = "tx") {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }

  /**
   * Validate wallet ownership
   * @param {string} npub - User's NPUB
   * @param {string} walletId - Wallet ID to validate
   * @returns {Promise<boolean>} True if user owns the wallet
   */
  async validateWalletOwnership(npub, walletId) {
    try {
      const wallet = await CashuWallet.findById(walletId);
      return wallet && wallet.npub === npub;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get wallet statistics
   * @param {string} npub - User's NPUB
   * @returns {Promise<Object>} Wallet statistics
   */
  async getWalletStats(npub) {
    try {
      const [wallets, totalBalance, transactionCount] = await Promise.all([
        this.findWalletsByNpub(npub),
        this.calculateBalance(npub),
        CashuToken.countDocuments({ npub }),
      ]);

      return {
        wallet_count: wallets.length,
        ...totalBalance,
        total_transactions: transactionCount,
        wallets: wallets.map((w) => ({
          id: w._id,
          mint_url: w.mint_url,
          created_at: w.created_at,
        })),
      };
    } catch (error) {
      throw new Error(`Failed to get wallet stats: ${error.message}`);
    }
  }

  /**
   * Find pending mint transactions within a timeframe
   * @param {string} npub - User's NPUB
   * @param {Date} cutoffDate - Only return transactions created after this date
   * @returns {Promise<CashuToken[]>} Array of pending mint transaction documents
   */
  async findPendingMintTransactions(npub, cutoffDate) {
    try {
      return await CashuToken.find({
        npub,
        transaction_type: "minted",
        status: "pending",
        created_at: { $gte: cutoffDate },
      })
        .sort({ created_at: -1 })
        .lean();
    } catch (error) {
      throw new Error(
        `Failed to find pending mint transactions: ${error.message}`
      );
    }
  }
}

// Export singleton instance
const walletRepositoryService = new WalletRepositoryService();
export default walletRepositoryService;
