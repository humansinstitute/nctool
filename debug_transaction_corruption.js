#!/usr/bin/env node

/**
 * Debug script to identify transaction history corruption issues
 * Run with: node debug_transaction_corruption.js
 */

import mongoose from "mongoose";
import CashuToken from "./src/models/CashuToken.model.js";

// Database connection
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/nctool";

async function connectToDatabase() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}

async function analyzeTransactionCorruption() {
  console.log("\n=== TRANSACTION CORRUPTION ANALYSIS ===\n");

  // 1. Find records with missing required fields
  console.log("1. Checking for missing required fields...");

  const missingFields = await CashuToken.aggregate([
    {
      $match: {
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
      },
    },
    {
      $project: {
        _id: 1,
        npub: 1,
        transaction_id: 1,
        transaction_type: 1,
        status: 1,
        mint_url: 1,
        total_amount: 1,
        created_at: 1,
        issues: {
          $concatArrays: [
            {
              $cond: [
                { $or: [{ $not: ["$npub"] }, { $eq: ["$npub", ""] }] },
                ["missing_npub"],
                [],
              ],
            },
            {
              $cond: [
                {
                  $or: [
                    { $not: ["$transaction_id"] },
                    { $eq: ["$transaction_id", ""] },
                  ],
                },
                ["missing_transaction_id"],
                [],
              ],
            },
            {
              $cond: [
                { $not: ["$transaction_type"] },
                ["missing_transaction_type"],
                [],
              ],
            },
            { $cond: [{ $not: ["$status"] }, ["missing_status"], []] },
            {
              $cond: [
                { $or: [{ $not: ["$mint_url"] }, { $eq: ["$mint_url", ""] }] },
                ["missing_mint_url"],
                [],
              ],
            },
          ],
        },
      },
    },
  ]);

  console.log(
    `Found ${missingFields.length} records with missing required fields:`
  );
  missingFields.slice(0, 5).forEach((record) => {
    console.log(`  - ID: ${record._id}, Issues: ${record.issues.join(", ")}`);
  });

  // 2. Find records with undefined/null total_amount
  console.log("\n2. Checking for undefined/null total_amount...");

  const undefinedAmounts = await CashuToken.find({
    $or: [
      { total_amount: { $exists: false } },
      { total_amount: null },
      { total_amount: { $lt: 0 } },
    ],
  })
    .select(
      "_id npub transaction_id transaction_type status total_amount proofs created_at"
    )
    .limit(10);

  console.log(
    `Found ${undefinedAmounts.length} records with invalid total_amount:`
  );
  undefinedAmounts.forEach((record) => {
    console.log(
      `  - ID: ${record._id}, Type: ${record.transaction_type}, Status: ${
        record.status
      }, Amount: ${record.total_amount}, Proofs: ${record.proofs?.length || 0}`
    );
  });

  // 3. Find records with invalid metadata
  console.log("\n3. Checking for invalid metadata...");

  const invalidMetadata = await CashuToken.find({
    $or: [
      { metadata: { $exists: false } },
      { metadata: null },
      { "metadata.source": { $exists: false } },
      { "metadata.source": null },
    ],
  })
    .select(
      "_id npub transaction_id transaction_type status metadata created_at"
    )
    .limit(10);

  console.log(`Found ${invalidMetadata.length} records with invalid metadata:`);
  invalidMetadata.forEach((record) => {
    console.log(
      `  - ID: ${record._id}, Type: ${
        record.transaction_type
      }, Metadata: ${JSON.stringify(record.metadata)}`
    );
  });

  // 4. Find problematic pending transactions
  console.log("\n4. Checking for problematic pending transactions...");

  const problematicPending = await CashuToken.find({
    status: "pending",
    $or: [
      {
        proofs: { $size: 0 },
        total_amount: { $gt: 0 },
      },
      {
        "metadata.quote_id": { $exists: false },
      },
      {
        "metadata.mint_amount": { $exists: false },
      },
    ],
  })
    .select("_id npub transaction_id total_amount proofs metadata created_at")
    .limit(10);

  console.log(
    `Found ${problematicPending.length} problematic pending transactions:`
  );
  problematicPending.forEach((record) => {
    console.log(
      `  - ID: ${record._id}, Amount: ${record.total_amount}, Proofs: ${
        record.proofs?.length || 0
      }, Has Quote: ${!!record.metadata?.quote_id}`
    );
  });

  // 5. Summary statistics
  console.log("\n5. Summary statistics...");

  const totalRecords = await CashuToken.countDocuments();
  const validRecords = await CashuToken.countDocuments({
    npub: { $exists: true, $ne: null, $ne: "" },
    transaction_id: { $exists: true, $ne: null, $ne: "" },
    transaction_type: { $exists: true, $ne: null },
    status: { $exists: true, $ne: null },
    mint_url: { $exists: true, $ne: null, $ne: "" },
    total_amount: { $exists: true, $ne: null, $gte: 0 },
    "metadata.source": { $exists: true, $ne: null },
  });

  console.log(`Total records: ${totalRecords}`);
  console.log(`Valid records: ${validRecords}`);
  console.log(`Invalid records: ${totalRecords - validRecords}`);
  console.log(
    `Data integrity: ${((validRecords / totalRecords) * 100).toFixed(2)}%`
  );

  // 6. Find records by status
  console.log("\n6. Records by status...");
  const statusCounts = await CashuToken.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  statusCounts.forEach((status) => {
    console.log(`  - ${status._id}: ${status.count} records`);
  });
}

async function main() {
  await connectToDatabase();
  await analyzeTransactionCorruption();
  await mongoose.disconnect();
  console.log("\nAnalysis complete. Disconnected from MongoDB.");
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
