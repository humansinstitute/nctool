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
   * Store new tokens in the database
   * @param {Object} tokenData - Token storage data
   * @param {string} tokenData.npub - User's NPUB
   * @param {string} tokenData.wallet_id - Wallet ID
   * @param {Array} tokenData.proofs - Array of proof objects
   * @param {string} tokenData.mint_url - Mint URL
   * @param {string} tokenData.transaction_type - Transaction type
   * @param {string} tokenData.transaction_id - Transaction ID
   * @param {Object} [tokenData.metadata] - Additional metadata
   * @returns {Promise<CashuToken>} Created token document
   */
  async storeTokens(tokenData) {
    try {
      // Validate that proofs don't already exist (double-spend prevention)
      const secrets = tokenData.proofs.map((proof) => proof.secret);
      const existingTokens = await CashuToken.findBySecrets(secrets);

      if (existingTokens.length > 0) {
        throw new Error(
          "Some proofs already exist in database (potential double-spend)"
        );
      }

      const token = new CashuToken(tokenData);
      return await token.save();
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
   * Mark tokens as spent
   * @param {string[]} tokenIds - Array of token document IDs
   * @returns {Promise<number>} Number of tokens updated
   */
  async markTokensAsSpent(tokenIds) {
    try {
      const result = await CashuToken.updateMany(
        { _id: { $in: tokenIds } },
        {
          $set: {
            status: "spent",
            spent_at: new Date(),
          },
        }
      );
      return result.modifiedCount;
    } catch (error) {
      throw new Error(`Failed to mark tokens as spent: ${error.message}`);
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
      const updatedToken = await CashuToken.findByIdAndUpdate(
        tokenId,
        { $set: updates },
        { new: true, runValidators: true }
      );

      if (!updatedToken) {
        throw new Error(`Token with ID ${tokenId} not found`);
      }

      return updatedToken;
    } catch (error) {
      throw new Error(`Failed to update pending transaction: ${error.message}`);
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
      const [unspentBalance, pendingBalance, totalBalance] = await Promise.all([
        CashuToken.calculateBalance(npub, "unspent", mintUrl),
        CashuToken.calculateBalance(npub, "pending", mintUrl),
        CashuToken.calculateBalance(npub, null, mintUrl), // All statuses
      ]);

      const spentBalance = totalBalance - unspentBalance - pendingBalance;

      return {
        total_balance: totalBalance,
        unspent_balance: unspentBalance,
        pending_balance: pendingBalance,
        spent_balance: spentBalance,
      };
    } catch (error) {
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

      const [transactions, totalCount] = await Promise.all([
        CashuToken.find(query)
          .sort({ created_at: -1 })
          .limit(limit)
          .skip(skip)
          .lean(),
        CashuToken.countDocuments(query),
      ]);

      return {
        transactions,
        pagination: {
          total: totalCount,
          limit,
          skip,
          has_more: skip + limit < totalCount,
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
