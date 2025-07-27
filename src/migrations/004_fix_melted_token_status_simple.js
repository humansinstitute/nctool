import mongoose from "mongoose";
import CashuToken from "../models/CashuToken.model.js";
import { logger } from "../utils/logger.js";

/**
 * Simplified Migration 004: Fix Melted Token Status
 *
 * This version works without MongoDB transactions for testing environments
 * while maintaining the same functionality and safety measures.
 */

const MIGRATION_NAME = "004_fix_melted_token_status";
const MIGRATION_VERSION = "1.0.0";

/**
 * Migration state tracking collection
 */
const MigrationStateSchema = new mongoose.Schema(
  {
    migration_name: { type: String, required: true, unique: true },
    version: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed", "rolled_back"],
      default: "pending",
    },
    started_at: { type: Date },
    completed_at: { type: Date },
    affected_tokens: { type: Number, default: 0 },
    backup_data: { type: mongoose.Schema.Types.Mixed },
    error_message: { type: String },
    execution_time_ms: { type: Number },
  },
  { timestamps: true }
);

const MigrationState = mongoose.model("MigrationState", MigrationStateSchema);

/**
 * Check if MongoDB transactions are supported
 */
async function checkTransactionSupport() {
  try {
    const session = await mongoose.startSession();
    await session.endSession();
    return true;
  } catch (error) {
    logger.warn(
      `[${MIGRATION_NAME}] Transactions not supported: ${error.message}`
    );
    return false;
  }
}

/**
 * Create backup of tokens that will be modified
 */
async function createBackup() {
  logger.info(
    `[${MIGRATION_NAME}] Creating backup of melted tokens with unspent status`
  );

  const tokensToBackup = await CashuToken.find({
    transaction_type: "melted",
    status: "unspent",
  });

  const backup = {
    timestamp: new Date(),
    tokens: tokensToBackup.map((token) => ({
      _id: token._id,
      status: token.status,
      spent_at: token.spent_at,
      npub: token.npub,
      transaction_id: token.transaction_id,
      total_amount: token.total_amount,
      mint_url: token.mint_url,
    })),
  };

  logger.info(
    `[${MIGRATION_NAME}] Backup created for ${backup.tokens.length} tokens`
  );
  return backup;
}

/**
 * Validate migration prerequisites
 */
async function validatePrerequisites() {
  logger.info(`[${MIGRATION_NAME}] Validating migration prerequisites`);

  const validation = {
    isValid: true,
    issues: [],
    stats: {},
  };

  try {
    // Count tokens that need migration
    const problematicTokens = await CashuToken.countDocuments({
      transaction_type: "melted",
      status: "unspent",
    });

    validation.stats.problematicTokens = problematicTokens;
    validation.stats.totalMeltedTokens = await CashuToken.countDocuments({
      transaction_type: "melted",
    });

    // Check database connection
    if (mongoose.connection.readyState !== 1) {
      validation.isValid = false;
      validation.issues.push("Database connection not ready");
    }

    logger.info(`[${MIGRATION_NAME}] Prerequisites validation:`, validation);
    return validation;
  } catch (error) {
    validation.isValid = false;
    validation.issues.push(`Validation error: ${error.message}`);
    logger.error(`[${MIGRATION_NAME}] Prerequisites validation failed:`, error);
    return validation;
  }
}

/**
 * Execute the migration (UP direction)
 */
export async function up(options = {}) {
  const startTime = Date.now();

  let migrationState = null;
  let result = {
    success: false,
    affectedTokens: 0,
    executionTimeMs: 0,
    error: null,
  };

  try {
    logger.info(`[${MIGRATION_NAME}] Starting UP migration`);

    // Try to create migration state atomically to prevent concurrent execution
    try {
      migrationState = await MigrationState.create({
        migration_name: MIGRATION_NAME,
        version: MIGRATION_VERSION,
        status: "running",
        started_at: new Date(),
        affected_tokens: 0,
        error_message: null,
      });
    } catch (error) {
      // If creation fails due to unique constraint, check existing state
      if (error.code === 11000) {
        const existingMigration = await MigrationState.findOne({
          migration_name: MIGRATION_NAME,
        });

        if (existingMigration && existingMigration.status === "completed") {
          throw new Error("Migration has already been completed");
        } else if (
          existingMigration &&
          existingMigration.status === "running"
        ) {
          throw new Error("Migration is already running");
        } else {
          // Migration exists but failed, we can retry
          migrationState = await MigrationState.findOneAndUpdate(
            { migration_name: MIGRATION_NAME },
            {
              status: "running",
              started_at: new Date(),
              error_message: null,
            },
            { new: true }
          );
        }
      } else {
        throw error;
      }
    }

    // Validate prerequisites after securing migration state
    const validation = await validatePrerequisites();
    if (!validation.isValid) {
      // Update state to failed before throwing
      await MigrationState.findByIdAndUpdate(migrationState._id, {
        status: "failed",
        error_message: `Prerequisites failed: ${validation.issues.join(", ")}`,
      });
      throw new Error(
        `Migration prerequisites failed: ${validation.issues.join(", ")}`
      );
    }

    // Create backup
    const backup = await createBackup();
    migrationState.backup_data = backup;
    await migrationState.save();

    if (backup.tokens.length === 0) {
      logger.info(`[${MIGRATION_NAME}] No tokens need migration`);
      result.success = true;
      result.affectedTokens = 0;

      migrationState.status = "completed";
      migrationState.completed_at = new Date();
      migrationState.execution_time_ms = Date.now() - startTime;
      await migrationState.save();

      result.executionTimeMs = Date.now() - startTime;
      return result;
    }

    // Perform the migration
    logger.info(
      `[${MIGRATION_NAME}] Updating ${backup.tokens.length} melted tokens to spent status`
    );

    const updateResult = await CashuToken.updateMany(
      {
        transaction_type: "melted",
        status: "unspent",
      },
      {
        $set: {
          status: "spent",
          spent_at: new Date(),
        },
      }
    );

    logger.info(`[${MIGRATION_NAME}] Migration completed:`, {
      matchedCount: updateResult.matchedCount,
      modifiedCount: updateResult.modifiedCount,
      acknowledged: updateResult.acknowledged,
    });

    // Validate the migration results
    const remainingProblematic = await CashuToken.countDocuments({
      transaction_type: "melted",
      status: "unspent",
    });

    if (remainingProblematic > 0) {
      throw new Error(
        `Migration incomplete: ${remainingProblematic} tokens still have unspent status`
      );
    }

    // Update migration state
    migrationState.status = "completed";
    migrationState.completed_at = new Date();
    migrationState.affected_tokens = updateResult.modifiedCount;
    migrationState.execution_time_ms = Date.now() - startTime;
    await migrationState.save();

    result.success = true;
    result.affectedTokens = updateResult.modifiedCount;
    result.executionTimeMs = Date.now() - startTime;

    logger.info(
      `[${MIGRATION_NAME}] Migration UP completed successfully:`,
      result
    );
  } catch (error) {
    logger.error(`[${MIGRATION_NAME}] Migration UP failed:`, error);

    result.error = error.message;
    result.executionTimeMs = Date.now() - startTime;

    // Update migration state to failed
    if (migrationState) {
      try {
        await MigrationState.findByIdAndUpdate(migrationState._id, {
          status: "failed",
          error_message: error.message,
          execution_time_ms: Date.now() - startTime,
        });
      } catch (stateError) {
        logger.error(
          `[${MIGRATION_NAME}] Failed to update migration state:`,
          stateError
        );
      }
    }

    throw error;
  }

  return result;
}

/**
 * Rollback the migration (DOWN direction)
 */
export async function down(options = {}) {
  const startTime = Date.now();

  let result = {
    success: false,
    restoredTokens: 0,
    executionTimeMs: 0,
    error: null,
  };

  try {
    logger.info(`[${MIGRATION_NAME}] Starting DOWN migration (rollback)`);

    // Find migration state
    const migrationState = await MigrationState.findOne({
      migration_name: MIGRATION_NAME,
    });

    if (!migrationState) {
      throw new Error("Migration state not found - cannot rollback");
    }

    if (migrationState.status !== "completed") {
      throw new Error(
        `Cannot rollback migration with status: ${migrationState.status}`
      );
    }

    if (!migrationState.backup_data || !migrationState.backup_data.tokens) {
      throw new Error("No backup data found - cannot rollback safely");
    }

    const backup = migrationState.backup_data;
    logger.info(
      `[${MIGRATION_NAME}] Restoring ${backup.tokens.length} tokens from backup`
    );

    // Restore each token from backup
    let restoredCount = 0;
    for (const backupToken of backup.tokens) {
      const updateResult = await CashuToken.updateOne(
        { _id: backupToken._id },
        {
          $set: {
            status: backupToken.status,
            spent_at: backupToken.spent_at,
          },
        }
      );

      if (updateResult.modifiedCount > 0) {
        restoredCount++;
      }
    }

    // Update migration state
    migrationState.status = "rolled_back";
    migrationState.completed_at = new Date();
    migrationState.execution_time_ms = Date.now() - startTime;
    await migrationState.save();

    result.success = true;
    result.restoredTokens = restoredCount;
    result.executionTimeMs = Date.now() - startTime;

    logger.info(
      `[${MIGRATION_NAME}] Migration DOWN completed successfully:`,
      result
    );
  } catch (error) {
    logger.error(`[${MIGRATION_NAME}] Migration DOWN failed:`, error);

    result.error = error.message;
    result.executionTimeMs = Date.now() - startTime;

    throw error;
  }

  return result;
}

/**
 * Get migration status and statistics
 */
export async function getStatus() {
  try {
    const migrationState = await MigrationState.findOne({
      migration_name: MIGRATION_NAME,
    });

    const stats = {
      totalMeltedTokens: await CashuToken.countDocuments({
        transaction_type: "melted",
      }),
      problematicTokens: await CashuToken.countDocuments({
        transaction_type: "melted",
        status: "unspent",
      }),
      spentMeltedTokens: await CashuToken.countDocuments({
        transaction_type: "melted",
        status: "spent",
      }),
    };

    return {
      migration_name: MIGRATION_NAME,
      version: MIGRATION_VERSION,
      state: migrationState,
      stats,
      migrationNeeded: stats.problematicTokens > 0,
      isCompleted: migrationState?.status === "completed",
    };
  } catch (error) {
    logger.error(`[${MIGRATION_NAME}] Failed to get status:`, error);
    throw error;
  }
}

/**
 * Preview migration impact without executing
 */
export async function preview() {
  try {
    logger.info(`[${MIGRATION_NAME}] Generating migration preview`);

    const problematicTokens = await CashuToken.find({
      transaction_type: "melted",
      status: "unspent",
    }).select("_id npub transaction_id total_amount mint_url created_at");

    const stats = {
      totalMeltedTokens: await CashuToken.countDocuments({
        transaction_type: "melted",
      }),
      tokensToMigrate: problematicTokens.length,
      totalAmountAffected: problematicTokens.reduce(
        (sum, token) => sum + token.total_amount,
        0
      ),
    };

    // Group by user for impact analysis
    const userImpact = {};
    problematicTokens.forEach((token) => {
      if (!userImpact[token.npub]) {
        userImpact[token.npub] = {
          tokenCount: 0,
          totalAmount: 0,
          transactions: [],
        };
      }
      userImpact[token.npub].tokenCount++;
      userImpact[token.npub].totalAmount += token.total_amount;
      userImpact[token.npub].transactions.push({
        transaction_id: token.transaction_id,
        amount: token.total_amount,
        created_at: token.created_at,
      });
    });

    return {
      migration_name: MIGRATION_NAME,
      stats,
      userImpact,
      sampleTokens: problematicTokens.slice(0, 10), // First 10 for preview
      estimatedExecutionTime: `${Math.ceil(
        problematicTokens.length / 100
      )} seconds`,
    };
  } catch (error) {
    logger.error(`[${MIGRATION_NAME}] Failed to generate preview:`, error);
    throw error;
  }
}

export default {
  up,
  down,
  getStatus,
  preview,
  MIGRATION_NAME,
  MIGRATION_VERSION,
};
