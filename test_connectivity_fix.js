#!/usr/bin/env node

/**
 * Test Connectivity Fix
 *
 * This script tests the fixed cashu.service.js to verify that the
 * Node.js connectivity issue has been resolved.
 */

import {
  testMintConnectivityExternal,
  initializeWallet,
  mintTokens,
} from "./src/services/cashu.service.js";

const MINT_URL = "https://mint.minibits.cash/Bitcoin";
const TEST_NPUB = "npub1test123456789"; // Dummy npub for testing

console.log("🧪 Testing Connectivity Fix");
console.log("===========================");
console.log(`Testing mint URL: ${MINT_URL}`);
console.log("");

/**
 * Test the fixed mint connectivity function
 */
async function testFixedConnectivity() {
  console.log("🔧 Testing Fixed Mint Connectivity");
  console.log("----------------------------------");

  try {
    console.log("Running comprehensive connectivity test...");
    const startTime = Date.now();

    const testResult = await testMintConnectivityExternal(MINT_URL);
    const duration = Date.now() - startTime;

    console.log(`✅ Connectivity test completed in ${duration}ms`);
    console.log("");

    // Analyze results
    console.log("📊 Test Results:");
    console.log(
      `   Overall Success: ${testResult.overall.success ? "✅ YES" : "❌ NO"}`
    );
    console.log(
      `   HTTP Connectivity: ${
        testResult.tests.httpConnectivity.success ? "✅ PASS" : "❌ FAIL"
      }`
    );
    console.log(
      `   Mint Info: ${
        testResult.tests.mintInfo.success ? "✅ PASS" : "❌ FAIL"
      }`
    );
    console.log(
      `   Cashu Library: ${
        testResult.tests.cashuLibrary.success ? "✅ PASS" : "❌ FAIL"
      }`
    );
    console.log("");

    if (testResult.tests.httpConnectivity.success) {
      console.log(
        `   HTTP Duration: ${testResult.tests.httpConnectivity.duration}ms`
      );
    } else {
      console.log(
        `   HTTP Error: ${testResult.tests.httpConnectivity.error?.message}`
      );
    }

    if (testResult.tests.mintInfo.success) {
      console.log(
        `   Mint Info Duration: ${testResult.tests.mintInfo.duration}ms`
      );
      console.log(`   Mint Name: ${testResult.tests.mintInfo.data?.name}`);
      console.log(
        `   Mint Version: ${testResult.tests.mintInfo.data?.version}`
      );
    } else {
      console.log(
        `   Mint Info Error: ${testResult.tests.mintInfo.error?.message}`
      );
    }

    if (testResult.tests.cashuLibrary.success) {
      console.log(
        `   Cashu Library Duration: ${testResult.tests.cashuLibrary.duration}ms`
      );
    } else {
      console.log(
        `   Cashu Library Error: ${testResult.tests.cashuLibrary.error?.message}`
      );
    }

    return testResult;
  } catch (error) {
    console.log(`❌ Connectivity test failed: ${error.message}`);
    return null;
  }
}

/**
 * Test wallet initialization with the fix
 */
async function testWalletInitialization() {
  console.log("\n💼 Testing Wallet Initialization");
  console.log("--------------------------------");

  try {
    console.log("Attempting to initialize wallet...");
    const startTime = Date.now();

    // This will fail because we don't have a real npub/wallet setup,
    // but it should at least test the mint connectivity part
    const result = await initializeWallet(TEST_NPUB, true);
    const duration = Date.now() - startTime;

    console.log(`✅ Wallet initialization succeeded in ${duration}ms`);
    console.log(`   Wallet ID: ${result.walletDoc?._id || "N/A"}`);
    console.log(`   Mint URL: ${result.mint?.url || "N/A"}`);

    return { success: true, result };
  } catch (error) {
    console.log(`❌ Wallet initialization failed: ${error.message}`);

    // Check if it's a connectivity issue or expected failure
    if (
      error.message.includes("Mint not accessible") ||
      error.message.includes("fetch failed") ||
      error.message.includes("ETIMEDOUT")
    ) {
      console.log("   🚨 This appears to be a connectivity issue!");
      return { success: false, connectivityIssue: true, error };
    } else {
      console.log(
        "   ℹ️  This appears to be an expected failure (no real wallet setup)"
      );
      return { success: false, connectivityIssue: false, error };
    }
  }
}

/**
 * Test direct fetch with the custom agent
 */
async function testDirectFetch() {
  console.log("\n🌐 Testing Direct Fetch with Custom Agent");
  console.log("-----------------------------------------");

  try {
    // Import the fetch function directly
    const { createMintFetch } = await import("./src/services/cashu.service.js");

    console.log("Creating custom fetch instance...");
    const mintFetch = createMintFetch();

    console.log("Making direct request to mint...");
    const startTime = Date.now();

    const response = await mintFetch(`${MINT_URL}/v1/info`);
    const duration = Date.now() - startTime;
    const data = await response.json();

    console.log(`✅ Direct fetch succeeded in ${duration}ms`);
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Mint Name: ${data.name}`);
    console.log(`   Mint Version: ${data.version}`);
    console.log(`   Response Size: ${JSON.stringify(data).length} bytes`);

    return { success: true, data, duration };
  } catch (error) {
    console.log(`❌ Direct fetch failed: ${error.message}`);
    console.log(`   Error Code: ${error.code}`);
    return { success: false, error };
  }
}

/**
 * Compare before and after fix
 */
async function compareBeforeAfter() {
  console.log("\n📈 Comparing Before/After Fix");
  console.log("-----------------------------");

  try {
    // Test with standard fetch (should fail)
    console.log("Testing with standard fetch (before fix)...");
    const standardStart = Date.now();

    try {
      const response = await fetch(`${MINT_URL}/v1/info`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });
      const standardDuration = Date.now() - standardStart;
      console.log(
        `   Standard fetch: ✅ ${standardDuration}ms (unexpected success!)`
      );
    } catch (error) {
      const standardDuration = Date.now() - standardStart;
      console.log(
        `   Standard fetch: ❌ ${standardDuration}ms (${error.message})`
      );
    }

    // Test with custom fetch (should succeed)
    console.log("Testing with custom fetch (after fix)...");
    const customStart = Date.now();

    try {
      // Import and use the custom fetch
      const module = await import("./src/services/cashu.service.js");
      const mintFetch = module.createMintFetch
        ? module.createMintFetch()
        : null;

      if (!mintFetch) {
        console.log(
          "   Custom fetch: ❌ Could not create custom fetch function"
        );
        return;
      }

      const response = await mintFetch(`${MINT_URL}/v1/info`);
      const customDuration = Date.now() - customStart;
      console.log(`   Custom fetch: ✅ ${customDuration}ms (fix working!)`);

      const data = await response.json();
      console.log(`   Mint accessible: ${data.name} (${data.version})`);
    } catch (error) {
      const customDuration = Date.now() - customStart;
      console.log(`   Custom fetch: ❌ ${customDuration}ms (${error.message})`);
    }
  } catch (error) {
    console.log(`❌ Comparison test failed: ${error.message}`);
  }
}

/**
 * Main test function
 */
async function runConnectivityTests() {
  try {
    const results = {};

    // Test fixed connectivity
    results.connectivity = await testFixedConnectivity();

    // Test wallet initialization
    results.wallet = await testWalletInitialization();

    // Test direct fetch
    results.directFetch = await testDirectFetch();

    // Compare before/after
    await compareBeforeAfter();

    console.log("\n🎯 Test Summary");
    console.log("===============");

    const connectivitySuccess = results.connectivity?.overall?.success || false;
    const directFetchSuccess = results.directFetch?.success || false;
    const walletExpectedFailure =
      results.wallet && !results.wallet.connectivityIssue;

    console.log(
      `Connectivity Test: ${connectivitySuccess ? "✅ PASS" : "❌ FAIL"}`
    );
    console.log(
      `Direct Fetch Test: ${directFetchSuccess ? "✅ PASS" : "❌ FAIL"}`
    );
    console.log(
      `Wallet Test: ${
        walletExpectedFailure ? "✅ EXPECTED BEHAVIOR" : "❌ CONNECTIVITY ISSUE"
      }`
    );

    const overallSuccess = connectivitySuccess && directFetchSuccess;

    console.log(
      `\nOverall Fix Status: ${overallSuccess ? "🎉 SUCCESS" : "❌ FAILED"}`
    );

    if (overallSuccess) {
      console.log("\n✅ CONNECTIVITY ISSUE RESOLVED!");
      console.log("The Node.js networking problem has been fixed.");
      console.log(
        "The application should now work with https://mint.minibits.cash/Bitcoin"
      );
    } else {
      console.log("\n❌ CONNECTIVITY ISSUE PERSISTS");
      console.log("The fix did not resolve the networking problem.");
      console.log("Further investigation may be needed.");
    }

    return results;
  } catch (error) {
    console.error("❌ Test script failed:", error);
    return null;
  }
}

// Export the createMintFetch function for testing
export async function createMintFetch() {
  const module = await import("./src/services/cashu.service.js");
  return module.createMintFetch ? module.createMintFetch() : null;
}

// Run the connectivity tests
runConnectivityTests().catch(console.error);
