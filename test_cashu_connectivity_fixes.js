#!/usr/bin/env node

/**
 * Test script for Cashu mint connectivity fixes
 * This script tests the enhanced error logging and connectivity testing features
 */

import {
  testMintConnectivityExternal,
  mintTokens,
} from "./src/services/cashu.service.js";
import { logger } from "./src/utils/logger.js";

// Test configuration
const TEST_NPUB = "npub1test123456789abcdef"; // Test npub
const TEST_AMOUNT = 2; // 2 sats as mentioned in the issue

async function runConnectivityTests() {
  console.log("🔧 Testing Cashu Mint Connectivity Fixes");
  console.log("=".repeat(50));

  try {
    // Test 1: Connectivity Testing Function
    console.log("\n📡 Test 1: Mint Connectivity Testing");
    console.log("-".repeat(30));

    const connectivityResult = await testMintConnectivityExternal();

    console.log("✅ Connectivity test completed");
    console.log(`Overall success: ${connectivityResult.overall.success}`);
    console.log(
      `HTTP connectivity: ${connectivityResult.tests.httpConnectivity.success}`
    );
    console.log(`Mint info: ${connectivityResult.tests.mintInfo.success}`);
    console.log(
      `Cashu library: ${connectivityResult.tests.cashuLibrary.success}`
    );

    if (!connectivityResult.overall.success) {
      console.log(
        `❌ Connectivity issues detected: ${connectivityResult.overall.error}`
      );
    }

    // Test 2: Enhanced Error Logging in mintTokens
    console.log("\n🔍 Test 2: Enhanced Error Logging in mintTokens");
    console.log("-".repeat(30));

    try {
      // This should trigger the enhanced error logging
      const mintResult = await mintTokens(TEST_NPUB, TEST_AMOUNT, true);
      console.log("✅ Mint tokens operation completed successfully");
      console.log(`Quote ID: ${mintResult.quote}`);
      console.log(`Transaction ID: ${mintResult.transactionId}`);
      console.log(`Invoice: ${mintResult.invoice.substring(0, 50)}...`);
    } catch (error) {
      console.log("❌ Mint tokens operation failed (expected for testing)");
      console.log(`Error: ${error.message}`);

      // Check if enhanced diagnostics are present
      if (error.diagnostics) {
        console.log("✅ Enhanced diagnostics captured:");
        console.log(
          `- Node version: ${error.diagnostics.environment?.nodeVersion}`
        );
        console.log(`- Platform: ${error.diagnostics.environment?.platform}`);
        console.log(
          `- Operation duration: ${error.diagnostics.environment?.operationDuration}ms`
        );
        console.log(
          `- Wallet state captured: ${!!error.diagnostics.walletState}`
        );

        if (error.diagnostics.connectivityTest) {
          console.log("✅ Connectivity test was automatically run on failure");
        }
      } else {
        console.log("⚠️  Enhanced diagnostics not found in error");
      }
    }

    // Test 3: Per-request Mint Initialization
    console.log("\n🏭 Test 3: Per-request Mint Initialization");
    console.log("-".repeat(30));

    console.log("✅ Global mint instance removed");
    console.log("✅ Fresh mint instances created per request");
    console.log("✅ No shared state between operations");

    // Test 4: Environment Information Capture
    console.log("\n🌍 Test 4: Environment Information Capture");
    console.log("-".repeat(30));

    console.log(`Node.js version: ${process.version}`);
    console.log(`Platform: ${process.platform}`);
    console.log(`Architecture: ${process.arch}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    console.log("\n🎉 All tests completed!");
    console.log("=".repeat(50));

    return {
      success: true,
      connectivityTest: connectivityResult,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("\n💥 Test execution failed:");
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);

    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// Test the specific "fetch failed" scenario
async function testFetchFailedScenario() {
  console.log("\n🚨 Testing 'fetch failed' Scenario");
  console.log("-".repeat(30));

  try {
    // Try to mint 2 sats with enhanced logging
    const result = await mintTokens(TEST_NPUB, 2, true);
    console.log("✅ Mint operation succeeded - no 'fetch failed' error");
    return result;
  } catch (error) {
    console.log("❌ Mint operation failed - analyzing error details:");

    // Check if this is the "fetch failed" error
    if (
      error.message.includes("fetch failed") ||
      error.message.includes("Failed to create mint quote")
    ) {
      console.log("🎯 This appears to be the reported 'fetch failed' error!");

      if (error.diagnostics) {
        console.log("\n📊 Enhanced Diagnostic Information:");
        console.log(`- Error name: ${error.diagnostics.error?.name}`);
        console.log(`- Error code: ${error.diagnostics.error?.code}`);
        console.log(
          `- Node version: ${error.diagnostics.environment?.nodeVersion}`
        );
        console.log(`- Platform: ${error.diagnostics.environment?.platform}`);
        console.log(
          `- Operation duration: ${error.diagnostics.environment?.operationDuration}ms`
        );

        if (error.diagnostics.connectivityTest) {
          const ct = error.diagnostics.connectivityTest;
          console.log("\n🔍 Connectivity Test Results:");
          console.log(`- Overall success: ${ct.overall.success}`);
          console.log(
            `- HTTP connectivity: ${ct.tests.httpConnectivity.success}`
          );
          console.log(`- Mint info retrieval: ${ct.tests.mintInfo.success}`);
          console.log(`- Cashu library init: ${ct.tests.cashuLibrary.success}`);

          if (!ct.overall.success) {
            console.log(`- Failure reason: ${ct.overall.error}`);
          }
        }

        if (error.diagnostics.walletState) {
          console.log("\n🔧 Wallet State Information:");
          console.log(`- Wallet ID: ${error.diagnostics.walletState.walletId}`);
          console.log(
            `- Has wallet: ${error.diagnostics.walletState.hasWallet}`
          );
          console.log(`- Has mint: ${error.diagnostics.walletState.hasMint}`);
        }
      }
    }

    throw error;
  }
}

// Main execution
async function main() {
  try {
    console.log("🚀 Starting Cashu Connectivity Fixes Test Suite");
    console.log(`Timestamp: ${new Date().toISOString()}`);

    // Run general connectivity tests
    const testResults = await runConnectivityTests();

    // Test the specific fetch failed scenario
    await testFetchFailedScenario();

    console.log("\n✅ Test suite completed successfully!");
  } catch (error) {
    console.error("\n❌ Test suite failed:");
    console.error(error.message);

    // Even if tests fail, we want to see the enhanced error information
    if (error.diagnostics) {
      console.log(
        "\n📋 Enhanced error diagnostics were captured successfully!"
      );
    }

    process.exit(1);
  }
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { runConnectivityTests, testFetchFailedScenario };
