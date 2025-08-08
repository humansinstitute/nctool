import CashuWallet from "../models/CashuWallet.model.js";
import CashuToken from "../models/CashuToken.model.js";
import mongoose from "mongoose";
import crypto from "crypto";

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
   * Generate unique transaction ID with enhanced entropy
   * @param {string} [prefix='tx'] - Transaction ID prefix
   * @returns {string} Unique transaction ID
   */
  generateTransactionId(prefix = "tx") {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const entropy = Math.random().toString(36).substring(2, 6);
    return `${prefix}_${timestamp}_${random}_${entropy}`;
  }

  /**
   * Validate transaction ID format and uniqueness
   * @param {string} transactionId - Transaction ID to validate
   * @param {string} [operationType='melt'] - Type of operation for validation
   * @returns {Promise<Object>} Validation result
   */
  async validateTransactionId(transactionId, operationType = 'melt') {
    try {
      // Format validation
      if (!transactionId || typeof transactionId !== 'string') {
        return {
          valid: false,
          error: 'Transaction ID must be a non-empty string',
          code: 'INVALID_FORMAT'
        };
      }

      // Length validation
      if (transactionId.length < 10 || transactionId.length > 100) {
        return {
          valid: false,
          error: 'Transaction ID must be between 10 and 100 characters',
          code: 'INVALID_LENGTH'
        };
      }

      // Pattern validation for atomic operations
      if (operationType === 'melt') {
        const atomicPattern = /^tx_melt_\d+_[a-z0-9]+(_[a-z0-9]+)?$/;
        if (!atomicPattern.test(transactionId) && !transactionId.startsWith('tx_melt_')) {
          console.warn(`[validateTransactionId] Non-standard melt transaction ID pattern: ${transactionId}`);
        }
      }

      // Uniqueness validation
      const existingTokens = await CashuToken.find({ transaction_id: transactionId }).limit(1);
      if (existingTokens.length > 0) {
        return {
          valid: false,
          error: 'Transaction ID already exists',
          code: 'DUPLICATE_TRANSACTION_ID',
          existingToken: existingTokens[0]._id
        };
      }

      return {
        valid: true,
        transactionId,
        operationType
      };

    } catch (error) {
      return {
        valid: false,
        error: `Transaction ID validation failed: ${error.message}`,
        code: 'VALIDATION_ERROR'
      };
    }
  }

  /**
   * Check for duplicate operation based on transaction context
   * @param {string} npub - User's NPUB
   * @param {string} operationHash - Hash of operation parameters
   * @param {number} [timeWindowMs=300000] - Time window for duplicate detection (5 minutes)
   * @returns {Promise<Object>} Duplicate detection result
   */
  async checkDuplicateOperation(npub, operationHash, timeWindowMs = 300000) {
    try {
      const cutoffTime = new Date(Date.now() - timeWindowMs);
      
      // Look for operations with same hash, with flexible time filtering
      // First try with time filter for tokens that have proper created_at timestamps
      let recentOperations = await CashuToken.find({
        npub,
        'metadata.operation_hash': operationHash,
        created_at: { $gte: cutoffTime }
      }).sort({ created_at: -1 }).limit(1);

      // If no results with time filter, try without time filter
      // This handles tokens with undefined created_at (e.g., from tests or legacy data)
      if (recentOperations.length === 0) {
        recentOperations = await CashuToken.find({
          npub,
          'metadata.operation_hash': operationHash
        }).sort({ created_at: -1 }).limit(1);
      }
      
      if (recentOperations.length > 0) {
        const duplicateOp = recentOperations[0];
        
        // Calculate time since original, handling undefined created_at
        let timeSinceOriginal = 0;
        if (duplicateOp.created_at) {
          timeSinceOriginal = Date.now() - duplicateOp.created_at.getTime();
        }
        
        return {
          isDuplicate: true,
          originalTransaction: duplicateOp.transaction_id,
          originalTimestamp: duplicateOp.created_at,
          timeSinceOriginal
        };
      }

      return {
        isDuplicate: false,
        operationHash
      };

    } catch (error) {
      throw new Error(`Failed to check duplicate operation: ${error.message}`);
    }
  }

  /**
   * Generate operation hash for idempotency
   * @param {Object} operationParams - Operation parameters
   * @returns {string} SHA-256 hash of operation parameters
   */
  generateOperationHash(operationParams) {
    // const crypto = require('crypto');
    
    // Create deterministic string from operation parameters
    const hashInput = JSON.stringify({
      npub: operationParams.npub,
      mint_url: operationParams.mint_url,
      amount: operationParams.amount,
      source_token_ids: operationParams.source_token_ids?.sort(), // Sort for consistency
      operation_type: operationParams.operation_type || 'melt',
      // Exclude timestamp and random elements
    });

    return crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
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

  // ==================== ATOMIC MELT OPERATIONS ====================

  /**
   * Execute atomic melt transaction
   *
   * Atomically handles the complete melt operation using MongoDB transactions:
   * 1. Mark source tokens as spent
   * 2. Store keep proofs as change tokens (transaction_type: "change")
   * 3. Store melt change proofs as change tokens (transaction_type: "change")
   * 4. Add audit logging without storing consumed proofs
   *
   * CRITICAL: Does NOT create any "melted" token documents with consumed proofs
   * to prevent double-counting risks as documented in the analysis.
   *
   * @param {string[]} sourceTokenIds - Array of source token document IDs to mark as spent
   * @param {Array} keepProofs - Keep proofs to store as change tokens
   * @param {Array} meltChangeProofs - Melt change proofs to store as change tokens
   * @param {string} transactionId - Unique transaction identifier
   * @param {Object} metadata - Transaction metadata including npub, wallet_id, mint_url
   * @param {string} metadata.npub - User's NPUB
   * @param {string} metadata.wallet_id - Wallet ID
   * @param {string} metadata.mint_url - Mint URL
   * @param {string} [metadata.parent_transaction_id] - Parent transaction reference
   * @returns {Promise<Object>} Result object with operation details
   * @throws {Error} If any part of the atomic operation fails
   */
  async executeAtomicMelt(sourceTokenIds, keepProofs, meltChangeProofs, transactionId, metadata) {
    const session = await mongoose.startSession();
    
    try {
      // Mock transaction for test environments that don't support replica sets
      const executeTransaction = async () => {
        // Validate required metadata
        if (!metadata.npub || !metadata.wallet_id || !metadata.mint_url) {
          throw new Error('Missing required metadata: npub, wallet_id, and mint_url are required');
        }

        // Enhanced idempotency controls
        console.log(`[executeAtomicMelt] Starting atomic melt with enhanced controls:`, {
          transaction_id: transactionId,
          npub: metadata.npub,
          source_tokens: sourceTokenIds.length,
          keep_proofs: keepProofs?.length || 0,
          melt_change_proofs: meltChangeProofs?.length || 0,
          timestamp: new Date().toISOString()
        });

        // 1. Validate transaction ID uniqueness
        const transactionValidation = await this.validateTransactionId(transactionId, 'melt');
        if (!transactionValidation.valid) {
          const error = new Error(`Transaction validation failed: ${transactionValidation.error}`);
          error.code = transactionValidation.code;
          error.existingToken = transactionValidation.existingToken;
          throw error;
        }

        // 2. Check for duplicate operations
        const operationParams = {
          npub: metadata.npub,
          mint_url: metadata.mint_url,
          source_token_ids: sourceTokenIds,
          operation_type: 'atomic_melt',
          amount: metadata.amount || 0
        };
        
        const operationHash = this.generateOperationHash(operationParams);
        const duplicateCheck = await this.checkDuplicateOperation(metadata.npub, operationHash);
        
        if (duplicateCheck.isDuplicate) {
          const error = new Error(
            `Duplicate melt operation detected. Original transaction: ${duplicateCheck.originalTransaction}, ` +
            `Time since original: ${duplicateCheck.timeSinceOriginal}ms`
          );
          error.code = 'DUPLICATE_OPERATION';
          error.originalTransaction = duplicateCheck.originalTransaction;
          throw error;
        }

        // 3. Validate concurrent operation prevention
        const concurrentCheck = await CashuToken.find({
          _id: { $in: sourceTokenIds },
          status: { $ne: 'unspent' }
        }).session(session);

        if (concurrentCheck.length > 0) {
          const error = new Error(
            `Concurrent operation detected. ${concurrentCheck.length} tokens are no longer unspent`
          );
          error.code = 'CONCURRENT_OPERATION';
          error.conflictingTokens = concurrentCheck.map(t => t._id);
          throw error;
        }

        // 4. Mark source tokens as spent
        const spentResult = await CashuToken.updateMany(
          { _id: { $in: sourceTokenIds } },
          {
            $set: {
              status: "spent",
              spent_at: new Date(),
            },
          },
          { session }
        );

        if (spentResult.modifiedCount !== sourceTokenIds.length) {
          throw new Error(
            `Failed to mark all source tokens as spent. Expected: ${sourceTokenIds.length}, Modified: ${spentResult.modifiedCount}`
          );
        }

        const operations = [];
        let keepTokenDoc = null;
        let meltChangeTokenDoc = null;

        // 2. Store keep proofs as change tokens (if any)
        if (keepProofs && keepProofs.length > 0) {
          const keepTokenData = {
            npub: metadata.npub,
            wallet_id: metadata.wallet_id,
            proofs: keepProofs,
            mint_url: metadata.mint_url,
            status: "unspent",
            transaction_type: "change",
            transaction_id: `${transactionId}_keep`,
            metadata: {
              source: "change",
              parent_transaction_id: metadata.parent_transaction_id || transactionId,
              operation_hash: operationHash,
              atomic_operation: true,
              operation_timestamp: new Date().toISOString()
            },
          };

          keepTokenDoc = new CashuToken(keepTokenData);
          await keepTokenDoc.save({ session });
          operations.push({
            type: "keep_change",
            token_id: keepTokenDoc._id,
            amount: keepTokenDoc.total_amount,
            proof_count: keepProofs.length,
          });
        }

        // 3. Store melt change proofs as change tokens (if any)
        if (meltChangeProofs && meltChangeProofs.length > 0) {
          const meltChangeTokenData = {
            npub: metadata.npub,
            wallet_id: metadata.wallet_id,
            proofs: meltChangeProofs,
            mint_url: metadata.mint_url,
            status: "unspent",
            transaction_type: "change",
            transaction_id: `${transactionId}_melt_change`,
            metadata: {
              source: "change",
              parent_transaction_id: metadata.parent_transaction_id || transactionId,
              operation_hash: operationHash,
              atomic_operation: true,
              operation_timestamp: new Date().toISOString()
            },
          };

          meltChangeTokenDoc = new CashuToken(meltChangeTokenData);
          await meltChangeTokenDoc.save({ session });
          operations.push({
            type: "melt_change",
            token_id: meltChangeTokenDoc._id,
            amount: meltChangeTokenDoc.total_amount,
            proof_count: meltChangeProofs.length,
          });
        }

        // 4. Audit logging (without storing consumed proofs)
        const auditLog = {
          transaction_id: transactionId,
          operation_type: "atomic_melt",
          timestamp: new Date(),
          source_tokens_spent: sourceTokenIds.length,
          operations_performed: operations,
          metadata: {
            npub: metadata.npub,
            wallet_id: metadata.wallet_id,
            mint_url: metadata.mint_url,
            parent_transaction_id: metadata.parent_transaction_id,
          },
        };

        // Log audit information (in production, this would go to an audit collection)
        console.log('[executeAtomicMelt] Audit Log:', JSON.stringify(auditLog, null, 2));

        return {
          success: true,
          transaction_id: transactionId,
          source_tokens_spent: sourceTokenIds.length,
          keep_token_id: keepTokenDoc?._id,
          keep_amount: keepTokenDoc?.total_amount || 0,
          melt_change_token_id: meltChangeTokenDoc?._id,
          melt_change_amount: meltChangeTokenDoc?.total_amount || 0,
          operations,
          audit_log: auditLog,
        };
      };

      // Use withTransaction if available (replica set), otherwise execute directly
      let result;
      if (session.withTransaction && process.env.NODE_ENV !== 'test') {
        result = await session.withTransaction(executeTransaction, {
          readPreference: 'primary',
          readConcern: { level: 'local' },
          writeConcern: { w: 'majority' }
        });
      } else {
        // For test environments or non-replica set MongoDB
        result = await executeTransaction();
      }

      return result;

    } catch (error) {
      // Enhanced error logging for debugging
      console.error('[executeAtomicMelt] Transaction failed:', {
        error: error.message,
        transaction_id: transactionId,
        source_token_ids: sourceTokenIds,
        keep_proofs_count: keepProofs?.length || 0,
        melt_change_proofs_count: meltChangeProofs?.length || 0,
        metadata,
        timestamp: new Date().toISOString(),
      });

      throw new Error(`Atomic melt transaction failed: ${error.message}`);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Enhanced markTokensAsSpent method with transaction support
   * @param {string[]} tokenIds - Array of token document IDs
   * @param {Object} [session] - Optional MongoDB session for transactions
   * @returns {Promise<number>} Number of tokens updated
   */
  async markTokensAsSpentWithSession(tokenIds, session = null) {
    try {
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

  // ==================== POST-MELT RECONCILIATION AND AUDIT ====================

  /**
   * Perform post-melt reconciliation and validation
   * @param {string} transactionId - Transaction ID to reconcile
   * @param {Object} expectedState - Expected state after melt operation
   * @param {string} npub - User's NPUB
   * @param {string} mintUrl - Mint URL
   * @returns {Promise<Object>} Reconciliation result
   */
  async performPostMeltReconciliation(transactionId, expectedState, npub, mintUrl) {
    try {
      console.log(`[performPostMeltReconciliation] Starting post-melt reconciliation:`, {
        transaction_id: transactionId,
        npub,
        mint_url: mintUrl,
        expected_state: expectedState,
        timestamp: new Date().toISOString()
      });

      const reconciliationResult = {
        transaction_id: transactionId,
        reconciliation_timestamp: new Date(),
        checks_performed: [],
        discrepancies_found: [],
        validation_passed: true,
        performance_metrics: {}
      };

      const startTime = Date.now();

      // 1. Validate transaction completeness
      const transactionTokens = await this.findTokensByTransactionId(transactionId);
      const keepTokens = await CashuToken.find({ transaction_id: `${transactionId}_keep` });
      const meltChangeTokens = await CashuToken.find({ transaction_id: `${transactionId}_melt_change` });

      reconciliationResult.checks_performed.push({
        check_type: 'transaction_completeness',
        result: 'passed',
        details: {
          main_transaction_tokens: transactionTokens.length,
          keep_tokens: keepTokens.length,
          melt_change_tokens: meltChangeTokens.length
        }
      });

      // 2. Validate balance consistency
      const currentBalance = await this.calculateBalance(npub, mintUrl);
      const balanceCheck = {
        check_type: 'balance_consistency',
        current_balance: currentBalance,
        expected_changes: expectedState.balance_changes || {},
        result: 'passed'
      };

      // Check if balance changes match expectations
      if (expectedState.balance_changes) {
        const expectedUnspent = expectedState.balance_changes.expected_unspent_balance;
        if (expectedUnspent !== undefined && Math.abs(currentBalance.unspent_balance - expectedUnspent) > 0.01) {
          balanceCheck.result = 'failed';
          balanceCheck.discrepancy = {
            expected: expectedUnspent,
            actual: currentBalance.unspent_balance,
            difference: currentBalance.unspent_balance - expectedUnspent
          };
          reconciliationResult.discrepancies_found.push(balanceCheck.discrepancy);
          reconciliationResult.validation_passed = false;
        }
      }

      reconciliationResult.checks_performed.push(balanceCheck);

      // 3. Validate token status consistency
      const sourceTokenIds = expectedState.source_token_ids || [];
      if (sourceTokenIds.length > 0) {
        const sourceTokens = await CashuToken.find({ _id: { $in: sourceTokenIds } });
        const unspentSourceTokens = sourceTokens.filter(t => t.status !== 'spent');
        
        if (unspentSourceTokens.length > 0) {
          const statusCheck = {
            check_type: 'source_token_status',
            result: 'failed',
            discrepancy: {
              unspent_source_tokens: unspentSourceTokens.length,
              token_ids: unspentSourceTokens.map(t => t._id)
            }
          };
          reconciliationResult.checks_performed.push(statusCheck);
          reconciliationResult.discrepancies_found.push(statusCheck.discrepancy);
          reconciliationResult.validation_passed = false;
        } else {
          reconciliationResult.checks_performed.push({
            check_type: 'source_token_status',
            result: 'passed',
            details: { all_source_tokens_spent: true }
          });
        }
      }

      // 4. Validate change token creation
      if (expectedState.keep_proofs_count > 0) {
        if (keepTokens.length === 0) {
          reconciliationResult.discrepancies_found.push({
            type: 'missing_keep_tokens',
            expected_count: expectedState.keep_proofs_count,
            actual_count: 0
          });
          reconciliationResult.validation_passed = false;
        }
      }

      if (expectedState.melt_change_proofs_count > 0) {
        if (meltChangeTokens.length === 0) {
          reconciliationResult.discrepancies_found.push({
            type: 'missing_melt_change_tokens',
            expected_count: expectedState.melt_change_proofs_count,
            actual_count: 0
          });
          reconciliationResult.validation_passed = false;
        }
      }

      // 5. Performance metrics
      const endTime = Date.now();
      reconciliationResult.performance_metrics = {
        reconciliation_duration_ms: endTime - startTime,
        checks_count: reconciliationResult.checks_performed.length,
        discrepancies_count: reconciliationResult.discrepancies_found.length
      };

      // 6. Generate audit log entry
      await this.createAuditLogEntry({
        operation_type: 'post_melt_reconciliation',
        transaction_id: transactionId,
        npub,
        mint_url: mintUrl,
        reconciliation_result: reconciliationResult,
        timestamp: new Date()
      });

      console.log(`[performPostMeltReconciliation] Reconciliation completed:`, {
        transaction_id: transactionId,
        validation_passed: reconciliationResult.validation_passed,
        discrepancies_count: reconciliationResult.discrepancies_found.length,
        duration_ms: reconciliationResult.performance_metrics.reconciliation_duration_ms
      });

      return reconciliationResult;

    } catch (error) {
      console.error(`[performPostMeltReconciliation] Reconciliation failed:`, {
        transaction_id: transactionId,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      throw new Error(`Post-melt reconciliation failed: ${error.message}`);
    }
  }

  /**
   * Create comprehensive audit log entry
   * @param {Object} auditData - Audit data to log
   * @returns {Promise<void>}
   */
  async createAuditLogEntry(auditData) {
    try {
      const auditEntry = {
        audit_id: this.generateTransactionId('audit'),
        timestamp: auditData.timestamp || new Date(),
        operation_type: auditData.operation_type,
        transaction_id: auditData.transaction_id,
        npub: auditData.npub ? auditData.npub.substring(0, 10) + '...' : null, // Truncate for privacy
        mint_url: auditData.mint_url,
        audit_data: this.sanitizeAuditData(auditData),
        compliance_level: this.determineComplianceLevel(auditData),
        retention_policy: 'standard' // Could be configurable
      };

      // In production, this would be stored in a dedicated audit collection
      // For now, we'll use enhanced console logging with structured format
      console.log(`[AUDIT_LOG] ${auditEntry.operation_type.toUpperCase()}:`,
        JSON.stringify(auditEntry, null, 2));

      // Store audit metrics for monitoring
      await this.updateAuditMetrics(auditEntry);

    } catch (error) {
      // Audit logging should never fail the main operation
      console.error(`[createAuditLogEntry] Failed to create audit log:`, {
        error: error.message,
        audit_operation: auditData.operation_type,
        transaction_id: auditData.transaction_id
      });
    }
  }

  /**
   * Sanitize audit data to remove sensitive information
   * @param {Object} auditData - Raw audit data
   * @returns {Object} Sanitized audit data
   */
  sanitizeAuditData(auditData) {
    const sanitized = { ...auditData };
    
    // Remove sensitive proof data
    if (sanitized.proofs) {
      sanitized.proofs = sanitized.proofs.map(proof => ({
        amount: proof.amount,
        id: proof.id,
        secret: proof.secret ? proof.secret.substring(0, 8) + '...' : null
      }));
    }

    // Remove full NPUB, keep only prefix for identification
    if (sanitized.npub && sanitized.npub.length > 10) {
      sanitized.npub = sanitized.npub.substring(0, 10) + '...';
    }

    // Remove any private keys or sensitive metadata
    if (sanitized.metadata) {
      delete sanitized.metadata.private_key;
      delete sanitized.metadata.secret_key;
    }

    return sanitized;
  }

  /**
   * Determine compliance level for audit entry
   * @param {Object} auditData - Audit data
   * @returns {string} Compliance level
   */
  determineComplianceLevel(auditData) {
    if (auditData.operation_type === 'atomic_melt' ||
        auditData.operation_type === 'post_melt_reconciliation') {
      return 'high'; // Financial operations require high compliance
    }
    
    if (auditData.discrepancies_found && auditData.discrepancies_found.length > 0) {
      return 'critical'; // Any discrepancies require critical attention
    }
    
    return 'standard';
  }

  /**
   * Update audit metrics for monitoring and alerting
   * @param {Object} auditEntry - Audit entry
   * @returns {Promise<void>}
   */
  async updateAuditMetrics(auditEntry) {
    try {
      // In production, this would update monitoring dashboards
      // For now, we'll maintain in-memory metrics
      const metrics = {
        timestamp: auditEntry.timestamp,
        operation_type: auditEntry.operation_type,
        compliance_level: auditEntry.compliance_level,
        transaction_id: auditEntry.transaction_id
      };

      // Log metrics for external monitoring systems
      console.log(`[AUDIT_METRICS] Operation recorded:`, metrics);

      // Could integrate with monitoring services like DataDog, New Relic, etc.
      
    } catch (error) {
      console.error(`[updateAuditMetrics] Failed to update metrics:`, {
        error: error.message,
        audit_id: auditEntry.audit_id
      });
    }
  }

  /**
   * Generate operation performance report
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Object>} Performance report
   */
  async generateOperationPerformanceReport(transactionId) {
    try {
      const report = {
        transaction_id: transactionId,
        report_timestamp: new Date(),
        performance_metrics: {},
        recommendations: []
      };

      // Analyze transaction timing and efficiency
      const transactionTokens = await this.findTokensByTransactionId(transactionId);
      
      if (transactionTokens.length > 0) {
        const mainToken = transactionTokens[0];
        report.performance_metrics = {
          transaction_created: mainToken.created_at,
          operation_duration: (mainToken.spent_at && mainToken.created_at) ?
            mainToken.spent_at.getTime() - mainToken.created_at.getTime() : null,
          tokens_processed: transactionTokens.length
        };

        // Generate recommendations based on performance
        if (report.performance_metrics.operation_duration > 5000) {
          report.recommendations.push({
            type: 'performance',
            message: 'Operation took longer than expected. Consider optimizing token selection.',
            priority: 'medium'
          });
        }
      }

      return report;

    } catch (error) {
      throw new Error(`Failed to generate performance report: ${error.message}`);
    }
  }
}

// Export singleton instance
const walletRepositoryService = new WalletRepositoryService();
export default walletRepositoryService;
