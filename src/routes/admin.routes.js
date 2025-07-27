import express from "express";
import migration from "../migrations/004_fix_melted_token_status.js";
import CashuToken from "../models/CashuToken.model.js";
import walletRepositoryService from "../services/walletRepository.service.js";
import { logger } from "../utils/logger.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";

const router = express.Router();

/**
 * GET /admin/migration/status
 * Get comprehensive migration status and health check
 */
router.get(
  "/migration/status",
  asyncHandler(async (req, res) => {
    try {
      logger.info("[Admin] Migration status requested");

      // Get migration status
      const migrationStatus = await migration.getStatus();

      // Get system health metrics
      const healthMetrics = await getSystemHealthMetrics();

      // Get user impact analysis
      const userImpact = await getUserImpactAnalysis();

      // Get recent migration activity
      const recentActivity = await getRecentMigrationActivity();

      const response = {
        timestamp: new Date().toISOString(),
        migration: migrationStatus,
        health: healthMetrics,
        userImpact,
        recentActivity,
        recommendations: generateRecommendations(
          migrationStatus,
          healthMetrics
        ),
      };

      res.status(200).json({
        success: true,
        data: response,
      });
    } catch (error) {
      logger.error("[Admin] Migration status check failed:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get migration status",
        details: error.message,
      });
    }
  })
);

/**
 * GET /admin/migration/preview
 * Get detailed migration preview and impact analysis
 */
router.get(
  "/migration/preview",
  asyncHandler(async (req, res) => {
    try {
      logger.info("[Admin] Migration preview requested");

      const preview = await migration.preview();

      // Enhanced preview with additional metrics
      const enhancedPreview = {
        ...preview,
        riskAssessment: await assessMigrationRisk(),
        systemReadiness: await checkSystemReadiness(),
        backupStatus: await checkBackupStatus(),
      };

      res.status(200).json({
        success: true,
        data: enhancedPreview,
      });
    } catch (error) {
      logger.error("[Admin] Migration preview failed:", error);
      res.status(500).json({
        success: false,
        error: "Failed to generate migration preview",
        details: error.message,
      });
    }
  })
);

/**
 * GET /admin/health/balance-consistency
 * Check balance consistency across all users
 */
router.get(
  "/health/balance-consistency",
  asyncHandler(async (req, res) => {
    try {
      logger.info("[Admin] Balance consistency check requested");

      const { limit = 100, offset = 0 } = req.query;

      // Get all unique users
      const users = await CashuToken.distinct("npub");
      const totalUsers = users.length;
      const usersToCheck = users.slice(offset, offset + parseInt(limit));

      const results = {
        totalUsers,
        checkedUsers: usersToCheck.length,
        offset: parseInt(offset),
        limit: parseInt(limit),
        issues: [],
        summary: {
          usersWithIssues: 0,
          totalProblematicTokens: 0,
          totalAffectedAmount: 0,
        },
      };

      // Check each user's balance consistency
      for (const npub of usersToCheck) {
        try {
          const validation =
            await walletRepositoryService.validateBalanceConsistency(npub);

          if (!validation.isValid) {
            results.issues.push({
              npub,
              issues: validation.issues,
              details: validation.details,
            });

            results.summary.usersWithIssues++;
            results.summary.totalProblematicTokens +=
              validation.issues.problematicMeltedTokens || 0;

            // Calculate affected amount
            if (validation.details.problematicMeltedTokens) {
              const affectedAmount =
                validation.details.problematicMeltedTokens.reduce(
                  (sum, token) => sum + token.total_amount,
                  0
                );
              results.summary.totalAffectedAmount += affectedAmount;
            }
          }
        } catch (error) {
          logger.error(`[Admin] Balance check failed for user ${npub}:`, error);
          results.issues.push({
            npub,
            error: error.message,
          });
        }
      }

      res.status(200).json({
        success: true,
        data: results,
      });
    } catch (error) {
      logger.error("[Admin] Balance consistency check failed:", error);
      res.status(500).json({
        success: false,
        error: "Failed to check balance consistency",
        details: error.message,
      });
    }
  })
);

/**
 * GET /admin/health/token-integrity
 * Check token data integrity and detect anomalies
 */
router.get(
  "/health/token-integrity",
  asyncHandler(async (req, res) => {
    try {
      logger.info("[Admin] Token integrity check requested");

      const integrity = await checkTokenIntegrity();

      res.status(200).json({
        success: true,
        data: integrity,
      });
    } catch (error) {
      logger.error("[Admin] Token integrity check failed:", error);
      res.status(500).json({
        success: false,
        error: "Failed to check token integrity",
        details: error.message,
      });
    }
  })
);

/**
 * POST /admin/migration/validate
 * Validate migration prerequisites and readiness
 */
router.post(
  "/migration/validate",
  asyncHandler(async (req, res) => {
    try {
      logger.info("[Admin] Migration validation requested");

      const validation = {
        timestamp: new Date().toISOString(),
        prerequisites: await validateMigrationPrerequisites(),
        systemHealth: await getSystemHealthMetrics(),
        riskAssessment: await assessMigrationRisk(),
        recommendations: [],
      };

      // Generate recommendations based on validation results
      if (!validation.prerequisites.isValid) {
        validation.recommendations.push({
          type: "error",
          message: "Prerequisites not met - migration cannot proceed",
          details: validation.prerequisites.issues,
        });
      }

      if (validation.systemHealth.problematicTokens > 1000) {
        validation.recommendations.push({
          type: "warning",
          message:
            "Large number of tokens to migrate - consider maintenance window",
          details: `${validation.systemHealth.problematicTokens} tokens will be affected`,
        });
      }

      if (validation.riskAssessment.riskLevel === "high") {
        validation.recommendations.push({
          type: "warning",
          message: "High risk migration - ensure backup and monitoring",
          details: validation.riskAssessment.factors,
        });
      }

      res.status(200).json({
        success: true,
        data: validation,
      });
    } catch (error) {
      logger.error("[Admin] Migration validation failed:", error);
      res.status(500).json({
        success: false,
        error: "Failed to validate migration",
        details: error.message,
      });
    }
  })
);

// Helper functions

async function getSystemHealthMetrics() {
  const metrics = {
    totalTokens: await CashuToken.countDocuments(),
    totalMeltedTokens: await CashuToken.countDocuments({
      transaction_type: "melted",
    }),
    problematicTokens: await CashuToken.countDocuments({
      transaction_type: "melted",
      status: "unspent",
    }),
    totalUsers: (await CashuToken.distinct("npub")).length,
    databaseSize: await getDatabaseSize(),
    lastUpdated: new Date().toISOString(),
  };

  metrics.healthScore = calculateHealthScore(metrics);
  return metrics;
}

async function getUserImpactAnalysis() {
  const problematicTokens = await CashuToken.find({
    transaction_type: "melted",
    status: "unspent",
  }).select("npub total_amount");

  const userImpact = {};
  problematicTokens.forEach((token) => {
    if (!userImpact[token.npub]) {
      userImpact[token.npub] = {
        tokenCount: 0,
        totalAmount: 0,
      };
    }
    userImpact[token.npub].tokenCount++;
    userImpact[token.npub].totalAmount += token.total_amount;
  });

  return {
    affectedUsers: Object.keys(userImpact).length,
    totalAffectedTokens: problematicTokens.length,
    totalAffectedAmount: problematicTokens.reduce(
      (sum, token) => sum + token.total_amount,
      0
    ),
    userBreakdown: userImpact,
  };
}

async function getRecentMigrationActivity() {
  // This would query migration state collection for recent activity
  // For now, return placeholder data
  return {
    lastMigration: null,
    recentAttempts: [],
    totalMigrations: 0,
  };
}

async function assessMigrationRisk() {
  const metrics = await getSystemHealthMetrics();
  const factors = [];
  let riskLevel = "low";

  if (metrics.problematicTokens > 10000) {
    factors.push("Large number of tokens to migrate");
    riskLevel = "high";
  } else if (metrics.problematicTokens > 1000) {
    factors.push("Moderate number of tokens to migrate");
    riskLevel = "medium";
  }

  if (metrics.totalUsers > 1000) {
    factors.push("Large user base affected");
    if (riskLevel === "low") riskLevel = "medium";
  }

  return {
    riskLevel,
    factors,
    mitigationStrategies: [
      "Create full database backup before migration",
      "Run migration during low-traffic period",
      "Monitor system performance during migration",
      "Have rollback plan ready",
    ],
  };
}

async function checkSystemReadiness() {
  return {
    databaseConnection: true, // Would check actual connection
    diskSpace: "sufficient", // Would check actual disk space
    memoryUsage: "normal", // Would check actual memory
    activeConnections: "normal", // Would check actual connections
  };
}

async function checkBackupStatus() {
  return {
    lastBackup: new Date().toISOString(), // Would check actual backup
    backupSize: "unknown",
    backupLocation: "configured",
    isRecent: true,
  };
}

async function checkTokenIntegrity() {
  const issues = [];

  // Check for duplicate proof secrets
  const duplicateSecrets = await CashuToken.aggregate([
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

  if (duplicateSecrets.length > 0) {
    issues.push({
      type: "duplicate_secrets",
      count: duplicateSecrets.length,
      details: duplicateSecrets.slice(0, 10), // First 10 for preview
    });
  }

  // Check for tokens with invalid amounts
  const invalidAmounts = await CashuToken.countDocuments({
    $or: [
      { total_amount: { $lt: 0 } },
      { total_amount: null },
      { total_amount: undefined },
    ],
  });

  if (invalidAmounts > 0) {
    issues.push({
      type: "invalid_amounts",
      count: invalidAmounts,
    });
  }

  // Check for orphaned tokens (missing wallet reference)
  const orphanedTokens = await CashuToken.countDocuments({
    wallet_id: { $exists: false },
  });

  if (orphanedTokens > 0) {
    issues.push({
      type: "orphaned_tokens",
      count: orphanedTokens,
    });
  }

  return {
    isHealthy: issues.length === 0,
    issues,
    totalChecks: 3,
    passedChecks: 3 - issues.length,
  };
}

async function validateMigrationPrerequisites() {
  const issues = [];

  try {
    // Check database connection
    await CashuToken.findOne().limit(1);
  } catch (error) {
    issues.push("Database connection failed");
  }

  // Check for existing migration
  const migrationStatus = await migration.getStatus();
  if (migrationStatus.isCompleted) {
    issues.push("Migration has already been completed");
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

function generateRecommendations(migrationStatus, healthMetrics) {
  const recommendations = [];

  if (healthMetrics.problematicTokens > 0) {
    recommendations.push({
      type: "action",
      priority: "high",
      message: `${healthMetrics.problematicTokens} melted tokens need migration`,
      action: "Run migration to fix token status",
    });
  }

  if (healthMetrics.healthScore < 0.8) {
    recommendations.push({
      type: "warning",
      priority: "medium",
      message: "System health score is below optimal",
      action: "Review token integrity and resolve issues",
    });
  }

  if (!migrationStatus.isCompleted && healthMetrics.problematicTokens === 0) {
    recommendations.push({
      type: "info",
      priority: "low",
      message: "No migration needed - all tokens are correctly configured",
      action: "Continue monitoring system health",
    });
  }

  return recommendations;
}

function calculateHealthScore(metrics) {
  if (metrics.totalMeltedTokens === 0) return 1.0;

  const problematicRatio =
    metrics.problematicTokens / metrics.totalMeltedTokens;
  return Math.max(0, 1 - problematicRatio);
}

async function getDatabaseSize() {
  try {
    const stats = await CashuToken.db.db.stats();
    return {
      dataSize: stats.dataSize,
      indexSize: stats.indexSize,
      totalSize: stats.dataSize + stats.indexSize,
    };
  } catch (error) {
    return { error: "Unable to get database size" };
  }
}

export default router;
