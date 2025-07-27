import CashuToken from "../models/CashuToken.model.js";
import walletRepositoryService from "./walletRepository.service.js";
import migration from "../migrations/004_fix_melted_token_status.js";
import { logger } from "../utils/logger.js";
import mongoose from "mongoose";

/**
 * Migration Monitoring Service
 *
 * Provides real-time monitoring and alerting for migration status,
 * balance consistency, and data integrity issues.
 */

class MigrationMonitoringService {
  constructor() {
    this.alertThresholds = {
      problematicTokens: 10,
      balanceDiscrepancy: 1000, // sats
      duplicateSecrets: 1,
      executionTimeWarning: 30000, // 30 seconds
      executionTimeError: 300000, // 5 minutes
    };

    this.monitoringInterval = null;
    this.isMonitoring = false;
  }

  /**
   * Start continuous monitoring
   * @param {number} intervalMs - Monitoring interval in milliseconds
   */
  startMonitoring(intervalMs = 60000) {
    // Default: 1 minute
    if (this.isMonitoring) {
      logger.warn("[MigrationMonitoring] Monitoring already active");
      return;
    }

    logger.info(
      `[MigrationMonitoring] Starting monitoring with ${intervalMs}ms interval`
    );
    this.isMonitoring = true;

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error("[MigrationMonitoring] Health check failed:", error);
      }
    }, intervalMs);
  }

  /**
   * Stop continuous monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;
    logger.info("[MigrationMonitoring] Monitoring stopped");
  }

  /**
   * Perform comprehensive health check
   * @returns {Promise<Object>} Health check results
   */
  async performHealthCheck() {
    const startTime = Date.now();
    logger.info("[MigrationMonitoring] Starting health check");

    try {
      const results = {
        timestamp: new Date().toISOString(),
        migrationStatus: await this.checkMigrationStatus(),
        balanceConsistency: await this.checkBalanceConsistency(),
        dataIntegrity: await this.checkDataIntegrity(),
        systemHealth: await this.checkSystemHealth(),
        alerts: [],
      };

      // Generate alerts based on results
      results.alerts = this.generateAlerts(results);

      // Log alerts
      if (results.alerts.length > 0) {
        logger.warn(
          `[MigrationMonitoring] ${results.alerts.length} alerts generated:`,
          results.alerts
        );
      }

      const executionTime = Date.now() - startTime;
      logger.info(
        `[MigrationMonitoring] Health check completed in ${executionTime}ms`
      );

      return results;
    } catch (error) {
      logger.error("[MigrationMonitoring] Health check failed:", error);
      throw error;
    }
  }

  /**
   * Check migration status and progress
   * @returns {Promise<Object>} Migration status
   */
  async checkMigrationStatus() {
    try {
      const status = await migration.getStatus();

      return {
        isCompleted: status.isCompleted,
        migrationNeeded: status.migrationNeeded,
        problematicTokens: status.stats.problematicTokens,
        totalMeltedTokens: status.stats.totalMeltedTokens,
        spentMeltedTokens: status.stats.spentMeltedTokens,
        migrationState: status.state,
      };
    } catch (error) {
      logger.error(
        "[MigrationMonitoring] Migration status check failed:",
        error
      );
      return {
        error: error.message,
        isCompleted: false,
        migrationNeeded: true,
      };
    }
  }

  /**
   * Check balance consistency across users
   * @param {number} sampleSize - Number of users to check
   * @returns {Promise<Object>} Balance consistency results
   */
  async checkBalanceConsistency(sampleSize = 50) {
    try {
      const users = await CashuToken.distinct("npub");
      const sampleUsers = this.sampleArray(users, sampleSize);

      const results = {
        totalUsers: users.length,
        checkedUsers: sampleUsers.length,
        usersWithIssues: 0,
        totalIssues: 0,
        issueTypes: {
          problematicMeltedTokens: 0,
          duplicateSecrets: 0,
          negativeBalance: 0,
        },
        sampleIssues: [],
      };

      for (const npub of sampleUsers) {
        try {
          const validation =
            await walletRepositoryService.validateBalanceConsistency(npub);

          if (!validation.isValid) {
            results.usersWithIssues++;
            results.totalIssues += Object.values(validation.issues).reduce(
              (sum, count) => sum + count,
              0
            );

            // Track issue types
            if (validation.issues.problematicMeltedTokens > 0) {
              results.issueTypes.problematicMeltedTokens +=
                validation.issues.problematicMeltedTokens;
            }
            if (validation.issues.duplicateSecrets > 0) {
              results.issueTypes.duplicateSecrets +=
                validation.issues.duplicateSecrets;
            }
            if (validation.issues.hasNegativeBalance) {
              results.issueTypes.negativeBalance++;
            }

            // Store sample issues for analysis
            if (results.sampleIssues.length < 10) {
              results.sampleIssues.push({
                npub: npub.substring(0, 20) + "...",
                issues: validation.issues,
                details: validation.details,
              });
            }
          }
        } catch (error) {
          logger.error(
            `[MigrationMonitoring] Balance check failed for user ${npub}:`,
            error
          );
        }
      }

      return results;
    } catch (error) {
      logger.error(
        "[MigrationMonitoring] Balance consistency check failed:",
        error
      );
      return {
        error: error.message,
        totalUsers: 0,
        checkedUsers: 0,
        usersWithIssues: 0,
      };
    }
  }

  /**
   * Check data integrity issues
   * @returns {Promise<Object>} Data integrity results
   */
  async checkDataIntegrity() {
    try {
      const results = {
        duplicateSecrets: await this.findDuplicateSecrets(),
        orphanedTokens: await this.findOrphanedTokens(),
        invalidAmounts: await this.findInvalidAmounts(),
        missingMetadata: await this.findMissingMetadata(),
        inconsistentStatus: await this.findInconsistentStatus(),
      };

      results.totalIssues = Object.values(results).reduce(
        (sum, issue) => sum + issue.count,
        0
      );
      results.isHealthy = results.totalIssues === 0;

      return results;
    } catch (error) {
      logger.error("[MigrationMonitoring] Data integrity check failed:", error);
      return {
        error: error.message,
        totalIssues: -1,
        isHealthy: false,
      };
    }
  }

  /**
   * Check system health metrics
   * @returns {Promise<Object>} System health results
   */
  async checkSystemHealth() {
    try {
      const results = {
        databaseConnection: await this.checkDatabaseConnection(),
        collectionStats: await this.getCollectionStats(),
        indexHealth: await this.checkIndexHealth(),
        recentErrors: await this.getRecentErrors(),
      };

      results.overallHealth = this.calculateOverallHealth(results);

      return results;
    } catch (error) {
      logger.error("[MigrationMonitoring] System health check failed:", error);
      return {
        error: error.message,
        overallHealth: "unhealthy",
      };
    }
  }

  /**
   * Generate alerts based on monitoring results
   * @param {Object} results - Health check results
   * @returns {Array} Array of alert objects
   */
  generateAlerts(results) {
    const alerts = [];

    // Migration status alerts
    if (
      results.migrationStatus.problematicTokens >
      this.alertThresholds.problematicTokens
    ) {
      alerts.push({
        type: "warning",
        category: "migration",
        message: `${results.migrationStatus.problematicTokens} melted tokens need migration`,
        severity: "high",
        action: "Execute migration to fix token status",
      });
    }

    // Balance consistency alerts
    if (results.balanceConsistency.usersWithIssues > 0) {
      alerts.push({
        type: "warning",
        category: "balance",
        message: `${results.balanceConsistency.usersWithIssues} users have balance inconsistencies`,
        severity: "medium",
        action: "Review balance validation and consider migration",
      });
    }

    // Data integrity alerts
    if (
      results.dataIntegrity.duplicateSecrets?.count >
      this.alertThresholds.duplicateSecrets
    ) {
      alerts.push({
        type: "error",
        category: "integrity",
        message: `${results.dataIntegrity.duplicateSecrets.count} duplicate proof secrets detected`,
        severity: "high",
        action: "Investigate and resolve duplicate secrets immediately",
      });
    }

    if (results.dataIntegrity.orphanedTokens?.count > 0) {
      alerts.push({
        type: "warning",
        category: "integrity",
        message: `${results.dataIntegrity.orphanedTokens.count} orphaned tokens found`,
        severity: "medium",
        action: "Clean up orphaned tokens",
      });
    }

    // System health alerts
    if (results.systemHealth.overallHealth === "unhealthy") {
      alerts.push({
        type: "error",
        category: "system",
        message: "System health is degraded",
        severity: "high",
        action: "Check database connection and system resources",
      });
    }

    return alerts;
  }

  /**
   * Get real-time migration progress
   * @returns {Promise<Object>} Migration progress
   */
  async getMigrationProgress() {
    try {
      const MigrationState = mongoose.model("MigrationState");
      const migrationState = await MigrationState.findOne({
        migration_name: "004_fix_melted_token_status",
      });

      if (!migrationState) {
        return {
          status: "not_started",
          progress: 0,
          message: "Migration has not been started",
        };
      }

      const progress = {
        status: migrationState.status,
        startedAt: migrationState.started_at,
        completedAt: migrationState.completed_at,
        affectedTokens: migrationState.affected_tokens,
        executionTime: migrationState.execution_time_ms,
        errorMessage: migrationState.error_message,
      };

      // Calculate progress percentage
      if (migrationState.status === "completed") {
        progress.progress = 100;
        progress.message = `Migration completed successfully. ${migrationState.affected_tokens} tokens updated.`;
      } else if (migrationState.status === "running") {
        progress.progress = 50; // Estimate for running state
        progress.message = "Migration is currently running...";
      } else if (migrationState.status === "failed") {
        progress.progress = 0;
        progress.message = `Migration failed: ${migrationState.error_message}`;
      } else {
        progress.progress = 0;
        progress.message = `Migration status: ${migrationState.status}`;
      }

      return progress;
    } catch (error) {
      logger.error(
        "[MigrationMonitoring] Failed to get migration progress:",
        error
      );
      return {
        status: "error",
        progress: 0,
        message: `Error getting progress: ${error.message}`,
      };
    }
  }

  /**
   * Get migration impact summary
   * @returns {Promise<Object>} Impact summary
   */
  async getImpactSummary() {
    try {
      const summary = {
        beforeMigration: {
          totalMeltedTokens: 0,
          unspentMeltedTokens: 0,
          spentMeltedTokens: 0,
          affectedUsers: 0,
          totalAffectedAmount: 0,
        },
        afterMigration: {
          totalMeltedTokens: 0,
          unspentMeltedTokens: 0,
          spentMeltedTokens: 0,
          fixedTokens: 0,
        },
        improvement: {
          tokensFixed: 0,
          usersHelped: 0,
          balancesCorrected: 0,
        },
      };

      // Get current state
      const currentStats = await migration.getStatus();
      summary.afterMigration.totalMeltedTokens =
        currentStats.stats.totalMeltedTokens;
      summary.afterMigration.unspentMeltedTokens =
        currentStats.stats.problematicTokens;
      summary.afterMigration.spentMeltedTokens =
        currentStats.stats.spentMeltedTokens;

      // Get migration state for before/after comparison
      const MigrationState = mongoose.model("MigrationState");
      const migrationState = await MigrationState.findOne({
        migration_name: "004_fix_melted_token_status",
      });

      if (migrationState && migrationState.backup_data) {
        summary.beforeMigration.unspentMeltedTokens =
          migrationState.backup_data.tokens.length;
        summary.beforeMigration.totalMeltedTokens =
          summary.afterMigration.totalMeltedTokens;
        summary.beforeMigration.spentMeltedTokens =
          summary.afterMigration.spentMeltedTokens -
          migrationState.affected_tokens;

        // Calculate improvements
        summary.improvement.tokensFixed = migrationState.affected_tokens;
        summary.improvement.usersHelped = new Set(
          migrationState.backup_data.tokens.map((t) => t.npub)
        ).size;
        summary.improvement.balancesCorrected =
          migrationState.backup_data.tokens.reduce(
            (sum, token) => sum + token.total_amount,
            0
          );
      }

      return summary;
    } catch (error) {
      logger.error(
        "[MigrationMonitoring] Failed to get impact summary:",
        error
      );
      throw error;
    }
  }

  // Helper methods

  async findDuplicateSecrets() {
    const duplicates = await CashuToken.aggregate([
      { $unwind: "$proofs" },
      {
        $group: {
          _id: "$proofs.secret",
          count: { $sum: 1 },
          tokens: { $push: "$_id" },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]);

    return {
      count: duplicates.length,
      samples: duplicates.slice(0, 5),
    };
  }

  async findOrphanedTokens() {
    const count = await CashuToken.countDocuments({
      wallet_id: { $exists: false },
    });

    return { count };
  }

  async findInvalidAmounts() {
    const count = await CashuToken.countDocuments({
      $or: [
        { total_amount: { $lt: 0 } },
        { total_amount: null },
        { total_amount: undefined },
      ],
    });

    return { count };
  }

  async findMissingMetadata() {
    const count = await CashuToken.countDocuments({
      $or: [
        { metadata: { $exists: false } },
        { "metadata.source": { $exists: false } },
      ],
    });

    return { count };
  }

  async findInconsistentStatus() {
    const count = await CashuToken.countDocuments({
      transaction_type: "melted",
      status: "unspent",
    });

    return { count };
  }

  async checkDatabaseConnection() {
    try {
      await CashuToken.findOne().limit(1);
      return { status: "healthy", message: "Database connection active" };
    } catch (error) {
      return { status: "unhealthy", message: error.message };
    }
  }

  async getCollectionStats() {
    try {
      const stats = await CashuToken.db.db.stats();
      return {
        collections: stats.collections,
        dataSize: stats.dataSize,
        indexSize: stats.indexSize,
        totalSize: stats.dataSize + stats.indexSize,
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async checkIndexHealth() {
    try {
      const indexes = await CashuToken.collection.getIndexes();
      return {
        indexCount: Object.keys(indexes).length,
        indexes: Object.keys(indexes),
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async getRecentErrors() {
    // This would integrate with your logging system
    // For now, return placeholder
    return {
      errorCount: 0,
      recentErrors: [],
    };
  }

  calculateOverallHealth(results) {
    if (results.databaseConnection.status === "unhealthy") {
      return "unhealthy";
    }

    if (results.collectionStats.error || results.indexHealth.error) {
      return "degraded";
    }

    return "healthy";
  }

  sampleArray(array, size) {
    if (array.length <= size) return array;

    const shuffled = [...array].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, size);
  }
}

// Export singleton instance
const migrationMonitoringService = new MigrationMonitoringService();
export default migrationMonitoringService;
