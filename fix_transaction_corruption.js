#!/usr/bin/env node

/**
 * Script to fix transaction history corruption issues
 * Run with: node fix_transaction_corruption.js [--dry-run]
 */

import mongoose from "mongoose";
import CashuToken from "./src/models/CashuToken.model.js";

// Database connection
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/nctool";
const DRY_RUN = process.argv.includes("--dry-run");

async function connectToDatabase() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}

async function fixTransactionCorruption() {
  console.log(
    `\n=== TRANSACTION CORRUPTION FIX ${DRY_RUN ? "(DRY RUN)" : ""} ===\n`
  );

  let totalFixed = 0;
  let totalRemoved = 0;

  // 1. Fix pending transactions with missing total_amount
  console.log("1. Fixing pending transactions with missing total_amount...");

  const pendingWithoutAmount = await CashuToken.find({
    status: "pending",
    $or: [{ total_amount: { $exists: false } }, { total_amount: null }],
  });

  console.log(
    `Found ${pendingWithoutAmount.length} pending transactions without total_amount`
  );

  for (const record of pendingWithoutAmount) {
    if (!DRY_RUN) {
      await CashuToken.updateOne(
        { _id: record._id },
        {
          $set: {
            total_amount: 0,
            "metadata.fixed_at": new Date(),
            "metadata.fix_reason": "missing_total_amount",
          },
        }
      );
    }
    totalFixed++;
    console.log(`  Fixed: ${record._id} - Set total_amount to 0`);
  }

  // 2. Fix records with invalid metadata structure
  console.log("\n2. Fixing records with invalid metadata...");

  const invalidMetadata = await CashuToken.find({
    $or: [
      { metadata: { $exists: false } },
      { metadata: null },
      { "metadata.source": { $exists: false } },
      { "metadata.source": null },
    ],
  });

  console.log(`Found ${invalidMetadata.length} records with invalid metadata`);

  for (const record of invalidMetadata) {
    const defaultMetadata = {
      source: "unknown",
      fixed_at: new Date(),
      fix_reason: "invalid_metadata_structure",
      original_metadata: record.metadata,
    };

    // Try to infer source from transaction_type
    if (record.transaction_type === "minted") {
      defaultMetadata.source = "lightning";
    } else if (record.transaction_type === "received") {
      defaultMetadata.source = "p2p";
    } else if (record.transaction_type === "sent") {
      defaultMetadata.source = "p2p";
    } else if (record.transaction_type === "melted") {
      defaultMetadata.source = "lightning";
    } else if (record.transaction_type === "change") {
      defaultMetadata.source = "change";
    }

    if (!DRY_RUN) {
      await CashuToken.updateOne(
        { _id: record._id },
        { $set: { metadata: defaultMetadata } }
      );
    }
    totalFixed++;
    console.log(
      `  Fixed: ${record._id} - Set default metadata with source: ${defaultMetadata.source}`
    );
  }

  // 3. Remove completely corrupted records (missing critical fields)
  console.log("\n3. Removing completely corrupted records...");

  const corruptedRecords = await CashuToken.find({
    $or: [
      { npub: { $exists: false } },
      { npub: null },
      { npub: "" },
      { transaction_id: { $exists: false } },
      { transaction_id: null },
      { transaction_id: "" },
      { transaction_type: { $exists: false } },
      { transaction_type: null },
      { status: { $exists: false } },
      { status: null },
      { mint_url: { $exists: false } },
      { mint_url: null },
      { mint_url: "" },
    ],
  });

  console.log(`Found ${corruptedRecords.length} completely corrupted records`);

  for (const record of corruptedRecords) {
    console.log(
      `  ${DRY_RUN ? "Would remove" : "Removing"}: ${
        record._id
      } - Missing critical fields`
    );
    if (!DRY_RUN) {
      await CashuToken.deleteOne({ _id: record._id });
    }
    totalRemoved++;
  }

  // 4. Fix negative total_amounts
  console.log("\n4. Fixing negative total_amounts...");

  const negativeAmounts = await CashuToken.find({
    total_amount: { $lt: 0 },
  });

  console.log(
    `Found ${negativeAmounts.length} records with negative total_amount`
  );

  for (const record of negativeAmounts) {
    const calculatedAmount = record.proofs
      ? record.proofs.reduce((sum, proof) => sum + (proof.amount || 0), 0)
      : 0;

    if (!DRY_RUN) {
      await CashuToken.updateOne(
        { _id: record._id },
        {
          $set: {
            total_amount: calculatedAmount,
            "metadata.fixed_at": new Date(),
            "metadata.fix_reason": "negative_total_amount",
            "metadata.original_amount": record.total_amount,
          },
        }
      );
    }
    totalFixed++;
    console.log(
      `  Fixed: ${record._id} - Changed total_amount from ${record.total_amount} to ${calculatedAmount}`
    );
  }

  // 5. Fix pending transactions with inconsistent data
  console.log("\n5. Fixing inconsistent pending transactions...");

  const inconsistentPending = await CashuToken.find({
    status: "pending",
    proofs: { $size: 0 },
    total_amount: { $gt: 0 },
  });

  console.log(
    `Found ${inconsistentPending.length} pending transactions with amount but no proofs`
  );

  for (const record of inconsistentPending) {
    if (!DRY_RUN) {
      await CashuToken.updateOne(
        { _id: record._id },
        {
          $set: {
            total_amount: 0,
            "metadata.fixed_at": new Date(),
            "metadata.fix_reason": "inconsistent_pending_data",
            "metadata.original_amount": record.total_amount,
          },
        }
      );
    }
    totalFixed++;
    console.log(
      `  Fixed: ${record._id} - Reset total_amount to 0 for empty pending transaction`
    );
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  console.log(`Records fixed: ${totalFixed}`);
  console.log(`Records removed: ${totalRemoved}`);
  console.log(`Total changes: ${totalFixed + totalRemoved}`);

  if (DRY_RUN) {
    console.log("\nThis was a dry run. No changes were made to the database.");
    console.log("Run without --dry-run to apply these fixes.");
  } else {
    console.log("\nAll fixes have been applied to the database.");
  }
}

async function main() {
  await connectToDatabase();
  await fixTransactionCorruption();
  await mongoose.disconnect();
  console.log("\nScript complete. Disconnected from MongoDB.");
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
