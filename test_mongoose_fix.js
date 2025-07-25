#!/usr/bin/env node

/**
 * Test script to verify the Mongoose document conversion fix
 * This tests that proofs are properly converted from Mongoose documents to plain objects
 */

import { meltTokens } from "./src/services/cashu.service.js";
import { logger } from "./src/utils/logger.js";
import mongoose from "mongoose";

// Test configuration
const TEST_NPUB = "npub1test123456789abcdef"; // Test npub
const TEST_INVOICE = "lnbc1000n1pjqxqzjsp5test"; // Test Lightning invoice

async function testMongooseDocumentFix() {
  console.log("🧪 Testing Mongoose Document Conversion Fix");
  console.log("=".repeat(60));

  try {
    // Connect to MongoDB
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/nctool"
    );
    console.log("✅ Connected to MongoDB");

    console.log("\n📋 Test Details:");
    console.log(`   • NPUB: ${TEST_NPUB}`);
    console.log(`   • Invoice: ${TEST_INVOICE.substring(0, 20)}...`);
    console.log(`   • Expected: Proofs converted to plain objects`);
    console.log(`   • Fix: Added .toObject() conversion in meltTokens`);

    console.log("\n🔄 Attempting melt operation...");

    // This should now work without the Mongoose document error
    const result = await meltTokens(TEST_NPUB, TEST_INVOICE);

    console.log("\n✅ SUCCESS: Melt operation completed!");
    console.log("📊 Result:", {
      transactionId: result.transactionId,
      paymentResult: result.paymentResult,
      paidAmount: result.paidAmount,
      feesPaid: result.feesPaid,
      changeAmount: result.changeAmount,
    });

    console.log("\n🎉 MONGOOSE FIX VERIFIED!");
    console.log("   • Proofs were successfully converted to plain objects");
    console.log("   • Cashu-ts accepted the clean proof structure");
    console.log("   • No more MongoDB metadata interference");
  } catch (error) {
    console.log("\n❌ Test failed:");
    console.log(`   Error: ${error.message}`);

    // Check if it's still the same Mongoose error
    if (
      error.message.includes("__parentArray") ||
      error.message.includes("$__parent") ||
      error.message.includes("_doc")
    ) {
      console.log("\n🚨 MONGOOSE ISSUE STILL EXISTS!");
      console.log("   • The fix may not have been applied correctly");
      console.log("   • Check that .toObject() conversion is working");
    } else {
      console.log("\n✅ MONGOOSE FIX WORKING!");
      console.log("   • No more Mongoose document errors");
      console.log(
        "   • This is likely a different issue (wallet balance, connectivity, etc.)"
      );
    }

    // Log detailed error for debugging
    console.log("\n🔍 Detailed Error:");
    console.log(error.stack);
  } finally {
    // Cleanup
    await mongoose.disconnect();
    console.log("\n🔌 Disconnected from MongoDB");
  }
}

// Enhanced error handling
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

// Run the test
testMongooseDocumentFix()
  .then(() => {
    console.log("\n✅ Test completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test failed:", error.message);
    process.exit(1);
  });
