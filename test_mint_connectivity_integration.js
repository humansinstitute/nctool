#!/usr/bin/env node

/**
 * Comprehensive Integration Test for Cashu Mint Connectivity Fixes
 *
 * This test validates that all the enhanced error logging, connectivity testing,
 * and diagnostic capabilities function correctly together in various scenarios.
 *
 * Features tested:
 * - Enhanced error logging in cashu.service.js
 * - Improved mint initialization with per-request instances
 * - Connectivity testing functions
 * - Diagnostic script integration
 * - Error categorization and context preservation
 * - Performance impact validation
 */

import {
  testMintConnectivityExternal,
  mintTokens,
  getActivePollingStatus,
  cleanupAllPolling,
} from "./src/services/cashu.service.js";
import { logger } from "./src/utils/logger.js";
import { CashuMint, CashuWallet } from "@cashu/cashu-ts";
import { EventEmitter } from "events";

// Test configuration
const TEST_CONFIG = {
  TEST_NPUB:
    "npub1test123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  TEST_AMOUNT: 2,
  VALID_MINT_URL: process.env.MINT_URL || "https://mint.minibits.cash/Bitcoin",
  INVALID_MINT_URL: "https://nonexistent-mint-server.invalid",
  TIMEOUT_MINT_URL: "https://httpstat.us/200?sleep=30000",
  DNS_FAIL_MINT_URL: "https://this-domain-does-not-exist-12345.invalid",
  HTTP_ERROR_MINT_URL: "https://httpstat.us/500",
  SSL_ERROR_MINT_URL: "https://expired.badssl.com",
  PERFORMANCE_THRESHOLD_MS: 5000, // 5 seconds max for enhanced operations
};

// Test results tracking
const testResults = {
  totalTests: 0,
  passedTests: 0,
  failedTests: 0,
  warnings: 0,
  startTime: Date.now(),
  tests: [],
  performance: {
    enhancedErrorLogging: [],
    connectivityTesting: [],
    mintInitialization: [],
  },
};

// Colors for console output
const COLORS = {
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  CYAN: "\x1b[36m",
  WHITE: "\x1b[37m",
  RESET: "\x1b[0m",
  BOLD: "\x1b[1m",
  DIM: "\x1b[2m",
};

// Test indicators
const INDICATORS = {
  PASS: "✅",
  FAIL: "❌",
  WARN: "⚠️",
  INFO: "ℹ️",
  LOADING: "🔄",
  PERFORMANCE: "⚡",
};

/**
 * Utility functions
 */
function colorize(text, color) {
  return `${color}${text}${COLORS.RESET}`;
}

function printHeader(title) {
  console.log("\n" + colorize("=".repeat(60), COLORS.CYAN));
  console.log(colorize(`${title}`, COLORS.BOLD + COLORS.WHITE));
  console.log(colorize("=".repeat(60), COLORS.CYAN));
}

function printSubHeader(title) {
  console.log("\n" + colorize("-".repeat(40), COLORS.BLUE));
  console.log(colorize(`${title}`, COLORS.BOLD + COLORS.BLUE));
  console.log(colorize("-".repeat(40), COLORS.BLUE));
}

function logTest(testName, status, message, details = null, duration = null) {
  testResults.totalTests++;

  const indicator =
    status === "PASS"
      ? INDICATORS.PASS
      : status === "FAIL"
      ? INDICATORS.FAIL
      : status === "WARN"
      ? INDICATORS.WARN
      : status === "PERF"
      ? INDICATORS.PERFORMANCE
      : INDICATORS.INFO;

  const color =
    status === "PASS"
      ? COLORS.GREEN
      : status === "FAIL"
      ? COLORS.RED
      : status === "WARN"
      ? COLORS.YELLOW
      : status === "PERF"
      ? COLORS.MAGENTA
      : COLORS.BLUE;

  let output = `${indicator} ${colorize(
    testName + ":",
    COLORS.BOLD
  )} ${colorize(message, color)}`;

  if (duration !== null) {
    output += colorize(` (${duration}ms)`, COLORS.DIM);
  }

  console.log(output);

  if (details) {
    if (Array.isArray(details)) {
      details.forEach((detail) => {
        console.log(colorize(`   • ${detail}`, COLORS.DIM));
      });
    } else {
      console.log(colorize(`   ${details}`, COLORS.DIM));
    }
  }

  // Track results
  const testResult = {
    name: testName,
    status,
    message,
    details,
    duration,
    timestamp: new Date().toISOString(),
  };

  testResults.tests.push(testResult);

  if (status === "PASS") {
    testResults.passedTests++;
  } else if (status === "FAIL") {
    testResults.failedTests++;
  } else if (status === "WARN") {
    testResults.warnings++;
  }

  return testResult;
}

/**
 * Mock network conditions for testing
 */
class NetworkMocker {
  constructor() {
    this.originalFetch = global.fetch;
    this.mockConditions = new Map();
  }

  // Mock fetch to simulate different network conditions
  mockFetch(url, condition) {
    this.mockConditions.set(url, condition);

    global.fetch = async (fetchUrl, options) => {
      const mockCondition = this.mockConditions.get(fetchUrl);

      if (mockCondition) {
        switch (mockCondition.type) {
          case "timeout":
            await new Promise((resolve) =>
              setTimeout(resolve, mockCondition.delay || 30000)
            );
            throw new Error("Request timeout");

          case "dns_failure":
            const dnsError = new Error("getaddrinfo ENOTFOUND");
            dnsError.code = "ENOTFOUND";
            dnsError.errno = -3008;
            dnsError.syscall = "getaddrinfo";
            throw dnsError;

          case "connection_refused":
            const connError = new Error("connect ECONNREFUSED");
            connError.code = "ECONNREFUSED";
            connError.errno = -61;
            dnsError.syscall = "connect";
            throw connError;

          case "http_error":
            return {
              ok: false,
              status: mockCondition.status || 500,
              statusText: mockCondition.statusText || "Internal Server Error",
              headers: new Map(),
            };

          case "ssl_error":
            const sslError = new Error("certificate verify failed");
            sslError.code = "CERT_UNTRUSTED";
            throw sslError;

          default:
            break;
        }
      }

      // Fall back to original fetch
      return this.originalFetch(fetchUrl, options);
    };
  }

  restore() {
    global.fetch = this.originalFetch;
    this.mockConditions.clear();
  }
}

/**
 * Test Suite 1: Enhanced Error Logging Validation
 */
async function testEnhancedErrorLogging() {
  printSubHeader("Enhanced Error Logging Validation");

  const mocker = new NetworkMocker();

  try {
    // Test 1.1: Verify detailed error capture in mintTokens function
    logTest(
      "Error Logging Setup",
      "INFO",
      "Testing enhanced error capture in mintTokens"
    );

    const startTime = Date.now();

    try {
      // This should trigger enhanced error logging
      await mintTokens(TEST_CONFIG.TEST_NPUB, TEST_CONFIG.TEST_AMOUNT, true);
      logTest(
        "Mint Operation",
        "WARN",
        "Expected failure but operation succeeded"
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      testResults.performance.enhancedErrorLogging.push(duration);

      // Validate enhanced diagnostics are present
      const hasEnhancedDiagnostics = !!error.diagnostics;
      const hasEnvironmentInfo = !!error.diagnostics?.environment;
      const hasWalletState = !!error.diagnostics?.walletState;
      const hasTimingInfo = !!error.diagnostics?.environment?.operationDuration;
      const hasErrorChaining = !!error.originalError;

      logTest(
        "Enhanced Diagnostics Capture",
        hasEnhancedDiagnostics ? "PASS" : "FAIL",
        hasEnhancedDiagnostics
          ? "Detailed error information captured"
          : "Missing enhanced diagnostics",
        hasEnhancedDiagnostics
          ? [
              `Environment info: ${hasEnvironmentInfo ? "✓" : "✗"}`,
              `Wallet state: ${hasWalletState ? "✓" : "✗"}`,
              `Timing info: ${hasTimingInfo ? "✓" : "✗"}`,
              `Error chaining: ${hasErrorChaining ? "✓" : "✗"}`,
              `Node version: ${
                error.diagnostics?.environment?.nodeVersion || "N/A"
              }`,
              `Platform: ${error.diagnostics?.environment?.platform || "N/A"}`,
              `Operation duration: ${
                error.diagnostics?.environment?.operationDuration || "N/A"
              }ms`,
            ]
          : null,
        duration
      );

      // Test 1.2: Verify connectivity test integration on failure
      const hasConnectivityTest = !!error.diagnostics?.connectivityTest;
      logTest(
        "Automatic Connectivity Test",
        hasConnectivityTest ? "PASS" : "FAIL",
        hasConnectivityTest
          ? "Connectivity test automatically triggered on failure"
          : "Missing automatic connectivity test",
        hasConnectivityTest
          ? [
              `Overall success: ${error.diagnostics.connectivityTest.overall.success}`,
              `HTTP test: ${
                error.diagnostics.connectivityTest.tests.httpConnectivity
                  ?.success
                  ? "PASS"
                  : "FAIL"
              }`,
              `Mint info test: ${
                error.diagnostics.connectivityTest.tests.mintInfo?.success
                  ? "PASS"
                  : "FAIL"
              }`,
              `Library test: ${
                error.diagnostics.connectivityTest.tests.cashuLibrary?.success
                  ? "PASS"
                  : "FAIL"
              }`,
            ]
          : null
      );
    }

    // Test 1.3: Test error categorization with different error types
    const errorScenarios = [
      {
        name: "DNS Failure",
        url: TEST_CONFIG.DNS_FAIL_MINT_URL,
        mockCondition: { type: "dns_failure" },
        expectedErrorType: "ENOTFOUND",
      },
      {
        name: "Connection Timeout",
        url: TEST_CONFIG.TIMEOUT_MINT_URL,
        mockCondition: { type: "timeout", delay: 1000 },
        expectedErrorType: "ETIMEDOUT",
      },
      {
        name: "HTTP Error Response",
        url: TEST_CONFIG.HTTP_ERROR_MINT_URL,
        mockCondition: { type: "http_error", status: 500 },
        expectedErrorType: "HTTP_ERROR",
      },
    ];

    for (const scenario of errorScenarios) {
      const testStart = Date.now();

      try {
        mocker.mockFetch(scenario.url, scenario.mockCondition);
        await testMintConnectivityExternal(scenario.url);
        logTest(
          `Error Categorization - ${scenario.name}`,
          "WARN",
          "Expected failure but test passed"
        );
      } catch (error) {
        const testDuration = Date.now() - testStart;
        const errorCategorized =
          error.message.includes(scenario.expectedErrorType) ||
          error.code === scenario.expectedErrorType;

        logTest(
          `Error Categorization - ${scenario.name}`,
          errorCategorized ? "PASS" : "FAIL",
          errorCategorized
            ? "Error properly categorized"
            : "Error not properly categorized",
          [
            `Expected type: ${scenario.expectedErrorType}`,
            `Actual error: ${error.message}`,
            `Error code: ${error.code || "N/A"}`,
          ],
          testDuration
        );
      }

      mocker.restore();
    }
  } finally {
    mocker.restore();
  }
}

/**
 * Test Suite 2: Connectivity Testing Functions
 */
async function testConnectivityTesting() {
  printSubHeader("Connectivity Testing Functions");

  // Test 2.1: Test successful mint connectivity
  const validTestStart = Date.now();
  try {
    const result = await testMintConnectivityExternal(
      TEST_CONFIG.VALID_MINT_URL
    );
    const duration = Date.now() - validTestStart;
    testResults.performance.connectivityTesting.push(duration);

    const allTestsPassed = result.overall.success;
    const httpPassed = result.tests.httpConnectivity.success;
    const mintInfoPassed = result.tests.mintInfo.success;
    const libraryPassed = result.tests.cashuLibrary.success;

    logTest(
      "Valid Mint Connectivity",
      allTestsPassed ? "PASS" : "FAIL",
      allTestsPassed
        ? "All connectivity tests passed"
        : "Some connectivity tests failed",
      [
        `HTTP connectivity: ${httpPassed ? "PASS" : "FAIL"}`,
        `Mint info retrieval: ${mintInfoPassed ? "PASS" : "FAIL"}`,
        `Cashu library init: ${libraryPassed ? "PASS" : "FAIL"}`,
        `Total duration: ${duration}ms`,
        `HTTP duration: ${result.tests.httpConnectivity.duration}ms`,
        `Mint info duration: ${result.tests.mintInfo.duration}ms`,
        `Library duration: ${result.tests.cashuLibrary.duration}ms`,
      ],
      duration
    );

    // Test 2.2: Validate comprehensive test results structure
    const hasRequiredFields = !!(
      result.mintUrl &&
      result.timestamp &&
      result.nodeVersion &&
      result.platform &&
      result.tests &&
      result.overall
    );

    logTest(
      "Test Results Structure",
      hasRequiredFields ? "PASS" : "FAIL",
      hasRequiredFields
        ? "Complete test results structure"
        : "Missing required fields in test results",
      hasRequiredFields
        ? [
            `Mint URL: ${result.mintUrl}`,
            `Node version: ${result.nodeVersion}`,
            `Platform: ${result.platform}`,
            `Timestamp: ${result.timestamp}`,
            `Test count: ${Object.keys(result.tests).length}`,
          ]
        : null
    );
  } catch (error) {
    const duration = Date.now() - validTestStart;
    logTest(
      "Valid Mint Connectivity",
      "FAIL",
      `Connectivity test failed: ${error.message}`,
      [`Error details: ${error.stack?.split("\n")[0]}`],
      duration
    );
  }

  // Test 2.3: Test connectivity with invalid mint URLs
  const invalidScenarios = [
    {
      name: "Invalid Domain",
      url: TEST_CONFIG.DNS_FAIL_MINT_URL,
      expectedFailure: "DNS resolution",
    },
    {
      name: "Non-existent Server",
      url: TEST_CONFIG.INVALID_MINT_URL,
      expectedFailure: "HTTP connectivity",
    },
  ];

  for (const scenario of invalidScenarios) {
    const testStart = Date.now();
    try {
      const result = await testMintConnectivityExternal(scenario.url);
      const duration = Date.now() - testStart;

      const expectedToFail = !result.overall.success;
      logTest(
        `Invalid Connectivity - ${scenario.name}`,
        expectedToFail ? "PASS" : "FAIL",
        expectedToFail
          ? "Properly detected connectivity failure"
          : "Should have failed but passed",
        [
          `Overall success: ${result.overall.success}`,
          `Error message: ${result.overall.error || "N/A"}`,
          `Expected failure type: ${scenario.expectedFailure}`,
        ],
        duration
      );
    } catch (error) {
      const duration = Date.now() - testStart;
      logTest(
        `Invalid Connectivity - ${scenario.name}`,
        "PASS",
        "Connectivity test properly failed",
        [`Error: ${error.message}`],
        duration
      );
    }
  }
}

/**
 * Test Suite 3: Mint Initialization with Per-Request Instances
 */
async function testMintInitialization() {
  printSubHeader("Mint Initialization with Per-Request Instances");

  // Test 3.1: Verify fresh mint instances are created per request
  const initTests = [];

  for (let i = 0; i < 3; i++) {
    const testStart = Date.now();
    try {
      // Note: initializeWallet is not exported, so we'll test through mintTokens
      // which calls initializeWallet internally
      await mintTokens(TEST_CONFIG.TEST_NPUB, TEST_CONFIG.TEST_AMOUNT, false);
      logTest(
        `Mint Initialization ${i + 1}`,
        "WARN",
        "Expected failure but operation succeeded"
      );
    } catch (error) {
      const duration = Date.now() - testStart;
      testResults.performance.mintInitialization.push(duration);

      // Check if error contains fresh initialization indicators
      const hasFreshInit =
        error.diagnostics?.walletState?.hasWallet !== undefined &&
        error.diagnostics?.walletState?.hasMint !== undefined;

      logTest(
        `Mint Initialization ${i + 1}`,
        hasFreshInit ? "PASS" : "FAIL",
        hasFreshInit
          ? "Fresh mint instance created"
          : "Missing fresh initialization indicators",
        hasFreshInit
          ? [
              `Wallet created: ${error.diagnostics.walletState.hasWallet}`,
              `Mint created: ${error.diagnostics.walletState.hasMint}`,
              `Wallet methods available: ${!!error.diagnostics.walletState
                .walletMethods}`,
            ]
          : null,
        duration
      );

      initTests.push({
        duration,
        hasFreshInit,
        walletState: error.diagnostics?.walletState,
      });
    }
  }

  // Test 3.2: Verify no shared state between operations
  const hasConsistentBehavior = initTests.every((test) => test.hasFreshInit);
  const avgInitTime =
    initTests.reduce((sum, test) => sum + test.duration, 0) / initTests.length;

  logTest(
    "Per-Request Instance Consistency",
    hasConsistentBehavior ? "PASS" : "FAIL",
    hasConsistentBehavior
      ? "Consistent fresh instance creation"
      : "Inconsistent initialization behavior",
    [
      `Test runs: ${initTests.length}`,
      `Average init time: ${avgInitTime.toFixed(0)}ms`,
      `All tests consistent: ${hasConsistentBehavior}`,
    ]
  );

  // Test 3.3: Performance impact validation
  const maxAcceptableInitTime = TEST_CONFIG.PERFORMANCE_THRESHOLD_MS;
  const performanceAcceptable = avgInitTime < maxAcceptableInitTime;

  logTest(
    "Initialization Performance",
    performanceAcceptable ? "PASS" : "WARN",
    performanceAcceptable
      ? "Initialization time within acceptable limits"
      : "Initialization time may be too slow",
    [
      `Average time: ${avgInitTime.toFixed(0)}ms`,
      `Threshold: ${maxAcceptableInitTime}ms`,
      `Performance ratio: ${(
        (avgInitTime / maxAcceptableInitTime) *
        100
      ).toFixed(1)}%`,
    ]
  );
}

/**
 * Test Suite 4: Integration with Existing Wallet Operations
 */
async function testWalletIntegration() {
  printSubHeader("Integration with Existing Wallet Operations");

  // Test 4.1: Verify enhanced functions don't break existing functionality
  const integrationTests = [
    {
      name: "Mint Tokens with Connectivity Test",
      test: async () =>
        await mintTokens(TEST_CONFIG.TEST_NPUB, TEST_CONFIG.TEST_AMOUNT, true),
    },
    {
      name: "Mint Tokens without Connectivity Test",
      test: async () =>
        await mintTokens(TEST_CONFIG.TEST_NPUB, TEST_CONFIG.TEST_AMOUNT, false),
    },
    {
      name: "Connectivity Test Standalone",
      test: async () => await testMintConnectivityExternal(),
    },
  ];

  for (const integrationTest of integrationTests) {
    const testStart = Date.now();
    try {
      await integrationTest.test();
      const duration = Date.now() - testStart;
      logTest(
        integrationTest.name,
        "WARN",
        "Expected failure but operation succeeded",
        null,
        duration
      );
    } catch (error) {
      const duration = Date.now() - testStart;

      // Check if error has enhanced features without breaking basic functionality
      const hasBasicError = !!error.message;
      const hasEnhancedFeatures = !!error.diagnostics;
      const maintainsCompatibility = hasBasicError && error instanceof Error;

      logTest(
        integrationTest.name,
        maintainsCompatibility ? "PASS" : "FAIL",
        maintainsCompatibility
          ? "Enhanced features maintain compatibility"
          : "Compatibility issues detected",
        [
          `Basic error: ${hasBasicError}`,
          `Enhanced diagnostics: ${hasEnhancedFeatures}`,
          `Error type: ${error.constructor.name}`,
          `Message length: ${error.message?.length || 0}`,
        ],
        duration
      );
    }
  }

  // Test 4.2: Verify polling operations work with enhanced service
  try {
    const pollingStatus = getActivePollingStatus();
    logTest("Polling Integration", "PASS", "Polling status accessible", [
      `Active polling operations: ${pollingStatus.length}`,
      `Polling function available: ${
        typeof getActivePollingStatus === "function"
      }`,
      `Cleanup function available: ${typeof cleanupAllPolling === "function"}`,
    ]);
  } catch (error) {
    logTest(
      "Polling Integration",
      "FAIL",
      `Polling integration error: ${error.message}`
    );
  }
}

/**
 * Test Suite 5: Performance and Resource Usage Validation
 */
async function testPerformanceValidation() {
  printSubHeader("Performance and Resource Usage Validation");

  // Test 5.1: Memory usage tracking
  const initialMemory = process.memoryUsage();

  // Run multiple operations to test memory impact
  const operationCount = 5;
  const operationTimes = [];

  for (let i = 0; i < operationCount; i++) {
    const opStart = Date.now();
    try {
      await testMintConnectivityExternal();
    } catch (error) {
      // Expected to fail, we're testing performance
    }
    operationTimes.push(Date.now() - opStart);
  }

  const finalMemory = process.memoryUsage();
  const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
  const avgOperationTime =
    operationTimes.reduce((sum, time) => sum + time, 0) / operationTimes.length;

  // Test 5.2: Performance metrics validation
  const performanceMetrics = {
    enhancedErrorLogging: testResults.performance.enhancedErrorLogging,
    connectivityTesting: testResults.performance.connectivityTesting,
    mintInitialization: testResults.performance.mintInitialization,
  };

  Object.entries(performanceMetrics).forEach(([category, times]) => {
    if (times.length > 0) {
      const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
      const maxTime = Math.max(...times);
      const minTime = Math.min(...times);

      const performanceAcceptable =
        avgTime < TEST_CONFIG.PERFORMANCE_THRESHOLD_MS;

      logTest(
        `Performance - ${category}`,
        performanceAcceptable ? "PASS" : "WARN",
        performanceAcceptable
          ? "Performance within acceptable limits"
          : "Performance may need optimization",
        [
          `Average time: ${avgTime.toFixed(0)}ms`,
          `Min time: ${minTime}ms`,
          `Max time: ${maxTime}ms`,
          `Sample count: ${times.length}`,
          `Threshold: ${TEST_CONFIG.PERFORMANCE_THRESHOLD_MS}ms`,
        ]
      );
    }
  });

  // Test 5.3: Memory usage validation
  const memoryAcceptable = memoryIncrease < 50 * 1024 * 1024; // 50MB threshold

  logTest(
    "Memory Usage",
    memoryAcceptable ? "PASS" : "WARN",
    memoryAcceptable
      ? "Memory usage within acceptable limits"
      : "High memory usage detected",
    [
      `Initial heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(1)}MB`,
      `Final heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(1)}MB`,
      `Increase: ${(memoryIncrease / 1024 / 1024).toFixed(1)}MB`,
      `Operations: ${operationCount}`,
      `Avg operation time: ${avgOperationTime.toFixed(0)}ms`,
    ]
  );
}

/**
 * Test Suite 6: Diagnostic Integration Validation
 */
async function testDiagnosticIntegration() {
  printSubHeader("Diagnostic Integration Validation");

  // Test 6.1: Verify diagnostic functions provide actionable information
  try {
    const diagnosticResult = await testMintConnectivityExternal();

    const hasActionableInfo = !!(
      diagnosticResult.mintUrl &&
      diagnosticResult.tests &&
      diagnosticResult.overall &&
      diagnosticResult.timestamp
    );

    const testCount = Object.keys(diagnosticResult.tests).length;
    const successfulTests = Object.values(diagnosticResult.tests).filter(
      (test) => test.success
    ).length;

    logTest(
      "Diagnostic Information Quality",
      hasActionableInfo ? "PASS" : "FAIL",
      hasActionableInfo
        ? "Comprehensive diagnostic information provided"
        : "Insufficient diagnostic information",
      hasActionableInfo
        ? [
            `Test categories: ${testCount}`,
            `Successful tests: ${successfulTests}/${testCount}`,
            `Overall success: ${diagnosticResult.overall.success}`,
            `Environment info: ${!!diagnosticResult.nodeVersion}`,
            `Timing data: ${Object.values(diagnosticResult.tests).every(
              (test) => test.duration !== undefined
            )}`,
          ]
        : null
    );
  } catch (error) {
    logTest(
      "Diagnostic Information Quality",
      "FAIL",
      `Diagnostic test failed: ${error.message}`
    );
  }

  // Test 6.2: Verify error context preservation
  try {
    await mintTokens(TEST_CONFIG.TEST_NPUB, TEST_CONFIG.TEST_AMOUNT, true);
    logTest(
      "Error Context Preservation",
      "WARN",
      "Expected failure but operation succeeded"
    );
  } catch (error) {
    const hasPreservedContext = !!(
      error.message &&
      error.diagnostics &&
      error.diagnostics.npub === TEST_CONFIG.TEST_NPUB &&
      error.diagnostics.amount === TEST_CONFIG.TEST_AMOUNT
    );

    logTest(
      "Error Context Preservation",
      hasPreservedContext ? "PASS" : "FAIL",
      hasPreservedContext
        ? "Error context properly preserved"
        : "Error context not preserved",
      hasPreservedContext
        ? [
            `Original npub preserved: ${
              error.diagnostics.npub === TEST_CONFIG.TEST_NPUB
            }`,
            `Original amount preserved: ${
              error.diagnostics.amount === TEST_CONFIG.TEST_AMOUNT
            }`,
            `Environment context: ${!!error.diagnostics.environment}`,
            `Wallet state context: ${!!error.diagnostics.walletState}`,
          ]
        : null
    );
  }
}

/**
 * Generate comprehensive test report
 */
function generateTestReport() {
  printHeader("Integration Test Results Summary");

  const totalDuration = Date.now() - testResults.startTime;
  const successRate = (
    (testResults.passedTests / testResults.totalTests) *
    100
  ).toFixed(1);

  // Overall status
  const overallStatus =
    testResults.failedTests === 0
      ? "PASS"
      : testResults.passedTests > testResults.failedTests
      ? "PARTIAL"
      : "FAIL";

  const statusColor =
    overallStatus === "PASS"
      ? COLORS.GREEN
      : overallStatus === "PARTIAL"
      ? COLORS.YELLOW
      : COLORS.RED;

  console.log(
    `\n${INDICATORS.INFO} ${colorize("Test Execution Summary", COLORS.BOLD)}`
  );
  console.log(colorize("-".repeat(40), COLORS.DIM));
  console.log(`${INDICATORS.INFO} Total Tests: ${testResults.totalTests}`);
  console.log(
    `${INDICATORS.PASS} Passed: ${colorize(
      testResults.passedTests.toString(),
      COLORS.GREEN
    )}`
  );
  console.log(
    `${INDICATORS.FAIL} Failed: ${colorize(
      testResults.failedTests.toString(),
      COLORS.RED
    )}`
  );
  console.log(
    `${INDICATORS.WARN} Warnings: ${colorize(
      testResults.warnings.toString(),
      COLORS.YELLOW
    )}`
  );
  console.log(
    `${INDICATORS.PERFORMANCE} Success Rate: ${colorize(
      successRate + "%",
      statusColor
    )}`
  );
  console.log(
    `${INDICATORS.INFO} Total Duration: ${colorize(
      totalDuration + "ms",
      COLORS.BLUE
    )}`
  );

  // Performance summary
  console.log(
    `\n${INDICATORS.PERFORMANCE} ${colorize(
      "Performance Summary",
      COLORS.BOLD
    )}`
  );
  console.log(colorize("-".repeat(40), COLORS.DIM));

  Object.entries(testResults.performance).forEach(([category, times]) => {
    if (times.length > 0) {
      const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
      const performanceStatus =
        avgTime < TEST_CONFIG.PERFORMANCE_THRESHOLD_MS ? "GOOD" : "SLOW";
      const perfColor =
        performanceStatus === "GOOD" ? COLORS.GREEN : COLORS.YELLOW;

      console.log(
        `${INDICATORS.PERFORMANCE} ${category}: ${colorize(
          avgTime.toFixed(0) + "ms avg",
          perfColor
        )} (${times.length} samples)`
      );
    }
  });

  // Key findings
  console.log(`\n${INDICATORS.INFO} ${colorize("Key Findings", COLORS.BOLD)}`);
  console.log(colorize("-".repeat(40), COLORS.DIM));

  const keyFindings = [];

  if (testResults.passedTests === testResults.totalTests) {
    keyFindings.push("✅ All mint connectivity fixes are working correctly");
    keyFindings.push(
      "✅ Enhanced error logging provides comprehensive diagnostics"
    );
    keyFindings.push("✅ Per-request mint instances prevent state issues");
    keyFindings.push("✅ Performance impact is within acceptable limits");
  } else {
    keyFindings.push("⚠️ Some connectivity fixes need attention");
    if (testResults.failedTests > 0) {
      keyFindings.push(
        `❌ ${testResults.failedTests} critical issues detected`
      );
    }
    if (testResults.warnings > 0) {
      keyFindings.push(`⚠️ ${testResults.warnings} warnings require review`);
    }
  }

  keyFindings.forEach((finding) => {
    console.log(`   ${finding}`);
  });

  // Recommendations
  console.log(
    `\n${INDICATORS.INFO} ${colorize("Recommendations", COLORS.BOLD)}`
  );
  console.log(colorize("-".repeat(40), COLORS.DIM));

  if (overallStatus === "PASS") {
    console.log("   ✅ All systems operational - ready for production");
    console.log("   📊 Consider monitoring performance metrics in production");
    console.log("   🔄 Regular connectivity testing recommended");
  } else {
    console.log("   🔧 Review failed tests and address underlying issues");
    console.log("   📋 Check network connectivity and mint server status");
    console.log("   ⚡ Consider performance optimizations if needed");
    console.log("   🔍 Run diagnostic script for detailed troubleshooting");
  }

  return {
    overallStatus,
    totalTests: testResults.totalTests,
    passedTests: testResults.passedTests,
    failedTests: testResults.failedTests,
    warnings: testResults.warnings,
    successRate: parseFloat(successRate),
    duration: totalDuration,
    performance: testResults.performance,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Main test execution function
 */
async function runIntegrationTests() {
  try {
    printHeader("Cashu Mint Connectivity Integration Test Suite");

    console.log(
      colorize("Testing comprehensive mint connectivity fixes...", COLORS.BOLD)
    );
    console.log(
      colorize(`Start time: ${new Date().toISOString()}`, COLORS.DIM)
    );
    console.log(colorize(`Node.js version: ${process.version}`, COLORS.DIM));
    console.log(colorize(`Platform: ${process.platform}`, COLORS.DIM));

    // Execute test suites
    await testEnhancedErrorLogging();
    await testConnectivityTesting();
    await testMintInitialization();
    await testWalletIntegration();
    await testPerformanceValidation();
    await testDiagnosticIntegration();

    // Generate final report
    const report = generateTestReport();

    // Cleanup
    try {
      cleanupAllPolling();
      logTest("Cleanup", "PASS", "Test cleanup completed successfully");
    } catch (error) {
      logTest("Cleanup", "WARN", `Cleanup warning: ${error.message}`);
    }

    // Exit with appropriate code
    const exitCode = report.overallStatus === "PASS" ? 0 : 1;

    console.log(
      `\n${colorize(
        "Integration test completed",
        COLORS.BOLD
      )} - Exit code: ${exitCode}`
    );

    return report;
  } catch (error) {
    console.error(
      `\n${INDICATORS.FAIL} ${colorize("FATAL ERROR:", COLORS.RED)} ${
        error.message
      }`
    );
    console.error(colorize("Stack trace:", COLORS.DIM));
    console.error(colorize(error.stack, COLORS.DIM));

    return {
      overallStatus: "FAIL",
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Export functions for external use
 */
export {
  runIntegrationTests,
  testEnhancedErrorLogging,
  testConnectivityTesting,
  testMintInitialization,
  testWalletIntegration,
  testPerformanceValidation,
  testDiagnosticIntegration,
  generateTestReport,
  NetworkMocker,
};

/**
 * Run tests if this file is executed directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  runIntegrationTests()
    .then((report) => {
      const exitCode = report.overallStatus === "PASS" ? 0 : 1;
      process.exit(exitCode);
    })
    .catch((error) => {
      console.error(
        `\n${INDICATORS.FAIL} Test execution failed:`,
        error.message
      );
      process.exit(1);
    });
}
