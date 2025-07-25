/**
 * Enhanced Mint Polling Fix
 * Addresses the identified issues in the pending transaction completion process
 */

import { logger } from "./src/utils/logger.js";
import walletRepositoryService from "./src/services/walletRepository.service.js";

// Store active polling intervals for cleanup
const activePollingIntervals = new Map();

/**
 * Enhanced startMintPolling function with improved error handling and cleanup
 * @param {string} npub - User's Nostr npub string
 * @param {string} quoteId - Mint quote ID to monitor
 * @param {number} amount - Amount to mint
 * @param {string} transactionId - Transaction ID
 * @param {Object} wallet - Initialized wallet instance
 */
export function enhancedStartMintPolling(
  npub,
  quoteId,
  amount,
  transactionId,
  wallet
) {
  const POLLING_INTERVAL = 10000; // 10 seconds
  const POLLING_DURATION = 180000; // 3 minutes
  const MAX_RETRY_ATTEMPTS = 3;
  const startTime = Date.now();

  // Create unique polling key
  const pollingKey = `${npub}_${quoteId}_${transactionId}`;

  // Check if polling is already active for this transaction
  if (activePollingIntervals.has(pollingKey)) {
    logger.warn("Polling already active for transaction", {
      npub,
      quoteId,
      transactionId,
      pollingKey,
    });
    return;
  }

  logger.info("Starting enhanced mint polling", {
    npub,
    quoteId,
    amount,
    transactionId,
    pollingKey,
    pollingInterval: `${POLLING_INTERVAL / 1000}s`,
    pollingDuration: `${POLLING_DURATION / 1000}s`,
    maxRetries: MAX_RETRY_ATTEMPTS,
  });

  let consecutiveErrors = 0;
  let pollAttempts = 0;

  const pollInterval = setInterval(async () => {
    try {
      const elapsed = Date.now() - startTime;
      pollAttempts++;

      // Stop polling after timeout
      if (elapsed >= POLLING_DURATION) {
        await cleanupPolling(pollingKey, pollInterval, {
          npub,
          quoteId,
          transactionId,
          reason: "timeout",
          elapsed: `${elapsed / 1000}s`,
          totalAttempts: pollAttempts,
        });
        return;
      }

      logger.info("Checking mint quote status with retry logic", {
        npub,
        quoteId,
        elapsed: `${elapsed / 1000}s`,
        attempt: pollAttempts,
        consecutiveErrors,
      });

      // Check quote status with retry logic
      const quoteStatus = await checkQuoteStatusWithRetry(
        wallet,
        quoteId,
        MAX_RETRY_ATTEMPTS
      );

      // Reset error counter on successful check
      consecutiveErrors = 0;

      if (quoteStatus.state === "PAID") {
        logger.info("Invoice paid! Completing minting automatically", {
          npub,
          quoteId,
          elapsed: `${elapsed / 1000}s`,
          status: "paid",
          totalAttempts: pollAttempts,
        });

        // Complete the minting process with enhanced error handling
        try {
          const completionResult = await enhancedCompleteMinting(
            npub,
            quoteId,
            amount,
            transactionId,
            wallet
          );

          logger.info("Background minting completed successfully", {
            npub,
            quoteId,
            transactionId: completionResult.transactionId,
            totalAmount: completionResult.totalAmount,
            tokenId: completionResult.tokenId,
            totalAttempts: pollAttempts,
          });

          // Clean up polling on success
          await cleanupPolling(pollingKey, pollInterval, {
            npub,
            quoteId,
            transactionId,
            reason: "completed",
            elapsed: `${elapsed / 1000}s`,
            totalAttempts: pollAttempts,
          });
        } catch (completionError) {
          logger.error("Failed to complete background minting", {
            npub,
            quoteId,
            transactionId,
            error: completionError.message,
            stack: completionError.stack,
            totalAttempts: pollAttempts,
          });

          // Mark transaction as failed and cleanup
          await markTransactionAsFailed(transactionId, completionError.message);
          await cleanupPolling(pollingKey, pollInterval, {
            npub,
            quoteId,
            transactionId,
            reason: "completion_failed",
            error: completionError.message,
          });
        }
      } else {
        logger.info("Invoice not yet paid, continuing to poll", {
          npub,
          quoteId,
          status: quoteStatus.state,
          elapsed: `${elapsed / 1000}s`,
          attempt: pollAttempts,
          nextCheckIn: `${POLLING_INTERVAL / 1000}s`,
        });
      }
    } catch (error) {
      consecutiveErrors++;

      logger.error("Error during mint polling", {
        npub,
        quoteId,
        transactionId,
        error: error.message,
        consecutiveErrors,
        maxRetries: MAX_RETRY_ATTEMPTS,
        attempt: pollAttempts,
      });

      // Stop polling if too many consecutive errors
      if (consecutiveErrors >= MAX_RETRY_ATTEMPTS) {
        logger.error("Too many consecutive polling errors, stopping", {
          npub,
          quoteId,
          transactionId,
          consecutiveErrors,
          totalAttempts: pollAttempts,
        });

        await markTransactionAsFailed(
          transactionId,
          `Polling failed after ${consecutiveErrors} consecutive errors: ${error.message}`
        );
        await cleanupPolling(pollingKey, pollInterval, {
          npub,
          quoteId,
          transactionId,
          reason: "too_many_errors",
          consecutiveErrors,
          lastError: error.message,
        });
      }
    }
  }, POLLING_INTERVAL);

  // Store the interval for cleanup
  activePollingIntervals.set(pollingKey, {
    interval: pollInterval,
    startTime,
    npub,
    quoteId,
    transactionId,
  });

  return pollingKey;
}

/**
 * Check quote status with retry logic
 * @param {Object} wallet - Wallet instance
 * @param {string} quoteId - Quote ID to check
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<Object>} Quote status
 */
async function checkQuoteStatusWithRetry(wallet, quoteId, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug("Checking quote status", { quoteId, attempt, maxRetries });

      const status = await wallet.checkMintQuote(quoteId);

      logger.debug("Quote status check successful", {
        quoteId,
        status: status.state,
        attempt,
      });

      return status;
    } catch (error) {
      lastError = error;

      logger.warn("Quote status check failed", {
        quoteId,
        attempt,
        maxRetries,
        error: error.message,
        willRetry: attempt < maxRetries,
      });

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Failed to check quote status after ${maxRetries} attempts: ${lastError.message}`
  );
}

/**
 * Enhanced completeMinting with better error handling and validation
 * @param {string} npub - User's Nostr npub string
 * @param {string} quoteId - Mint quote ID
 * @param {number} amount - Amount to mint
 * @param {string} transactionId - Transaction ID
 * @param {Object} wallet - Wallet instance
 * @returns {Promise<Object>} Minted proofs and token storage result
 */
async function enhancedCompleteMinting(
  npub,
  quoteId,
  amount,
  transactionId,
  wallet
) {
  logger.info("Starting enhanced minting completion", {
    npub,
    quoteId,
    amount,
    transactionId,
  });

  try {
    // Double-check quote is still paid (race condition protection)
    const quoteStatus = await wallet.checkMintQuote(quoteId);
    if (quoteStatus.state !== "PAID") {
      throw new Error(
        `Quote status changed to ${quoteStatus.state} during completion`
      );
    }

    // Check if transaction was already completed (race condition protection)
    const existingTokens =
      await walletRepositoryService.findTokensByTransactionId(transactionId);
    const pendingToken = existingTokens.find((t) => t.status === "pending");

    if (!pendingToken) {
      // Check if already completed
      const completedToken = existingTokens.find((t) => t.status === "unspent");
      if (completedToken) {
        logger.warn("Transaction already completed", {
          npub,
          quoteId,
          transactionId,
          tokenId: completedToken._id,
        });
        return {
          proofs: completedToken.proofs,
          tokenId: completedToken._id,
          transactionId,
          totalAmount: completedToken.total_amount,
          alreadyCompleted: true,
        };
      }
      throw new Error(`No pending transaction found for ID: ${transactionId}`);
    }

    // Mint the proofs
    logger.info("Minting proofs", { npub, quoteId, amount });
    const proofs = await wallet.mintProofs(amount, quoteId);

    if (!proofs || proofs.length === 0) {
      throw new Error("No proofs returned from minting operation");
    }

    const totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0);

    logger.info("Successfully minted proofs", {
      npub,
      quoteId,
      proofsCount: proofs.length,
      totalAmount,
      expectedAmount: amount,
    });

    // Validate minted amount matches expected
    if (totalAmount !== amount) {
      logger.warn("Minted amount differs from expected", {
        npub,
        quoteId,
        expectedAmount: amount,
        actualAmount: totalAmount,
        difference: totalAmount - amount,
      });
    }

    // Update the pending transaction with enhanced validation
    const tokenDoc = await walletRepositoryService.updatePendingTransaction(
      pendingToken._id,
      {
        proofs,
        status: "unspent",
        total_amount: totalAmount,
        metadata: {
          ...pendingToken.metadata,
          completed_at: new Date(),
          completion_method: "background_polling",
          actual_minted_amount: totalAmount,
          proofs_count: proofs.length,
        },
      }
    );

    logger.info("Successfully updated pending transaction", {
      npub,
      tokenId: tokenDoc._id,
      transactionId,
      proofsCount: proofs.length,
      totalAmount,
    });

    return {
      proofs,
      tokenId: tokenDoc._id,
      transactionId,
      totalAmount,
      alreadyCompleted: false,
    };
  } catch (error) {
    logger.error("Enhanced minting completion failed", {
      npub,
      quoteId,
      amount,
      transactionId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Clean up polling interval and log completion
 * @param {string} pollingKey - Unique polling identifier
 * @param {NodeJS.Timeout} pollInterval - Interval to clear
 * @param {Object} context - Logging context
 */
async function cleanupPolling(pollingKey, pollInterval, context) {
  try {
    // Clear the interval
    clearInterval(pollInterval);

    // Remove from active polling map
    activePollingIntervals.delete(pollingKey);

    logger.info("Polling cleanup completed", {
      pollingKey,
      ...context,
      activePollingCount: activePollingIntervals.size,
    });
  } catch (error) {
    logger.error("Error during polling cleanup", {
      pollingKey,
      error: error.message,
      context,
    });
  }
}

/**
 * Mark a transaction as failed
 * @param {string} transactionId - Transaction ID
 * @param {string} reason - Failure reason
 */
async function markTransactionAsFailed(transactionId, reason) {
  try {
    const existingTokens =
      await walletRepositoryService.findTokensByTransactionId(transactionId);
    const pendingToken = existingTokens.find((t) => t.status === "pending");

    if (pendingToken) {
      await walletRepositoryService.updatePendingTransaction(pendingToken._id, {
        status: "failed",
        metadata: {
          ...pendingToken.metadata,
          failed_at: new Date(),
          failure_reason: reason,
        },
      });

      logger.info("Marked transaction as failed", {
        transactionId,
        tokenId: pendingToken._id,
        reason,
      });
    }
  } catch (error) {
    logger.error("Failed to mark transaction as failed", {
      transactionId,
      reason,
      error: error.message,
    });
  }
}

/**
 * Get status of all active polling operations
 * @returns {Array} Array of active polling operations
 */
export function getActivePollingStatus() {
  const now = Date.now();
  return Array.from(activePollingIntervals.entries()).map(([key, data]) => ({
    pollingKey: key,
    npub: data.npub,
    quoteId: data.quoteId,
    transactionId: data.transactionId,
    elapsedTime: now - data.startTime,
    startTime: new Date(data.startTime).toISOString(),
  }));
}

/**
 * Force cleanup of a specific polling operation
 * @param {string} pollingKey - Polling key to cleanup
 * @returns {boolean} True if cleanup was performed
 */
export function forceCleanupPolling(pollingKey) {
  const pollingData = activePollingIntervals.get(pollingKey);
  if (pollingData) {
    clearInterval(pollingData.interval);
    activePollingIntervals.delete(pollingKey);

    logger.info("Force cleanup of polling operation", {
      pollingKey,
      npub: pollingData.npub,
      quoteId: pollingData.quoteId,
      transactionId: pollingData.transactionId,
    });

    return true;
  }
  return false;
}

/**
 * Cleanup all active polling operations (for shutdown)
 */
export function cleanupAllPolling() {
  const activeCount = activePollingIntervals.size;

  for (const [key, data] of activePollingIntervals.entries()) {
    clearInterval(data.interval);
  }

  activePollingIntervals.clear();

  logger.info("Cleaned up all active polling operations", {
    cleanedCount: activeCount,
  });
}

// Export the enhanced functions
export {
  checkQuoteStatusWithRetry,
  enhancedCompleteMinting,
  markTransactionAsFailed,
};
