#!/usr/bin/env node

import { program } from "commander";
import mongoose from "mongoose";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import Table from "cli-table3";
import migration from "../migrations/004_fix_melted_token_status.js";
import { logger } from "../utils/logger.js";

// Database connection
const connectDB = async () => {
  try {
    const mongoURI =
      process.env.MONGODB_URI || "mongodb://localhost:27017/nctool";
    await mongoose.connect(mongoURI);
    console.log(chalk.green("✓ Connected to MongoDB"));
  } catch (error) {
    console.error(chalk.red("✗ MongoDB connection failed:"), error.message);
    process.exit(1);
  }
};

// Disconnect from database
const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log(chalk.gray("✓ Disconnected from MongoDB"));
  } catch (error) {
    console.error(chalk.red("✗ MongoDB disconnection failed:"), error.message);
  }
};

// Format duration in human readable format
const formatDuration = (ms) => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

// Format numbers with commas
const formatNumber = (num) => {
  return num.toLocaleString();
};

// Display migration status
const displayStatus = async () => {
  const spinner = ora("Checking migration status...").start();

  try {
    const status = await migration.getStatus();
    spinner.stop();

    console.log(chalk.blue.bold("\n📊 Migration Status Report"));
    console.log(chalk.blue("=".repeat(50)));

    // Migration state table
    const stateTable = new Table({
      head: [chalk.cyan("Property"), chalk.cyan("Value")],
      colWidths: [25, 40],
    });

    stateTable.push(
      ["Migration Name", status.migration_name],
      ["Version", status.version],
      [
        "Status",
        status.state
          ? status.state.status === "completed"
            ? chalk.green(status.state.status)
            : status.state.status === "failed"
            ? chalk.red(status.state.status)
            : chalk.yellow(status.state.status)
          : chalk.gray("Not started"),
      ],
      [
        "Migration Needed",
        status.migrationNeeded ? chalk.red("Yes") : chalk.green("No"),
      ],
      ["Completed", status.isCompleted ? chalk.green("Yes") : chalk.red("No")]
    );

    if (status.state) {
      stateTable.push(
        [
          "Started At",
          status.state.started_at
            ? new Date(status.state.started_at).toLocaleString()
            : "N/A",
        ],
        [
          "Completed At",
          status.state.completed_at
            ? new Date(status.state.completed_at).toLocaleString()
            : "N/A",
        ],
        ["Affected Tokens", formatNumber(status.state.affected_tokens || 0)],
        [
          "Execution Time",
          status.state.execution_time_ms
            ? formatDuration(status.state.execution_time_ms)
            : "N/A",
        ]
      );

      if (status.state.error_message) {
        stateTable.push(["Error", chalk.red(status.state.error_message)]);
      }
    }

    console.log(stateTable.toString());

    // Statistics table
    console.log(chalk.blue.bold("\n📈 Token Statistics"));
    const statsTable = new Table({
      head: [chalk.cyan("Metric"), chalk.cyan("Count")],
      colWidths: [30, 15],
    });

    statsTable.push(
      ["Total Melted Tokens", formatNumber(status.stats.totalMeltedTokens)],
      [
        "Problematic Tokens",
        status.stats.problematicTokens > 0
          ? chalk.red(formatNumber(status.stats.problematicTokens))
          : chalk.green("0"),
      ],
      [
        "Correctly Spent Tokens",
        chalk.green(formatNumber(status.stats.spentMeltedTokens)),
      ]
    );

    console.log(statsTable.toString());

    if (status.stats.problematicTokens > 0) {
      console.log(chalk.yellow.bold("\n⚠️  Migration Required"));
      console.log(
        chalk.yellow(
          `${status.stats.problematicTokens} melted tokens have incorrect 'unspent' status`
        )
      );
      console.log(
        chalk.gray("Run 'npm run migration preview' to see detailed impact")
      );
      console.log(
        chalk.gray("Run 'npm run migration up --confirm' to execute migration")
      );
    } else {
      console.log(chalk.green.bold("\n✅ All tokens are correctly configured"));
    }
  } catch (error) {
    spinner.fail("Failed to get migration status");
    console.error(chalk.red("Error:"), error.message);
    process.exit(1);
  }
};

// Display migration preview
const displayPreview = async () => {
  const spinner = ora("Generating migration preview...").start();

  try {
    const preview = await migration.preview();
    spinner.stop();

    console.log(chalk.blue.bold("\n🔍 Migration Preview"));
    console.log(chalk.blue("=".repeat(50)));

    // Impact summary
    const summaryTable = new Table({
      head: [chalk.cyan("Impact Summary"), chalk.cyan("Value")],
      colWidths: [30, 20],
    });

    summaryTable.push(
      ["Total Melted Tokens", formatNumber(preview.stats.totalMeltedTokens)],
      [
        "Tokens to Migrate",
        chalk.yellow(formatNumber(preview.stats.tokensToMigrate)),
      ],
      [
        "Total Amount Affected",
        `${formatNumber(preview.stats.totalAmountAffected)} sats`,
      ],
      ["Estimated Time", preview.estimatedExecutionTime]
    );

    console.log(summaryTable.toString());

    if (preview.stats.tokensToMigrate === 0) {
      console.log(
        chalk.green.bold(
          "\n✅ No migration needed - all tokens are correctly configured"
        )
      );
      return;
    }

    // User impact analysis
    console.log(chalk.blue.bold("\n👥 User Impact Analysis"));
    const userTable = new Table({
      head: [
        chalk.cyan("User (NPUB)"),
        chalk.cyan("Tokens"),
        chalk.cyan("Amount (sats)"),
      ],
      colWidths: [50, 10, 15],
    });

    Object.entries(preview.userImpact).forEach(([npub, impact]) => {
      userTable.push([
        npub.substring(0, 20) + "...",
        formatNumber(impact.tokenCount),
        formatNumber(impact.totalAmount),
      ]);
    });

    console.log(userTable.toString());

    // Sample tokens
    if (preview.sampleTokens.length > 0) {
      console.log(chalk.blue.bold("\n📝 Sample Tokens (First 10)"));
      const sampleTable = new Table({
        head: [
          chalk.cyan("Transaction ID"),
          chalk.cyan("Amount"),
          chalk.cyan("Created At"),
        ],
        colWidths: [25, 12, 20],
      });

      preview.sampleTokens.forEach((token) => {
        sampleTable.push([
          token.transaction_id.substring(0, 20) + "...",
          `${formatNumber(token.total_amount)} sats`,
          new Date(token.created_at).toLocaleDateString(),
        ]);
      });

      console.log(sampleTable.toString());
    }

    console.log(chalk.yellow.bold("\n⚠️  Migration Actions"));
    console.log(chalk.yellow("• Update status from 'unspent' to 'spent'"));
    console.log(chalk.yellow("• Set spent_at timestamp"));
    console.log(chalk.yellow("• Create backup for rollback capability"));
    console.log(chalk.yellow("• Validate all changes in atomic transaction"));

    console.log(chalk.gray.bold("\n💡 Next Steps"));
    console.log(chalk.gray("• Review the impact above"));
    console.log(
      chalk.gray("• Run 'npm run migration up --confirm' to execute")
    );
    console.log(chalk.gray("• Monitor logs during execution"));
    console.log(
      chalk.gray(
        "• Use 'npm run migration down --confirm' to rollback if needed"
      )
    );
  } catch (error) {
    spinner.fail("Failed to generate preview");
    console.error(chalk.red("Error:"), error.message);
    process.exit(1);
  }
};

// Execute migration UP
const executeMigrationUp = async (options) => {
  console.log(chalk.blue.bold("\n🚀 Starting Migration UP"));
  console.log(chalk.blue("=".repeat(50)));

  if (!options.confirm) {
    console.log(chalk.red("⚠️  This operation will modify database records"));
    console.log(
      chalk.gray(
        "Use --confirm flag to proceed: npm run migration up --confirm"
      )
    );
    return;
  }

  // Final confirmation
  const { proceed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message:
        "Are you sure you want to execute the migration? This will modify melted tokens in the database.",
      default: false,
    },
  ]);

  if (!proceed) {
    console.log(chalk.yellow("Migration cancelled by user"));
    return;
  }

  const spinner = ora("Executing migration...").start();
  const startTime = Date.now();

  try {
    const result = await migration.up();
    const duration = Date.now() - startTime;
    spinner.stop();

    console.log(chalk.green.bold("\n✅ Migration Completed Successfully"));

    const resultTable = new Table({
      head: [chalk.cyan("Result"), chalk.cyan("Value")],
      colWidths: [25, 25],
    });

    resultTable.push(
      ["Status", chalk.green("Success")],
      ["Affected Tokens", formatNumber(result.affectedTokens)],
      ["Execution Time", formatDuration(result.executionTimeMs)],
      ["Total Duration", formatDuration(duration)]
    );

    console.log(resultTable.toString());

    console.log(chalk.green.bold("\n🎉 Migration Benefits"));
    console.log(chalk.green("• Fixed balance calculation errors"));
    console.log(chalk.green("• Corrected melted token status"));
    console.log(chalk.green("• Improved data consistency"));
    console.log(chalk.green("• Enhanced user experience"));

    console.log(chalk.gray.bold("\n📋 Post-Migration"));
    console.log(chalk.gray("• Run 'npm run migration status' to verify"));
    console.log(chalk.gray("• Monitor application logs"));
    console.log(chalk.gray("• Test balance calculations"));
    console.log(chalk.gray("• Backup is available for rollback if needed"));
  } catch (error) {
    spinner.fail("Migration failed");
    console.error(chalk.red.bold("\n❌ Migration Failed"));
    console.error(chalk.red("Error:"), error.message);

    console.log(chalk.yellow.bold("\n🔧 Troubleshooting"));
    console.log(chalk.yellow("• Check database connectivity"));
    console.log(chalk.yellow("• Verify sufficient permissions"));
    console.log(chalk.yellow("• Review application logs"));
    console.log(chalk.yellow("• Contact support if issue persists"));

    process.exit(1);
  }
};

// Execute migration DOWN (rollback)
const executeMigrationDown = async (options) => {
  console.log(chalk.blue.bold("\n⏪ Starting Migration Rollback"));
  console.log(chalk.blue("=".repeat(50)));

  if (!options.confirm) {
    console.log(chalk.red("⚠️  This operation will rollback database changes"));
    console.log(
      chalk.gray(
        "Use --confirm flag to proceed: npm run migration down --confirm"
      )
    );
    return;
  }

  // Final confirmation
  const { proceed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message:
        "Are you sure you want to rollback the migration? This will restore original token status.",
      default: false,
    },
  ]);

  if (!proceed) {
    console.log(chalk.yellow("Rollback cancelled by user"));
    return;
  }

  const spinner = ora("Rolling back migration...").start();
  const startTime = Date.now();

  try {
    const result = await migration.down();
    const duration = Date.now() - startTime;
    spinner.stop();

    console.log(chalk.green.bold("\n✅ Rollback Completed Successfully"));

    const resultTable = new Table({
      head: [chalk.cyan("Result"), chalk.cyan("Value")],
      colWidths: [25, 25],
    });

    resultTable.push(
      ["Status", chalk.green("Success")],
      ["Restored Tokens", formatNumber(result.restoredTokens)],
      ["Execution Time", formatDuration(result.executionTimeMs)],
      ["Total Duration", formatDuration(duration)]
    );

    console.log(resultTable.toString());

    console.log(chalk.yellow.bold("\n⚠️  Post-Rollback Actions"));
    console.log(chalk.yellow("• Verify application functionality"));
    console.log(chalk.yellow("• Check balance calculations"));
    console.log(chalk.yellow("• Review system logs"));
    console.log(chalk.yellow("• Consider re-running migration after fixes"));
  } catch (error) {
    spinner.fail("Rollback failed");
    console.error(chalk.red.bold("\n❌ Rollback Failed"));
    console.error(chalk.red("Error:"), error.message);
    process.exit(1);
  }
};

// CLI Program setup
program
  .name("migration")
  .description("Migration tool for fixing melted token status")
  .version("1.0.0");

program
  .command("status")
  .description("Show current migration status")
  .action(async () => {
    await connectDB();
    await displayStatus();
    await disconnectDB();
  });

program
  .command("preview")
  .description("Preview migration impact without executing")
  .action(async () => {
    await connectDB();
    await displayPreview();
    await disconnectDB();
  });

program
  .command("up")
  .description("Execute migration (fix melted token status)")
  .option("--confirm", "Confirm execution (required for safety)")
  .action(async (options) => {
    await connectDB();
    await executeMigrationUp(options);
    await disconnectDB();
  });

program
  .command("down")
  .description("Rollback migration (restore original status)")
  .option("--confirm", "Confirm rollback (required for safety)")
  .action(async (options) => {
    await connectDB();
    await executeMigrationDown(options);
    await disconnectDB();
  });

// Error handling
process.on("unhandledRejection", (error) => {
  console.error(chalk.red("Unhandled rejection:"), error);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error(chalk.red("Uncaught exception:"), error);
  process.exit(1);
});

// Parse command line arguments
program.parse();
