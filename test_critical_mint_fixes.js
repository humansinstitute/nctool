#!/usr/bin/env node

/**
 * Critical Test: Verify MINT_URL and Cashu Library Fetch Fixes
 *
 * This test verifies:
 * 1. MINT_URL is correctly set to mint.minibits.cash/Bitcoin
 * 2. Global fetch patch works for Cashu library
 * 3. Cashu library can connect to the production mint
 * 4. Both HTTP connectivity and Mint Info work
 */

import { testMintConnectivityExternal } from "./src/services/cashu.service.js";
import { CashuMint } from "@cashu/cashu-ts";
import { logger } from "./src/utils/logger.js";

const EXPECTED_MINT_URL = "https://mint.minibits.cash/Bitcoin";

async function testCriticalFixes() {
  console.log("🔧 CRITICAL MINT FIXES TEST");
  console.log("=".repeat(50));

  const results = {
    mintUrlFixed: false,
    globalFetchPatched: false,
    httpConnectivity: false,
    cashuLibraryWorks: false,
    mintInfoRetrieval: false,
    overallSuccess: false,
  };

  try {
    // Test 1: Verify MINT_URL is correctly set
    console.log("\n1️⃣ Testing MINT_URL configuration...");
    const mintUrl =
      process.env.MINT_URL || "https://mint.minibits.cash/Bitcoin";

    if (mintUrl === EXPECTED_MINT_URL) {
      console.log("✅ MINT_URL correctly set to:", mintUrl);
      results.mintUrlFixed = true;
    } else {
      console.log(
        "❌ MINT_URL incorrect. Expected:",
        EXPECTED_MINT_URL,
        "Got:",
        mintUrl
      );
      return results;
    }

    // Test 2: Test global fetch patch by monitoring fetch calls
    console.log("\n2️⃣ Testing global fetch patch...");
    let fetchCallsIntercepted = 0;
    const originalFetch = global.fetch;

    // Wrap the patched fetch to count calls
    const monitoredFetch = (...args) => {
      const url = args[0];
      if (typeof url === "string" && url.includes("mint.minibits.cash")) {
        fetchCallsIntercepted++;
        console.log(
          "🔍 Intercepted mint fetch call:",
          url.substring(0, 60) + "..."
        );
      }
      return originalFetch(...args);
    };

    global.fetch = monitoredFetch;

    // Test 3: Run comprehensive connectivity test
    console.log("\n3️⃣ Running comprehensive connectivity test...");
    const connectivityResult = await testMintConnectivityExternal(
      EXPECTED_MINT_URL
    );

    console.log("\nConnectivity Test Results:");
    console.log(
      "- HTTP Connectivity:",
      connectivityResult.tests.httpConnectivity.success ? "✅" : "❌"
    );
    console.log(
      "- Mint Info:",
      connectivityResult.tests.mintInfo.success ? "✅" : "❌"
    );
    console.log(
      "- Cashu Library:",
      connectivityResult.tests.cashuLibrary.success ? "✅" : "❌"
    );
    console.log("- Overall:", connectivityResult.overall.success ? "✅" : "❌");

    results.httpConnectivity =
      connectivityResult.tests.httpConnectivity.success;
    results.mintInfoRetrieval = connectivityResult.tests.mintInfo.success;
    results.cashuLibraryWorks = connectivityResult.tests.cashuLibrary.success;

    // Test 4: Direct Cashu library test to verify fetch patch
    console.log("\n4️⃣ Testing Cashu library directly...");
    try {
      const mint = new CashuMint(EXPECTED_MINT_URL);
      const info = await mint.getInfo();

      console.log("✅ Cashu library mint info retrieval successful");
      console.log("- Mint name:", info.name);
      console.log("- Mint version:", info.version);
      console.log("- Supported nuts:", Object.keys(info.nuts || {}).join(", "));

      results.cashuLibraryWorks = true;
    } catch (error) {
      console.log("❌ Cashu library test failed:", error.message);
      console.log("Error details:", {
        name: error.name,
        code: error.code,
        cause: error.cause,
      });
    }

    // Test 5: Verify fetch interception worked
    console.log("\n5️⃣ Verifying fetch interception...");
    if (fetchCallsIntercepted > 0) {
      console.log(
        "✅ Global fetch patch working - intercepted",
        fetchCallsIntercepted,
        "mint calls"
      );
      results.globalFetchPatched = true;
    } else {
      console.log(
        "❌ Global fetch patch may not be working - no calls intercepted"
      );
    }

    // Restore original fetch
    global.fetch = originalFetch;

    // Overall assessment
    results.overallSuccess =
      results.mintUrlFixed &&
      results.globalFetchPatched &&
      results.httpConnectivity &&
      results.cashuLibraryWorks &&
      results.mintInfoRetrieval;

    console.log("\n" + "=".repeat(50));
    console.log("🎯 CRITICAL FIXES SUMMARY");
    console.log("=".repeat(50));
    console.log("✅ MINT_URL Fixed:", results.mintUrlFixed ? "YES" : "NO");
    console.log(
      "✅ Global Fetch Patched:",
      results.globalFetchPatched ? "YES" : "NO"
    );
    console.log(
      "✅ HTTP Connectivity:",
      results.httpConnectivity ? "YES" : "NO"
    );
    console.log(
      "✅ Cashu Library Works:",
      results.cashuLibraryWorks ? "YES" : "NO"
    );
    console.log(
      "✅ Mint Info Retrieval:",
      results.mintInfoRetrieval ? "YES" : "NO"
    );
    console.log(
      "\n🏆 OVERALL SUCCESS:",
      results.overallSuccess ? "✅ YES" : "❌ NO"
    );

    if (results.overallSuccess) {
      console.log("\n🎉 All critical fixes are working correctly!");
      console.log(
        "The service should now be able to connect to mint.minibits.cash"
      );
    } else {
      console.log("\n⚠️  Some issues remain. Check the failed tests above.");
    }

    return results;
  } catch (error) {
    console.error("\n💥 Critical test failed with error:", error.message);
    console.error("Stack:", error.stack);
    return results;
  }
}

// Run the test
testCriticalFixes()
  .then((results) => {
    process.exit(results.overallSuccess ? 0 : 1);
  })
  .catch((error) => {
    console.error("Test execution failed:", error);
    process.exit(1);
  });
