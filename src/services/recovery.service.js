import { logger } from "../utils/logger.js";
import walletRepositoryService from "./walletRepository.service.js";
import { completeMinting } from "./cashu.service.js";

/**
 * Recovery Service for Lightning Minting Operations
 *
 * Provides error recovery mechanisms, cleanup functions, and retry logic
 * for failed Lightning minting operations.
 */
class RecoveryService {
  // Recovery configuration
  static RECOVERY_CONFIG = {
    STUCK_TRANSACTION_TIMEOUT: 2 * 60 * 60 * 1000, // 2 hours
    MAX_RETRY_ATTEMPTS: 3,
    RETRY_DELAY_BASE: 5000, // 5 seconds
    CLEANUP_BATCH_SIZE: 10,
  };

  /**
   * Clean up stuck pending transactions
   * @param {string} [npub] - Optional specific user, otherwise cleans all users
   * @param {Object} [options] - Cleanup options
   * @returns {Promise<Object>} Cleanup result
   */
  static async cleanupStuckTransactions(npub = null, options = {}) {
    const {
      dryRun = false,
      maxAge = this.RECOVERY_CONFIG.STUCK_TRANSACTION_TIMEOUT,
      batchSize = this.RECOVERY_CONFIG.CLEANUP_BATCH_SIZE,
    } = options;

    try {
      logger.info("Starting stuck transaction cleanup", {
        npub,
        dryRun,
        maxAge: `${maxAge / 1000 / 60} minutes`,
        batchSize,
      });

      const cutoffDate = new Date(Date.now() - maxAge);
      let stuckTransactions = [];

      if (npub) {
        // Clean up for specific user
        stuckTransactions =
          await walletRepositoryService.findPendingMintTransactions(
            npub,
            new Date(0) // Get all pending transactions
          );
      } else {
        // Clean up for all users - find stuck transactions across all users
        stuckTransactions = await this.findAllStuckTransactions(cutoffDate);
      }

      // Filter to only truly stuck transactions (older than cutoff)
      const trulyStuck = stuckTransactions.filter(
        (tx) => new Date(tx.created_at) < cutoffDate
      );

      if (trulyStuck.length === 0) {
        logger.info("No stuck transactions found", { npub });
        return {
          success: true,
          processed: 0,
          cleaned: 0,
          failed: 0,
          transactions: [],
        };
      }

      logger.info(`Found ${trulyStuck.length} stuck transactions`, {
        npub,
        oldestTransaction: trulyStuck[0]?.created_at,
      });

      const results = {
        processed: 0,
        cleaned: 0,
        failed: 0,
        transactions: [],
      };

      // Process in batches
      for (let i = 0; i < trulyStuck.length; i += batchSize) {
        const batch = trulyStuck.slice(i, i + batchSize);

        for (const transaction of batch) {
          results.processed++;

          try {
            const cleanupResult = await this.cleanupSingleTransaction(
              transaction,
              { dryRun }
            );

            results.transactions.push({
              transactionId: transaction.transaction_id,
              npub: transaction.npub,
              amount: transaction.metadata?.mint_amount,
              age: Date.now() - new Date(transaction.created_at).getTime(),
              action: cleanupResult.action,
              success: cleanupResult.success,
              error: cleanupResult.error,
            });

            if (cleanupResult.success) {
              results.cleaned++;
            } else {
              results.failed++;
            }
          } catch (error) {
            logger.error("Error cleaning up transaction", {
              transactionId: transaction.transaction_id,
              npub: transaction.npub,
              error: error.message,
            });

            results.failed++;
            results.transactions.push({
              transactionId: transaction.transaction_id,
              npub: transaction.npub,
              action: "error",
              success: false,
              error: error.message,
            });
          }
        }

        // Small delay between batches to avoid overwhelming the system
        if (i + batchSize < trulyStuck.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      logger.info("Stuck transaction cleanup completed", {
        npub,
        dryRun,
        ...results,
      });

      return {
        success: true,
        ...results,
      };
    } catch (error) {
      logger.error("Failed to cleanup stuck transactions", {
        npub,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        processed: 0,
        cleaned: 0,
        failed: 0,
        transactions: [],
      };
    }
  }

  /**
   * Clean up a single stuck transaction
   * @param {Object} transaction - Transaction to clean up
   * @param {Object} options - Cleanup options
   * @returns {Promise<Object>} Cleanup result
   */
  static async cleanupSingleTransaction(transaction, options = {}) {
    const { dryRun = false } = options;
    const { transaction_id, npub, metadata } = transaction;

    try {
      logger.info("Cleaning up stuck transaction", {
        transactionId: transaction_id,
        npub,
        dryRun,
        age: Date.now() - new Date(transaction.created_at).getTime(),
      });

      // First, try to complete the transaction if it has a quote_id
      if (metadata?.quote_id && metadata?.mint_amount) {
        try {
          if (!dryRun) {
            const completionResult = await completeMinting(
              npub,
              metadata.quote_id,
              metadata.mint_amount,
              transaction_id
            );

            logger.info("Successfully completed stuck transaction", {
              transactionId: transaction_id,
              npub,
              tokenId: completionResult.tokenId,
            });

            return {
              success: true,
              action: "completed",
              tokenId: completionResult.tokenId,
            };
          } else {
            return {
              success: true,
              action: "would_complete",
            };
          }
        } catch (completionError) {
          // If completion fails, mark as failed
          logger.warn(
            "Could not complete stuck transaction, marking as failed",
            {
              transactionId: transaction_id,
              npub,
              error: completionError.message,
            }
          );

          if (!dryRun) {
            await walletRepositoryService.updatePendingTransaction(
              transaction._id,
              {
                status: "failed",
                metadata: {
                  ...metadata,
                  failed_at: new Date(),
                  failure_reason: completionError.message,
                  cleanup_action: "auto_failed",
                },
              }
            );
          }

          return {
            success: true,
            action: "marked_failed",
            reason: completionError.message,
          };
        }
      } else {
        // Transaction missing required metadata, mark as failed
        if (!dryRun) {
          await walletRepositoryService.updatePendingTransaction(
            transaction._id,
            {
              status: "failed",
              metadata: {
                ...metadata,
                failed_at: new Date(),
                failure_reason: "Missing quote_id or mint_amount",
                cleanup_action: "auto_failed_missing_data",
              },
            }
          );
        }

        return {
          success: true,
          action: "marked_failed",
          reason: "Missing required metadata",
        };
      }
    } catch (error) {
      logger.error("Error during single transaction cleanup", {
        transactionId: transaction_id,
        npub,
        error: error.message,
      });

      return {
        success: false,
        action: "error",
        error: error.message,
      };
    }
  }

  /**
   * Retry failed updatePendingTransaction calls
   * @param {string} tokenId - Token ID to update
   * @param {Object} updates - Updates to apply
   * @param {Object} options - Retry options
   * @returns {Promise<Object>} Retry result
   */
  static async retryUpdatePendingTransaction(tokenId, updates, options = {}) {
    const {
      maxAttempts = this.RECOVERY_CONFIG.MAX_RETRY_ATTEMPTS,
      baseDelay = this.RECOVERY_CONFIG.RETRY_DELAY_BASE,
    } = options;

    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.info("Attempting to update pending transaction", {
          tokenId,
          attempt,
          maxAttempts,
        });

        const result = await walletRepositoryService.updatePendingTransaction(
          tokenId,
          updates
        );

        logger.info("Successfully updated pending transaction", {
          tokenId,
          attempt,
          status: result.status,
        });

        return {
          success: true,
          result,
          attempts: attempt,
        };
      } catch (error) {
        lastError = error;

        logger.warn("Failed to update pending transaction", {
          tokenId,
          attempt,
          maxAttempts,
          error: error.message,
        });

        // Don't retry on validation errors or not found errors
        if (
          error.message.includes("not found") ||
          error.message.includes("Validation failed") ||
          error.message.includes("Invalid status transition")
        ) {
          logger.error("Non-retryable error, stopping retry attempts", {
            tokenId,
            attempt,
            error: error.message,
          });
          break;
        }

        // Wait before next attempt (exponential backoff)
        if (attempt < maxAttempts) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    logger.error("All retry attempts failed for pending transaction update", {
      tokenId,
      maxAttempts,
      finalError: lastError.message,
    });

    return {
      success: false,
      error: lastError.message,
      attempts: maxAttempts,
    };
  }

  /**
   * Find all stuck transactions across all users
   * @param {Date} cutoffDate - Transactions older than this are considered stuck
   * @returns {Promise<Array>} Array of stuck transactions
   */
  static async findAllStuckTransactions(cutoffDate) {
    try {
      const CashuToken = (await import("../models/CashuToken.model.js"))
        .default;

      return await CashuToken.find({
        transaction_type: "minted",
        status: "pending",
        created_at: { $lt: cutoffDate },
      })
        .sort({ created_at: 1 }) // Oldest first
        .lean();
    } catch (error) {
      logger.error("Error finding stuck transactions", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get recovery statistics
   * @param {string} [npub] - Optional specific user
   * @returns {Promise<Object>} Recovery statistics
   */
  static async getRecoveryStats(npub = null) {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const CashuToken = (await import("../models/CashuToken.model.js"))
        .default;

      const baseQuery = {
        transaction_type: "minted",
        status: "pending",
      };

      if (npub) {
        baseQuery.npub = npub;
      }

      const [totalPending, stuckOneHour, stuckOneDay] = await Promise.all([
        CashuToken.countDocuments(baseQuery),
        CashuToken.countDocuments({
          ...baseQuery,
          created_at: { $lt: oneHourAgo },
        }),
        CashuToken.countDocuments({
          ...baseQuery,
          created_at: { $lt: oneDayAgo },
        }),
      ]);

      return {
        totalPending,
        stuckOneHour,
        stuckOneDay,
        healthyPending: totalPending - stuckOneHour,
        npub,
        timestamp: now,
      };
    } catch (error) {
      logger.error("Error getting recovery stats", {
        npub,
        error: error.message,
      });
      throw error;
    }
  }
}

export default RecoveryService;
