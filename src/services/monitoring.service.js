import { logger } from "../utils/logger.js";
import walletRepositoryService from "./walletRepository.service.js";

/**
 * Monitoring Service for Lightning Minting Operations
 *
 * Provides metrics tracking, alerting, and performance monitoring
 * for the Lightning minting process.
 */
class MonitoringService {
  // Monitoring configuration
  static MONITORING_CONFIG = {
    ALERT_THRESHOLDS: {
      STUCK_TRANSACTIONS: 5, // Alert if more than 5 stuck transactions
      FAILURE_RATE: 0.1, // Alert if failure rate > 10%
      PENDING_TOO_LONG: 60 * 60 * 1000, // Alert if pending > 1 hour
    },
    METRICS_RETENTION: 7 * 24 * 60 * 60 * 1000, // 7 days
  };

  // In-memory metrics store (in production, use Redis or database)
  static metrics = {
    mintingAttempts: 0,
    mintingSuccesses: 0,
    mintingFailures: 0,
    completionAttempts: 0,
    completionSuccesses: 0,
    completionFailures: 0,
    averageCompletionTime: 0,
    lastReset: new Date(),
  };

  /**
   * Track a minting attempt
   * @param {string} npub - User's npub
   * @param {number} amount - Amount being minted
   * @param {string} transactionId - Transaction ID
   */
  static trackMintingAttempt(npub, amount, transactionId) {
    this.metrics.mintingAttempts++;

    logger.info("Tracking minting attempt", {
      npub,
      amount,
      transactionId,
      totalAttempts: this.metrics.mintingAttempts,
    });

    // Store attempt details for analysis
    this.storeMetricEvent("minting_attempt", {
      npub,
      amount,
      transactionId,
      timestamp: new Date(),
    });
  }

  /**
   * Track a successful minting operation
   * @param {string} npub - User's npub
   * @param {string} transactionId - Transaction ID
   * @param {Object} result - Minting result
   */
  static trackMintingSuccess(npub, transactionId, result) {
    this.metrics.mintingSuccesses++;

    logger.info("Tracking minting success", {
      npub,
      transactionId,
      totalSuccesses: this.metrics.mintingSuccesses,
      successRate: this.getMintingSuccessRate(),
    });

    this.storeMetricEvent("minting_success", {
      npub,
      transactionId,
      result,
      timestamp: new Date(),
    });
  }

  /**
   * Track a failed minting operation
   * @param {string} npub - User's npub
   * @param {string} transactionId - Transaction ID
   * @param {string} error - Error message
   */
  static trackMintingFailure(npub, transactionId, error) {
    this.metrics.mintingFailures++;

    logger.warn("Tracking minting failure", {
      npub,
      transactionId,
      error,
      totalFailures: this.metrics.mintingFailures,
      failureRate: this.getMintingFailureRate(),
    });

    this.storeMetricEvent("minting_failure", {
      npub,
      transactionId,
      error,
      timestamp: new Date(),
    });

    // Check if we need to send alerts
    this.checkFailureRateAlert();
  }

  /**
   * Track a completion attempt
   * @param {string} npub - User's npub
   * @param {string} transactionId - Transaction ID
   * @param {string} quoteId - Quote ID
   */
  static trackCompletionAttempt(npub, transactionId, quoteId) {
    this.metrics.completionAttempts++;

    logger.info("Tracking completion attempt", {
      npub,
      transactionId,
      quoteId,
      totalAttempts: this.metrics.completionAttempts,
    });

    this.storeMetricEvent("completion_attempt", {
      npub,
      transactionId,
      quoteId,
      timestamp: new Date(),
    });
  }

  /**
   * Track a successful completion
   * @param {string} npub - User's npub
   * @param {string} transactionId - Transaction ID
   * @param {number} completionTime - Time taken to complete (ms)
   * @param {Object} result - Completion result
   */
  static trackCompletionSuccess(npub, transactionId, completionTime, result) {
    this.metrics.completionSuccesses++;

    // Update average completion time
    this.updateAverageCompletionTime(completionTime);

    logger.info("Tracking completion success", {
      npub,
      transactionId,
      completionTime: `${completionTime}ms`,
      totalSuccesses: this.metrics.completionSuccesses,
      averageTime: `${this.metrics.averageCompletionTime}ms`,
    });

    this.storeMetricEvent("completion_success", {
      npub,
      transactionId,
      completionTime,
      result,
      timestamp: new Date(),
    });
  }

  /**
   * Track a failed completion
   * @param {string} npub - User's npub
   * @param {string} transactionId - Transaction ID
   * @param {string} error - Error message
   */
  static trackCompletionFailure(npub, transactionId, error) {
    this.metrics.completionFailures++;

    logger.warn("Tracking completion failure", {
      npub,
      transactionId,
      error,
      totalFailures: this.metrics.completionFailures,
    });

    this.storeMetricEvent("completion_failure", {
      npub,
      transactionId,
      error,
      timestamp: new Date(),
    });
  }

  /**
   * Get current minting metrics
   * @returns {Object} Current metrics
   */
  static getMintingMetrics() {
    const successRate = this.getMintingSuccessRate();
    const failureRate = this.getMintingFailureRate();
    const completionRate = this.getCompletionSuccessRate();

    return {
      minting: {
        attempts: this.metrics.mintingAttempts,
        successes: this.metrics.mintingSuccesses,
        failures: this.metrics.mintingFailures,
        successRate,
        failureRate,
      },
      completion: {
        attempts: this.metrics.completionAttempts,
        successes: this.metrics.completionSuccesses,
        failures: this.metrics.completionFailures,
        successRate: completionRate,
        averageTime: this.metrics.averageCompletionTime,
      },
      period: {
        since: this.metrics.lastReset,
        duration: Date.now() - this.metrics.lastReset.getTime(),
      },
    };
  }

  /**
   * Get detailed system health metrics
   * @returns {Promise<Object>} Health metrics
   */
  static async getHealthMetrics() {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Get stuck transaction counts
      const CashuToken = (await import("../models/CashuToken.model.js"))
        .default;

      const [totalPending, stuckOneHour, recentFailures, totalTransactions] =
        await Promise.all([
          CashuToken.countDocuments({
            transaction_type: "minted",
            status: "pending",
          }),
          CashuToken.countDocuments({
            transaction_type: "minted",
            status: "pending",
            created_at: { $lt: oneHourAgo },
          }),
          CashuToken.countDocuments({
            transaction_type: "minted",
            status: "failed",
            created_at: { $gte: oneDayAgo },
          }),
          CashuToken.countDocuments({
            transaction_type: "minted",
            created_at: { $gte: oneDayAgo },
          }),
        ]);

      const recentFailureRate =
        totalTransactions > 0 ? recentFailures / totalTransactions : 0;

      // Determine health status
      const alerts = [];
      let healthStatus = "healthy";

      if (
        stuckOneHour >=
        this.MONITORING_CONFIG.ALERT_THRESHOLDS.STUCK_TRANSACTIONS
      ) {
        alerts.push({
          type: "stuck_transactions",
          severity: "warning",
          message: `${stuckOneHour} transactions stuck for over 1 hour`,
          count: stuckOneHour,
        });
        healthStatus = "warning";
      }

      if (
        recentFailureRate >=
        this.MONITORING_CONFIG.ALERT_THRESHOLDS.FAILURE_RATE
      ) {
        alerts.push({
          type: "high_failure_rate",
          severity: "critical",
          message: `High failure rate: ${(recentFailureRate * 100).toFixed(
            1
          )}%`,
          rate: recentFailureRate,
        });
        healthStatus = "critical";
      }

      return {
        status: healthStatus,
        timestamp: now,
        metrics: {
          pending: {
            total: totalPending,
            stuckOneHour,
            healthy: totalPending - stuckOneHour,
          },
          recent24h: {
            total: totalTransactions,
            failures: recentFailures,
            failureRate: recentFailureRate,
          },
          runtime: this.getMintingMetrics(),
        },
        alerts,
      };
    } catch (error) {
      logger.error("Error getting health metrics", {
        error: error.message,
      });

      return {
        status: "error",
        timestamp: new Date(),
        error: error.message,
        alerts: [
          {
            type: "monitoring_error",
            severity: "critical",
            message: `Failed to get health metrics: ${error.message}`,
          },
        ],
      };
    }
  }

  /**
   * Check for stuck transactions and send alerts if needed
   * @returns {Promise<Object>} Alert check result
   */
  static async checkStuckTransactionAlerts() {
    try {
      const healthMetrics = await this.getHealthMetrics();
      const stuckCount = healthMetrics.metrics?.pending?.stuckOneHour || 0;

      if (
        stuckCount >= this.MONITORING_CONFIG.ALERT_THRESHOLDS.STUCK_TRANSACTIONS
      ) {
        const alert = {
          type: "stuck_transactions",
          severity: "warning",
          message: `${stuckCount} Lightning minting transactions stuck for over 1 hour`,
          count: stuckCount,
          timestamp: new Date(),
          action: "Consider running cleanup process",
        };

        logger.warn("ALERT: Stuck transactions detected", alert);

        // In production, send to alerting system (email, Slack, etc.)
        this.sendAlert(alert);

        return { alertSent: true, alert };
      }

      return { alertSent: false };
    } catch (error) {
      logger.error("Error checking stuck transaction alerts", {
        error: error.message,
      });
      return { alertSent: false, error: error.message };
    }
  }

  /**
   * Reset metrics (useful for testing or periodic resets)
   */
  static resetMetrics() {
    this.metrics = {
      mintingAttempts: 0,
      mintingSuccesses: 0,
      mintingFailures: 0,
      completionAttempts: 0,
      completionSuccesses: 0,
      completionFailures: 0,
      averageCompletionTime: 0,
      lastReset: new Date(),
    };

    logger.info("Monitoring metrics reset");
  }

  // Private helper methods

  static getMintingSuccessRate() {
    return this.metrics.mintingAttempts > 0
      ? this.metrics.mintingSuccesses / this.metrics.mintingAttempts
      : 0;
  }

  static getMintingFailureRate() {
    return this.metrics.mintingAttempts > 0
      ? this.metrics.mintingFailures / this.metrics.mintingAttempts
      : 0;
  }

  static getCompletionSuccessRate() {
    return this.metrics.completionAttempts > 0
      ? this.metrics.completionSuccesses / this.metrics.completionAttempts
      : 0;
  }

  static updateAverageCompletionTime(newTime) {
    if (this.metrics.completionSuccesses === 1) {
      this.metrics.averageCompletionTime = newTime;
    } else {
      // Running average calculation
      const totalTime =
        this.metrics.averageCompletionTime *
        (this.metrics.completionSuccesses - 1);
      this.metrics.averageCompletionTime =
        (totalTime + newTime) / this.metrics.completionSuccesses;
    }
  }

  static checkFailureRateAlert() {
    const failureRate = this.getMintingFailureRate();

    if (
      failureRate >= this.MONITORING_CONFIG.ALERT_THRESHOLDS.FAILURE_RATE &&
      this.metrics.mintingAttempts >= 10
    ) {
      // Only alert after at least 10 attempts

      const alert = {
        type: "high_failure_rate",
        severity: "critical",
        message: `High Lightning minting failure rate: ${(
          failureRate * 100
        ).toFixed(1)}%`,
        rate: failureRate,
        attempts: this.metrics.mintingAttempts,
        failures: this.metrics.mintingFailures,
        timestamp: new Date(),
      };

      logger.error("ALERT: High failure rate detected", alert);
      this.sendAlert(alert);
    }
  }

  static storeMetricEvent(type, data) {
    // In production, store in database or time-series DB
    logger.debug("Metric event", { type, ...data });
  }

  static sendAlert(alert) {
    // In production, integrate with alerting system
    logger.error("ALERT", alert);

    // Could integrate with:
    // - Email notifications
    // - Slack/Discord webhooks
    // - PagerDuty
    // - Custom alerting service
  }
}

export default MonitoringService;
