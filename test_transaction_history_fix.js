#!/usr/bin/env node

/**
 * Test script to verify transaction history corruption fixes
 * Run with: node test_transaction_history_fix.js
 */

import mongoose from "mongoose";
import CashuToken from "./src/models/CashuToken.model.js";
import walletRepositoryService from "./src/services/walletRepository.service.js";

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

async function createTestData() {
  console.log("\n=== CREATING TEST DATA ===\n");

  const testNpub =
    "npub1test123456789012345678901234567890123456789012345678901234";
  const testWalletId = new mongoose.Types.ObjectId();

  // Clean up any existing test data
  await CashuToken.deleteMany({ npub: testNpub });

  // 1. Create a valid transaction
  const validTransaction = new CashuToken({
    npub: testNpub,
    wallet_id: testWalletId,
    proofs: [
      {
        id: "test_proof_1",
        amount: 100,
        secret: "test_secret_1",
        C: "test_c_1",
      },
    ],
    mint_url: "https://test.mint.com",
    transaction_type: "received",
    transaction_id: "tx_valid_001",
    status: "unspent",
    metadata: {
      source: "p2p",
      test_data: true,
    },
  });

  // 2. Create a valid pending transaction (new format)
  const validPendingTransaction = new CashuToken({
    npub: testNpub,
    wallet_id: testWalletId,
    proofs: [],
    mint_url: "https://test.mint.com",
    transaction_type: "minted",
    transaction_id: "tx_pending_valid_001",
    status: "pending",
    total_amount: 0,
    metadata: {
      source: "lightning",
      quote_id: "test_quote_123",
      mint_amount: 50,
      pending_amount: 50,
      test_data: true,
    },
  });

  // 3. Create an invalid transaction (old format - should be filtered out)
  const invalidTransaction = new CashuToken({
    npub: testNpub,
    wallet_id: testWalletId,
    proofs: [],
    mint_url: "https://test.mint.com",
    transaction_type: "minted",
    transaction_id: "tx_invalid_001",
    status: "pending",
    // Missing total_amount and proper metadata
    metadata: {
      source: "lightning",
      // Missing quote_id
      test_data: true,
    },
  });

  // Save test data (bypass validation for invalid record)
  await validTransaction.save();
  await validPendingTransaction.save();

  // Debug: Check what was actually saved
  const savedPending = await CashuToken.findOne({
    transaction_id: "tx_pending_valid_001",
  });
  console.log(
    "DEBUG - Saved pending transaction metadata:",
    JSON.stringify(savedPending.metadata, null, 2)
  );

  // Insert invalid record directly to bypass validation
  await CashuToken.collection.insertOne({
    npub: testNpub,
    wallet_id: testWalletId,
    proofs: [],
    mint_url: "https://test.mint.com",
    transaction_type: "minted",
    transaction_id: "tx_invalid_001",
    status: "pending",
    // total_amount: undefined (missing)
    metadata: {
      source: "lightning",
      test_data: true,
      // quote_id: missing
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log("Created test data:");
  console.log("  - 1 valid unspent transaction");
  console.log("  - 1 valid pending transaction");
  console.log("  - 1 invalid pending transaction (should be filtered)");

  return testNpub;
}

async function testTransactionHistoryFiltering(testNpub) {
  console.log("\n=== TESTING TRANSACTION HISTORY FILTERING ===\n");

  // Test the enhanced getTransactionHistory method
  console.log("1. Testing walletRepositoryService.getTransactionHistory...");

  const historyResult = await walletRepositoryService.getTransactionHistory(
    testNpub,
    {
      limit: 10,
      skip: 0,
    }
  );

  console.log("Repository service results:");
  console.log(
    `  - Total transactions returned: ${historyResult.transactions.length}`
  );
  console.log(
    `  - Valid transactions in DB: ${historyResult.pagination.total}`
  );
  console.log(
    `  - Invalid transactions filtered: ${
      historyResult.pagination.invalid_filtered || 0
    }`
  );

  // Verify each returned transaction has required fields
  let validCount = 0;
  let invalidCount = 0;

  historyResult.transactions.forEach((tx, index) => {
    const issues = [];

    if (!tx.npub) issues.push("missing_npub");
    if (!tx.transaction_id) issues.push("missing_transaction_id");
    if (!tx.transaction_type) issues.push("missing_transaction_type");
    if (tx.total_amount === undefined || tx.total_amount === null)
      issues.push("undefined_total_amount");
    if (!tx.status) issues.push("missing_status");
    if (!tx.mint_url) issues.push("missing_mint_url");
    if (!tx.metadata || !tx.metadata.source) issues.push("invalid_metadata");

    if (issues.length === 0) {
      validCount++;
      console.log(
        `  ✓ Transaction ${index + 1}: ${tx.transaction_id} (${
          tx.status
        }) - VALID`
      );
    } else {
      invalidCount++;
      console.log(
        `  ✗ Transaction ${index + 1}: ${
          tx.transaction_id || "unknown"
        } - INVALID: ${issues.join(", ")}`
      );
    }
  });

  console.log(`\nValidation summary:`);
  console.log(`  - Valid transactions: ${validCount}`);
  console.log(`  - Invalid transactions: ${invalidCount}`);
  console.log(
    `  - Data integrity: ${
      validCount > 0 && invalidCount === 0 ? "PASS" : "FAIL"
    }`
  );

  return {
    validCount,
    invalidCount,
    totalReturned: historyResult.transactions.length,
  };
}

async function testDirectDatabaseQuery(testNpub) {
  console.log("\n=== TESTING DIRECT DATABASE QUERY ===\n");

  // Query database directly to see all records (including invalid ones)
  const allRecords = await CashuToken.find({ npub: testNpub }).lean();

  console.log("Direct database query results:");
  console.log(`  - Total records in DB: ${allRecords.length}`);

  allRecords.forEach((record, index) => {
    console.log(`  Record ${index + 1}:`);
    console.log(`    - ID: ${record.transaction_id || "missing"}`);
    console.log(`    - Status: ${record.status || "missing"}`);
    console.log(`    - Total Amount: ${record.total_amount}`);
    console.log(`    - Has Metadata Source: ${!!record.metadata?.source}`);
    console.log(`    - Has Quote ID: ${!!record.metadata?.quote_id}`);
  });

  return allRecords.length;
}

async function cleanupTestData(testNpub) {
  console.log("\n=== CLEANING UP TEST DATA ===\n");

  const deleteResult = await CashuToken.deleteMany({ npub: testNpub });
  console.log(`Deleted ${deleteResult.deletedCount} test records`);
}

async function runTests() {
  console.log("=== TRANSACTION HISTORY CORRUPTION FIX TESTS ===");

  const testNpub = await createTestData();

  const dbRecordCount = await testDirectDatabaseQuery(testNpub);
  const { validCount, invalidCount, totalReturned } =
    await testTransactionHistoryFiltering(testNpub);

  await cleanupTestData(testNpub);

  // Test results
  console.log("\n=== TEST RESULTS ===");
  console.log(`Database records created: ${dbRecordCount}`);
  console.log(`Records returned by API: ${totalReturned}`);
  console.log(`Valid records: ${validCount}`);
  console.log(`Invalid records: ${invalidCount}`);

  const testsPassed =
    dbRecordCount === 3 && // Should create 3 records
    totalReturned === 2 && // Should return only 2 valid records
    validCount === 2 && // Both returned records should be valid
    invalidCount === 0; // No invalid records should be returned

  console.log(`\nOVERALL TEST RESULT: ${testsPassed ? "PASS ✓" : "FAIL ✗"}`);

  if (!testsPassed) {
    console.log(
      "\nTest failures indicate that the transaction history filtering is not working correctly."
    );
    console.log("Expected: 3 DB records, 2 returned (valid), 0 invalid");
    console.log(
      `Actual: ${dbRecordCount} DB records, ${totalReturned} returned, ${invalidCount} invalid`
    );
  } else {
    console.log(
      "\nAll tests passed! Transaction history corruption fixes are working correctly."
    );
  }

  return testsPassed;
}

async function main() {
  await connectToDatabase();
  const success = await runTests();
  await mongoose.disconnect();
  console.log("\nTest complete. Disconnected from MongoDB.");
  process.exit(success ? 0 : 1);
}

main().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
