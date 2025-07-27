#!/usr/bin/env node

/**
 * Manual Migration Runner for 004_fix_melted_token_status
 *
 * Usage:
 *   node run_migration.js preview    # Preview migration impact
 *   node run_migration.js status     # Check migration status
 *   node run_migration.js up         # Execute migration
 *   node run_migration.js down       # Rollback migration
 */

import mongoose from "mongoose";
import migration from "./src/migrations/004_fix_melted_token_status_simple.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/nctool";

async function connectDatabase() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB:", MONGODB_URI);
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB:", error.message);
    process.exit(1);
  }
}

async function disconnectDatabase() {
  await mongoose.disconnect();
  console.log("🔌 Disconnected from MongoDB");
}

async function runMigration() {
  const command = process.argv[2];

  if (!command) {
    console.log(`
📋 Migration 004: Fix Melted Token Status

Usage:
  node run_migration.js preview    # Preview migration impact
  node run_migration.js status     # Check migration status  
  node run_migration.js up         # Execute migration
  node run_migration.js down       # Rollback migration

Environment:
  MONGODB_URI=${MONGODB_URI}
`);
    return;
  }

  await connectDatabase();

  try {
    switch (command) {
      case "preview":
        console.log("\n🔍 Generating migration preview...\n");
        const preview = await migration.preview();
        console.log("📊 Migration Preview:");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`Migration: ${preview.migration_name}`);
        console.log(`Total melted tokens: ${preview.stats.totalMeltedTokens}`);
        console.log(`Tokens to migrate: ${preview.stats.tokensToMigrate}`);
        console.log(
          `Total amount affected: ${preview.stats.totalAmountAffected} sats`
        );
        console.log(
          `Estimated execution time: ${preview.estimatedExecutionTime}`
        );

        if (preview.stats.tokensToMigrate > 0) {
          console.log("\n👥 User Impact:");
          Object.entries(preview.userImpact).forEach(([npub, impact]) => {
            console.log(
              `  ${npub.substring(0, 20)}...: ${impact.tokenCount} tokens, ${
                impact.totalAmount
              } sats`
            );
          });

          console.log("\n📝 Sample Tokens:");
          preview.sampleTokens.slice(0, 3).forEach((token) => {
            console.log(
              `  ${token.transaction_id}: ${token.total_amount} sats (${token.created_at})`
            );
          });
        }
        break;

      case "status":
        console.log("\n📊 Checking migration status...\n");
        const status = await migration.getStatus();
        console.log("📈 Migration Status:");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`Migration: ${status.migration_name} v${status.version}`);
        console.log(`Status: ${status.state?.status || "Not started"}`);
        console.log(
          `Migration needed: ${status.migrationNeeded ? "YES" : "NO"}`
        );
        console.log(`Completed: ${status.isCompleted ? "YES" : "NO"}`);
        console.log(`Total melted tokens: ${status.stats.totalMeltedTokens}`);
        console.log(`Problematic tokens: ${status.stats.problematicTokens}`);
        console.log(`Spent melted tokens: ${status.stats.spentMeltedTokens}`);

        if (status.state) {
          console.log(`Started: ${status.state.started_at}`);
          if (status.state.completed_at) {
            console.log(`Completed: ${status.state.completed_at}`);
          }
          if (status.state.execution_time_ms) {
            console.log(`Execution time: ${status.state.execution_time_ms}ms`);
          }
          if (status.state.affected_tokens) {
            console.log(`Affected tokens: ${status.state.affected_tokens}`);
          }
        }
        break;

      case "up":
        console.log("\n🚀 Executing migration...\n");
        const upResult = await migration.up();
        console.log("✅ Migration completed successfully!");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`Affected tokens: ${upResult.affectedTokens}`);
        console.log(`Execution time: ${upResult.executionTimeMs}ms`);
        break;

      case "down":
        console.log("\n⏪ Rolling back migration...\n");
        const downResult = await migration.down();
        console.log("✅ Migration rollback completed successfully!");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`Restored tokens: ${downResult.restoredTokens}`);
        console.log(`Execution time: ${downResult.executionTimeMs}ms`);
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.log("Valid commands: preview, status, up, down");
        process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

// Handle process termination
process.on("SIGINT", async () => {
  console.log("\n🛑 Received SIGINT, shutting down gracefully...");
  await disconnectDatabase();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
  await disconnectDatabase();
  process.exit(0);
});

// Run the migration
runMigration().catch(async (error) => {
  console.error("💥 Unexpected error:", error);
  await disconnectDatabase();
  process.exit(1);
});
