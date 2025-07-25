#!/usr/bin/env node

/**
 * Test script to verify that initializeWallet function can be imported properly
 * This tests the Phase 1 export fix
 */

console.log("🔍 Testing Export Verification for Phase 1 Fixes");
console.log("=".repeat(50));

async function testExportFix() {
  try {
    console.log("\n📦 Test 1: Import initializeWallet function");
    console.log("-".repeat(30));

    // Test importing initializeWallet function
    const { initializeWallet } = await import(
      "./src/services/cashu.service.js"
    );

    if (typeof initializeWallet === "function") {
      console.log("✅ initializeWallet function successfully imported");
      console.log(`   Function type: ${typeof initializeWallet}`);
      console.log(`   Function name: ${initializeWallet.name}`);
    } else {
      console.log("❌ initializeWallet is not a function");
      console.log(`   Type received: ${typeof initializeWallet}`);
      return false;
    }

    console.log("\n📦 Test 2: Import other required functions");
    console.log("-".repeat(30));

    // Test importing other functions that should be available
    const {
      testMintConnectivityExternal,
      mintTokens,
      getActivePollingStatus,
      cleanupAllPolling,
    } = await import("./src/services/cashu.service.js");

    const functions = {
      testMintConnectivityExternal,
      mintTokens,
      getActivePollingStatus,
      cleanupAllPolling,
    };

    let allFunctionsAvailable = true;

    for (const [name, func] of Object.entries(functions)) {
      if (typeof func === "function") {
        console.log(`✅ ${name} function available`);
      } else {
        console.log(`❌ ${name} function not available (type: ${typeof func})`);
        allFunctionsAvailable = false;
      }
    }

    console.log(
      "\n📦 Test 3: Test basic mint connectivity to testnut.cashu.space"
    );
    console.log("-".repeat(30));

    try {
      const connectivityResult = await testMintConnectivityExternal(
        "https://testnut.cashu.space"
      );

      console.log("✅ Connectivity test completed successfully");
      console.log(`   Overall success: ${connectivityResult.overall.success}`);
      console.log(
        `   HTTP connectivity: ${connectivityResult.tests.httpConnectivity.success}`
      );
      console.log(`   Mint info: ${connectivityResult.tests.mintInfo.success}`);
      console.log(
        `   Cashu library: ${connectivityResult.tests.cashuLibrary.success}`
      );
      console.log(`   Mint URL: ${connectivityResult.mintUrl}`);
      console.log(
        `   Test duration: ${
          connectivityResult.tests.httpConnectivity.duration +
          connectivityResult.tests.mintInfo.duration +
          connectivityResult.tests.cashuLibrary.duration
        }ms`
      );

      if (connectivityResult.overall.success) {
        console.log("✅ testnut.cashu.space mint server is fully functional");
      } else {
        console.log(
          `⚠️  Some connectivity issues: ${connectivityResult.overall.error}`
        );
      }
    } catch (error) {
      console.log(`❌ Connectivity test failed: ${error.message}`);
      return false;
    }

    console.log("\n📦 Test 4: Verify mint info retrieval");
    console.log("-".repeat(30));

    try {
      // Test direct mint info retrieval
      const response = await fetch("https://testnut.cashu.space/v1/info");
      if (response.ok) {
        const mintInfo = await response.json();
        console.log("✅ Mint info retrieved successfully");
        console.log(`   Mint name: ${mintInfo.name || "N/A"}`);
        console.log(`   Mint version: ${mintInfo.version || "N/A"}`);
        console.log(`   Description: ${mintInfo.description || "N/A"}`);
        console.log(`   Contact: ${JSON.stringify(mintInfo.contact || {})}`);
        console.log(
          `   Supported units: ${JSON.stringify(mintInfo.nuts || {})}`
        );
      } else {
        console.log(
          `⚠️  Mint info request failed with status: ${response.status}`
        );
      }
    } catch (error) {
      console.log(`❌ Mint info retrieval failed: ${error.message}`);
    }

    console.log("\n🎉 Export verification tests completed!");
    console.log("=".repeat(50));

    return allFunctionsAvailable;
  } catch (error) {
    console.error("\n💥 Export verification failed:");
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    return false;
  }
}

// Main execution
async function main() {
  try {
    console.log("🚀 Starting Export Verification Test Suite");
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Node.js version: ${process.version}`);
    console.log(`Platform: ${process.platform}`);

    const success = await testExportFix();

    if (success) {
      console.log("\n✅ All export verification tests passed!");
      console.log("✅ Phase 1 export fixes are working correctly");
      process.exit(0);
    } else {
      console.log("\n❌ Some export verification tests failed");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Export verification test suite failed:");
    console.error(error.message);
    process.exit(1);
  }
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { testExportFix };
