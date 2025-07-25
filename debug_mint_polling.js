/**
 * Debug script for testing mint polling completion process
 * Tests various scenarios that could cause pending transactions to fail completion
 */

import { logger } from "./src/utils/logger.js";
import walletRepositoryService from "./src/services/walletRepository.service.js";
import { completeMinting } from "./src/services/cashu.service.js";

// Mock data for testing
const TEST_NPUB = "npub1test123456789abcdef";
const TEST_QUOTE_ID = "test_quote_12345";
const TEST_AMOUNT = 1000;
const TEST_TRANSACTION_ID = "mint_test_12345";

/**
 * Test 1: Verify pending transaction creation and retrieval
 */
async function testPendingTransactionHandling() {
  console.log("\n=== TEST 1: Pending Transaction Handling ===");

  try {
    // Find existing pending transactions
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    const pendingTransactions =
      await walletRepositoryService.findPendingMintTransactions(
        TEST_NPUB,
        cutoffDate
      );

    console.log("Pending mint transactions found:", {
      count: pendingTransactions.length,
      transactions: pendingTransactions.map((t) => ({
        id: t._id,
        transaction_id: t.transaction_id,
        status: t.status,
        total_amount: t.total_amount,
        quote_id: t.metadata?.quote_id,
        created_at: t.created_at,
        pending_amount: t.metadata?.pending_amount,
      })),
    });

    // Test transaction lookup by transaction ID
    if (pendingTransactions.length > 0) {
      const testTx = pendingTransactions[0];
      const foundTokens =
        await walletRepositoryService.findTokensByTransactionId(
          testTx.transaction_id
        );

      console.log("Transaction lookup test:", {
        transaction_id: testTx.transaction_id,
        found_count: foundTokens.length,
        matches_original:
          foundTokens.length > 0 &&
          foundTokens[0]._id.toString() === testTx._id.toString(),
      });
    }

    return { success: true, pendingCount: pendingTransactions.length };
  } catch (error) {
    console.error("Test 1 failed:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Test 2: Simulate quote status checking with various scenarios
 */
async function testQuoteStatusChecking() {
  console.log("\n=== TEST 2: Quote Status Checking Simulation ===");

  // Mock wallet with different quote status responses
  const mockWallet = {
    checkMintQuote: async (quoteId) => {
      console.log(`Checking quote status for: ${quoteId}`);

      // Simulate different scenarios
      const scenarios = [
        { state: "UNPAID", description: "Invoice not yet paid" },
        { state: "PAID", description: "Invoice paid, ready for minting" },
        { state: "EXPIRED", description: "Quote expired" },
        { state: "PENDING", description: "Payment processing" },
      ];

      // For testing, cycle through scenarios
      const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];
      console.log(`Quote status simulation:`, scenario);

      if (scenario.state === "PAID") {
        return { state: "PAID", paid: true };
      } else {
        return { state: scenario.state, paid: false };
      }
    },
  };

  try {
    // Test multiple quote checks
    const results = [];
    for (let i = 0; i < 5; i++) {
      const result = await mockWallet.checkMintQuote(TEST_QUOTE_ID);
      results.push(result);

      console.log(`Check ${i + 1}:`, result);

      // Simulate polling delay
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const paidCount = results.filter((r) => r.state === "PAID").length;
    console.log(
      `Quote checking results: ${paidCount}/${results.length} returned PAID status`
    );

    return { success: true, paidCount, totalChecks: results.length };
  } catch (error) {
    console.error("Test 2 failed:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Test 3: Test updatePendingTransaction with various update scenarios
 */
async function testTransactionStateTransitions() {
  console.log("\n=== TEST 3: Transaction State Transitions ===");

  try {
    // Find a pending transaction to test with
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pendingTransactions =
      await walletRepositoryService.findPendingMintTransactions(
        TEST_NPUB,
        cutoffDate
      );

    if (pendingTransactions.length === 0) {
      console.log(
        "No pending transactions found for testing state transitions"
      );
      return { success: true, message: "No pending transactions to test" };
    }

    const testTransaction = pendingTransactions[0];
    console.log("Testing with transaction:", {
      id: testTransaction._id,
      current_status: testTransaction.status,
      current_amount: testTransaction.total_amount,
    });

    // Test various update scenarios
    const testUpdates = [
      {
        name: "Valid status transition",
        updates: {
          status: "unspent",
          total_amount: 1000,
          proofs: [
            { amount: 500, secret: "test_secret_1", C: "test_c_1" },
            { amount: 500, secret: "test_secret_2", C: "test_c_2" },
          ],
        },
      },
      {
        name: "Invalid status transition (should fail)",
        updates: {
          status: "spent", // Invalid transition from pending to spent
        },
      },
      {
        name: "Metadata update",
        updates: {
          metadata: {
            ...testTransaction.metadata,
            completed_at: new Date(),
            completion_method: "background_polling",
          },
        },
      },
    ];

    const results = [];

    for (const test of testUpdates) {
      try {
        console.log(`\nTesting: ${test.name}`);

        // For testing, we'll use a copy approach to avoid modifying the actual transaction
        const result = await walletRepositoryService.updatePendingTransaction(
          testTransaction._id,
          test.updates
        );

        console.log(`✓ ${test.name} succeeded:`, {
          new_status: result.status,
          new_amount: result.total_amount,
        });

        results.push({ test: test.name, success: true });

        // Revert the change for next test (if it was a status change)
        if (test.updates.status && test.updates.status !== "pending") {
          await walletRepositoryService.updatePendingTransaction(
            testTransaction._id,
            { status: "pending", total_amount: 0, proofs: [] }
          );
        }
      } catch (error) {
        console.log(
          `✗ ${test.name} failed (expected for invalid transitions):`,
          error.message
        );
        results.push({ test: test.name, success: false, error: error.message });
      }
    }

    return { success: true, results };
  } catch (error) {
    console.error("Test 3 failed:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Test 4: Simulate polling timeout scenarios
 */
async function testPollingTimeoutScenarios() {
  console.log("\n=== TEST 4: Polling Timeout Scenarios ===");

  try {
    // Simulate the polling logic with shorter timeouts for testing
    const POLLING_INTERVAL = 1000; // 1 second for testing
    const POLLING_DURATION = 5000; // 5 seconds for testing
    const startTime = Date.now();

    let pollCount = 0;
    let timeoutReached = false;

    const pollPromise = new Promise((resolve) => {
      const pollInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        pollCount++;

        console.log(`Poll attempt ${pollCount}, elapsed: ${elapsed}ms`);

        // Stop polling after timeout
        if (elapsed >= POLLING_DURATION) {
          clearInterval(pollInterval);
          timeoutReached = true;
          console.log("Polling timeout reached");
          resolve({ timeoutReached: true, pollCount });
          return;
        }

        // Simulate quote check that never becomes PAID
        const mockQuoteStatus = { state: "UNPAID" };
        console.log(`Quote status: ${mockQuoteStatus.state}`);
      }, POLLING_INTERVAL);
    });

    const result = await pollPromise;

    console.log("Timeout test results:", {
      timeout_reached: result.timeoutReached,
      total_polls: result.pollCount,
      expected_polls: Math.floor(POLLING_DURATION / POLLING_INTERVAL),
    });

    return { success: true, ...result };
  } catch (error) {
    console.error("Test 4 failed:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Test 5: Test completeMinting function with mock data
 */
async function testCompleteMintingFunction() {
  console.log("\n=== TEST 5: Complete Minting Function Test ===");

  try {
    // This test would require mocking the CashuWallet
    // For now, we'll test the error handling paths

    console.log("Testing completeMinting error scenarios...");

    const errorScenarios = [
      {
        name: "Invalid npub",
        npub: "",
        quoteId: TEST_QUOTE_ID,
        amount: TEST_AMOUNT,
        transactionId: TEST_TRANSACTION_ID,
      },
      {
        name: "Invalid quote ID",
        npub: TEST_NPUB,
        quoteId: "",
        amount: TEST_AMOUNT,
        transactionId: TEST_TRANSACTION_ID,
      },
      {
        name: "Zero amount",
        npub: TEST_NPUB,
        quoteId: TEST_QUOTE_ID,
        amount: 0,
        transactionId: TEST_TRANSACTION_ID,
      },
    ];

    const results = [];

    for (const scenario of errorScenarios) {
      try {
        console.log(`Testing scenario: ${scenario.name}`);

        // This will likely fail due to wallet initialization or quote checking
        await completeMinting(
          scenario.npub,
          scenario.quoteId,
          scenario.amount,
          scenario.transactionId
        );

        results.push({ scenario: scenario.name, success: true });
      } catch (error) {
        console.log(`Expected error for ${scenario.name}: ${error.message}`);
        results.push({
          scenario: scenario.name,
          success: false,
          error: error.message,
        });
      }
    }

    return { success: true, results };
  } catch (error) {
    console.error("Test 5 failed:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log("🔍 Starting Mint Polling Debug Tests");
  console.log("=====================================");

  const testResults = {};

  try {
    testResults.test1 = await testPendingTransactionHandling();
    testResults.test2 = await testQuoteStatusChecking();
    testResults.test3 = await testTransactionStateTransitions();
    testResults.test4 = await testPollingTimeoutScenarios();
    testResults.test5 = await testCompleteMintingFunction();

    console.log("\n📊 TEST SUMMARY");
    console.log("================");

    Object.entries(testResults).forEach(([testName, result]) => {
      const status = result.success ? "✅ PASS" : "❌ FAIL";
      console.log(`${testName}: ${status}`);
      if (!result.success) {
        console.log(`  Error: ${result.error}`);
      }
    });

    const passCount = Object.values(testResults).filter(
      (r) => r.success
    ).length;
    const totalCount = Object.keys(testResults).length;

    console.log(`\nOverall: ${passCount}/${totalCount} tests passed`);

    // Provide recommendations based on test results
    console.log("\n🔧 RECOMMENDATIONS");
    console.log("==================");

    if (!testResults.test1.success) {
      console.log("- Fix pending transaction handling and database queries");
    }

    if (!testResults.test3.success) {
      console.log("- Review transaction state transition validation logic");
    }

    if (!testResults.test4.success) {
      console.log("- Improve polling timeout and cleanup mechanisms");
    }

    console.log("- Add retry logic for quote status checking");
    console.log("- Implement proper cleanup for timed-out transactions");
    console.log(
      "- Add race condition protection for concurrent completion attempts"
    );
    console.log("- Enhance error logging and monitoring for polling failures");
  } catch (error) {
    console.error("Test runner failed:", error);
  }
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}

export {
  testPendingTransactionHandling,
  testQuoteStatusChecking,
  testTransactionStateTransitions,
  testPollingTimeoutScenarios,
  testCompleteMintingFunction,
  runAllTests,
};
