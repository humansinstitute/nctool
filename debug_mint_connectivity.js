#!/usr/bin/env node

/**
 * Cashu Mint Connectivity Diagnostic Tool
 *
 * This script provides comprehensive diagnostics for troubleshooting
 * Cashu mint connectivity issues, helping users and developers quickly
 * identify the root cause of "fetch failed" errors when minting tokens.
 */

import { testMintConnectivityExternal } from "./src/services/cashu.service.js";
import { CashuMint, CashuWallet } from "@cashu/cashu-ts";
import dns from "dns";
import { promisify } from "util";
import https from "https";
import http from "http";
import { URL } from "url";

// Promisify DNS functions
const dnsLookup = promisify(dns.lookup);
const dnsResolve = promisify(dns.resolve);

// Configuration
const DEFAULT_MINT_URLS = [
  "https://mint.minibits.cash/Bitcoin",
  "https://testnut.cashu.space",
  "https://mint.coinos.io",
  "https://legend.lnbits.com/cashu/api/v1/4gr9Xcmz3XEkUNwiBiQKrsvwSzw",
];

const TIMEOUT_MS = 30000; // 30 seconds
const DNS_TIMEOUT_MS = 10000; // 10 seconds

/**
 * Visual indicators for test results
 */
const INDICATORS = {
  PASS: "✅",
  FAIL: "❌",
  WARN: "⚠️",
  INFO: "ℹ️",
  LOADING: "🔄",
};

/**
 * Color codes for terminal output
 */
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

/**
 * Format text with color
 */
function colorize(text, color) {
  return `${color}${text}${COLORS.RESET}`;
}

/**
 * Print section header
 */
function printHeader(title) {
  console.log("\n" + colorize("=".repeat(50), COLORS.CYAN));
  console.log(colorize(`${title}`, COLORS.BOLD + COLORS.WHITE));
  console.log(colorize("=".repeat(50), COLORS.CYAN));
}

/**
 * Print test result with indicator
 */
function printResult(test, status, message, details = null) {
  const indicator =
    status === "PASS"
      ? INDICATORS.PASS
      : status === "FAIL"
      ? INDICATORS.FAIL
      : status === "WARN"
      ? INDICATORS.WARN
      : INDICATORS.INFO;

  const color =
    status === "PASS"
      ? COLORS.GREEN
      : status === "FAIL"
      ? COLORS.RED
      : status === "WARN"
      ? COLORS.YELLOW
      : COLORS.BLUE;

  console.log(
    `${indicator} ${colorize(test + ":", COLORS.BOLD)} ${colorize(
      message,
      color
    )}`
  );

  if (details) {
    console.log(colorize(`   ${details}`, COLORS.DIM));
  }
}

/**
 * Get environment information
 */
function getEnvironmentInfo() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    osRelease: process.release,
    memory: {
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + "MB",
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
    },
    uptime: Math.round(process.uptime()) + "s",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Test DNS resolution for a hostname
 */
async function testDNSResolution(hostname) {
  const results = {
    lookup: { success: false, error: null, duration: 0, addresses: [] },
    resolve: { success: false, error: null, duration: 0, addresses: [] },
  };

  // Test DNS lookup
  try {
    const lookupStart = Date.now();
    const lookupResult = await Promise.race([
      dnsLookup(hostname, { family: 0 }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("DNS lookup timeout")),
          DNS_TIMEOUT_MS
        )
      ),
    ]);

    results.lookup.duration = Date.now() - lookupStart;
    results.lookup.success = true;
    results.lookup.addresses = Array.isArray(lookupResult)
      ? lookupResult.map((r) => r.address)
      : [lookupResult.address];
  } catch (error) {
    results.lookup.duration = Date.now() - (Date.now() - DNS_TIMEOUT_MS);
    results.lookup.error = {
      name: error.name,
      message: error.message,
      code: error.code,
    };
  }

  // Test DNS resolve
  try {
    const resolveStart = Date.now();
    const resolveResult = await Promise.race([
      dnsResolve(hostname, "A"),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("DNS resolve timeout")),
          DNS_TIMEOUT_MS
        )
      ),
    ]);

    results.resolve.duration = Date.now() - resolveStart;
    results.resolve.success = true;
    results.resolve.addresses = resolveResult;
  } catch (error) {
    results.resolve.duration = Date.now() - (Date.now() - DNS_TIMEOUT_MS);
    results.resolve.error = {
      name: error.name,
      message: error.message,
      code: error.code,
    };
  }

  return results;
}

/**
 * Test HTTP/HTTPS connectivity with detailed timing
 */
async function testHTTPConnectivity(url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === "https:";
    const client = isHttps ? https : http;

    const startTime = Date.now();
    let dnsTime = 0;
    let connectTime = 0;
    let tlsTime = 0;
    let firstByteTime = 0;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      timeout: TIMEOUT_MS,
      headers: {
        "User-Agent": "Cashu-Connectivity-Diagnostic/1.0",
        Accept: "application/json",
      },
    };

    const req = client.request(options, (res) => {
      firstByteTime = Date.now() - startTime;

      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        const totalTime = Date.now() - startTime;

        resolve({
          success: true,
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          headers: res.headers,
          timing: {
            dns: dnsTime,
            connect: connectTime,
            tls: tlsTime,
            firstByte: firstByteTime,
            total: totalTime,
          },
          responseSize: data.length,
          contentType: res.headers["content-type"],
        });
      });
    });

    req.on("lookup", () => {
      dnsTime = Date.now() - startTime;
    });

    req.on("connect", () => {
      connectTime = Date.now() - startTime;
    });

    req.on("secureConnect", () => {
      tlsTime = Date.now() - startTime;
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        success: false,
        error: {
          name: "TimeoutError",
          message: `Request timeout after ${TIMEOUT_MS}ms`,
          code: "ETIMEDOUT",
        },
        timing: {
          total: Date.now() - startTime,
        },
      });
    });

    req.on("error", (error) => {
      resolve({
        success: false,
        error: {
          name: error.name,
          message: error.message,
          code: error.code,
          errno: error.errno,
          syscall: error.syscall,
        },
        timing: {
          total: Date.now() - startTime,
        },
      });
    });

    req.end();
  });
}

/**
 * Test SSL/TLS certificate validation
 */
async function testSSLCertificate(url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);

    if (urlObj.protocol !== "https:") {
      resolve({
        success: true,
        message: "Not HTTPS - SSL test skipped",
        skipped: true,
      });
      return;
    }

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      method: "GET",
      timeout: TIMEOUT_MS,
      rejectUnauthorized: true, // Strict SSL validation
    };

    const req = https.request(options, (res) => {
      const cert = res.socket.getPeerCertificate();
      const now = new Date();
      const validFrom = new Date(cert.valid_from);
      const validTo = new Date(cert.valid_to);

      resolve({
        success: true,
        certificate: {
          subject: cert.subject,
          issuer: cert.issuer,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          daysUntilExpiry: Math.ceil((validTo - now) / (1000 * 60 * 60 * 24)),
          fingerprint: cert.fingerprint,
          serialNumber: cert.serialNumber,
        },
        timing: {
          total: Date.now() - Date.now(),
        },
      });
    });

    req.on("error", (error) => {
      resolve({
        success: false,
        error: {
          name: error.name,
          message: error.message,
          code: error.code,
        },
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        success: false,
        error: {
          name: "TimeoutError",
          message: `SSL handshake timeout after ${TIMEOUT_MS}ms`,
          code: "ETIMEDOUT",
        },
      });
    });

    req.end();
  });
}

/**
 * Test Cashu library compatibility
 */
async function testCashuLibrary(mintUrl) {
  const results = {
    initialization: { success: false, error: null, duration: 0 },
    mintCreation: { success: false, error: null, duration: 0 },
    walletCreation: { success: false, error: null, duration: 0 },
    infoRetrieval: { success: false, error: null, duration: 0, data: null },
  };

  // Test library initialization
  try {
    const initStart = Date.now();

    // Test if we can import and use the library
    if (typeof CashuMint !== "function" || typeof CashuWallet !== "function") {
      throw new Error("Cashu library classes not properly exported");
    }

    results.initialization.duration = Date.now() - initStart;
    results.initialization.success = true;
  } catch (error) {
    results.initialization.error = {
      name: error.name,
      message: error.message,
    };
    return results; // Can't continue without library
  }

  // Test mint creation
  try {
    const mintStart = Date.now();
    const mint = new CashuMint(mintUrl);

    if (!mint || typeof mint.getInfo !== "function") {
      throw new Error("Mint instance missing required methods");
    }

    results.mintCreation.duration = Date.now() - mintStart;
    results.mintCreation.success = true;

    // Test wallet creation
    try {
      const walletStart = Date.now();
      const wallet = new CashuWallet(mint, { unit: "sat" });

      if (!wallet || typeof wallet.createMintQuote !== "function") {
        throw new Error("Wallet instance missing required methods");
      }

      results.walletCreation.duration = Date.now() - walletStart;
      results.walletCreation.success = true;
    } catch (error) {
      results.walletCreation.duration = Date.now() - mintStart;
      results.walletCreation.error = {
        name: error.name,
        message: error.message,
      };
    }

    // Test info retrieval
    try {
      const infoStart = Date.now();
      const info = await mint.getInfo();

      results.infoRetrieval.duration = Date.now() - infoStart;
      results.infoRetrieval.success = true;
      results.infoRetrieval.data = {
        name: info.name,
        version: info.version,
        description: info.description,
        nuts: Object.keys(info.nuts || {}),
        contact: info.contact,
      };
    } catch (error) {
      results.infoRetrieval.duration = Date.now() - infoStart;
      results.infoRetrieval.error = {
        name: error.name,
        message: error.message,
        code: error.code,
      };
    }
  } catch (error) {
    results.mintCreation.error = {
      name: error.name,
      message: error.message,
    };
  }

  return results;
}

/**
 * Comprehensive mint diagnostics
 */
async function diagnoseMint(mintUrl) {
  console.log(
    colorize(`\nTesting Mint: ${mintUrl}`, COLORS.BOLD + COLORS.MAGENTA)
  );
  console.log(colorize("-".repeat(60), COLORS.DIM));

  const urlObj = new URL(mintUrl);
  const hostname = urlObj.hostname;

  const diagnostics = {
    mintUrl,
    hostname,
    timestamp: new Date().toISOString(),
    tests: {},
    overall: { success: false, score: 0, maxScore: 0 },
  };

  // DNS Resolution Test
  console.log(colorize("\n🔍 DNS Resolution Tests", COLORS.CYAN));
  try {
    const dnsResults = await testDNSResolution(hostname);
    diagnostics.tests.dns = dnsResults;

    if (dnsResults.lookup.success) {
      printResult(
        "DNS Lookup",
        "PASS",
        `Resolved in ${dnsResults.lookup.duration}ms`,
        `Addresses: ${dnsResults.lookup.addresses.join(", ")}`
      );
      diagnostics.overall.score += 1;
    } else {
      printResult(
        "DNS Lookup",
        "FAIL",
        dnsResults.lookup.error.message,
        `Error: ${dnsResults.lookup.error.code || "Unknown"}`
      );
    }

    if (dnsResults.resolve.success) {
      printResult(
        "DNS Resolve",
        "PASS",
        `Resolved in ${dnsResults.resolve.duration}ms`,
        `A Records: ${dnsResults.resolve.addresses.join(", ")}`
      );
      diagnostics.overall.score += 1;
    } else {
      printResult(
        "DNS Resolve",
        "FAIL",
        dnsResults.resolve.error.message,
        `Error: ${dnsResults.resolve.error.code || "Unknown"}`
      );
    }
    diagnostics.overall.maxScore += 2;
  } catch (error) {
    printResult("DNS Tests", "FAIL", `Unexpected error: ${error.message}`);
    diagnostics.tests.dns = { error: error.message };
    diagnostics.overall.maxScore += 2;
  }

  // HTTP Connectivity Test
  console.log(colorize("\n🌐 HTTP Connectivity Test", COLORS.CYAN));
  try {
    const httpResults = await testHTTPConnectivity(mintUrl + "/v1/info");
    diagnostics.tests.http = httpResults;

    if (httpResults.success) {
      const timing = httpResults.timing;
      printResult(
        "HTTP Connectivity",
        "PASS",
        `${httpResults.statusCode} ${httpResults.statusMessage}`,
        `Total: ${timing.total}ms (DNS: ${timing.dns}ms, Connect: ${timing.connect}ms, TLS: ${timing.tls}ms)`
      );

      if (timing.total > 10000) {
        printResult(
          "Response Time",
          "WARN",
          `Slow response (${timing.total}ms)`,
          "Consider checking network conditions"
        );
      } else {
        printResult("Response Time", "PASS", `${timing.total}ms`);
      }
      diagnostics.overall.score += 2;
    } else {
      printResult(
        "HTTP Connectivity",
        "FAIL",
        httpResults.error.message,
        `Error: ${httpResults.error.code || "Unknown"}`
      );
    }
    diagnostics.overall.maxScore += 2;
  } catch (error) {
    printResult(
      "HTTP Connectivity",
      "FAIL",
      `Unexpected error: ${error.message}`
    );
    diagnostics.tests.http = { error: error.message };
    diagnostics.overall.maxScore += 2;
  }

  // SSL Certificate Test
  console.log(colorize("\n🔒 SSL Certificate Test", COLORS.CYAN));
  try {
    const sslResults = await testSSLCertificate(mintUrl);
    diagnostics.tests.ssl = sslResults;

    if (sslResults.skipped) {
      printResult("SSL Certificate", "INFO", sslResults.message);
    } else if (sslResults.success) {
      const cert = sslResults.certificate;
      const daysLeft = cert.daysUntilExpiry;

      if (daysLeft > 30) {
        printResult(
          "SSL Certificate",
          "PASS",
          `Valid certificate`,
          `Expires: ${cert.validTo} (${daysLeft} days)`
        );
      } else if (daysLeft > 0) {
        printResult(
          "SSL Certificate",
          "WARN",
          `Certificate expires soon`,
          `Expires: ${cert.validTo} (${daysLeft} days)`
        );
      } else {
        printResult(
          "SSL Certificate",
          "FAIL",
          `Certificate expired`,
          `Expired: ${cert.validTo}`
        );
      }
      diagnostics.overall.score += 1;
    } else {
      printResult(
        "SSL Certificate",
        "FAIL",
        sslResults.error.message,
        `Error: ${sslResults.error.code || "Unknown"}`
      );
    }
    diagnostics.overall.maxScore += 1;
  } catch (error) {
    printResult(
      "SSL Certificate",
      "FAIL",
      `Unexpected error: ${error.message}`
    );
    diagnostics.tests.ssl = { error: error.message };
    diagnostics.overall.maxScore += 1;
  }

  // Cashu Library Test
  console.log(colorize("\n📚 Cashu Library Compatibility Test", COLORS.CYAN));
  try {
    const cashuResults = await testCashuLibrary(mintUrl);
    diagnostics.tests.cashu = cashuResults;

    if (cashuResults.initialization.success) {
      printResult(
        "Library Import",
        "PASS",
        `Cashu-TS library loaded successfully`,
        `Duration: ${cashuResults.initialization.duration}ms`
      );
      diagnostics.overall.score += 1;
    } else {
      printResult(
        "Library Import",
        "FAIL",
        cashuResults.initialization.error.message
      );
    }

    if (cashuResults.mintCreation.success) {
      printResult(
        "Mint Creation",
        "PASS",
        `Mint instance created successfully`,
        `Duration: ${cashuResults.mintCreation.duration}ms`
      );
      diagnostics.overall.score += 1;
    } else {
      printResult(
        "Mint Creation",
        "FAIL",
        cashuResults.mintCreation.error?.message || "Failed to create mint"
      );
    }

    if (cashuResults.walletCreation.success) {
      printResult(
        "Wallet Creation",
        "PASS",
        `Wallet instance created successfully`,
        `Duration: ${cashuResults.walletCreation.duration}ms`
      );
      diagnostics.overall.score += 1;
    } else {
      printResult(
        "Wallet Creation",
        "FAIL",
        cashuResults.walletCreation.error?.message || "Failed to create wallet"
      );
    }

    if (cashuResults.infoRetrieval.success) {
      const info = cashuResults.infoRetrieval.data;
      printResult(
        "Mint Info API",
        "PASS",
        `Retrieved mint information`,
        `Name: ${info.name}, Version: ${info.version}, NUTs: ${info.nuts.length}`
      );
      diagnostics.overall.score += 2;
    } else {
      printResult(
        "Mint Info API",
        "FAIL",
        cashuResults.infoRetrieval.error?.message ||
          "Failed to retrieve mint info",
        `Error: ${cashuResults.infoRetrieval.error?.code || "Unknown"}`
      );
    }

    diagnostics.overall.maxScore += 5;
  } catch (error) {
    printResult(
      "Cashu Library Test",
      "FAIL",
      `Unexpected error: ${error.message}`
    );
    diagnostics.tests.cashu = { error: error.message };
    diagnostics.overall.maxScore += 5;
  }

  // Enhanced Service Test (using existing function)
  console.log(colorize("\n🔧 Enhanced Service Test", COLORS.CYAN));
  try {
    const serviceResults = await testMintConnectivityExternal(mintUrl);
    diagnostics.tests.service = serviceResults;

    if (serviceResults.overall.success) {
      printResult(
        "Service Integration",
        "PASS",
        `All service tests passed`,
        `Tests: HTTP(${
          serviceResults.tests.httpConnectivity.success ? "PASS" : "FAIL"
        }), ` +
          `Info(${serviceResults.tests.mintInfo.success ? "PASS" : "FAIL"}), ` +
          `Library(${
            serviceResults.tests.cashuLibrary.success ? "PASS" : "FAIL"
          })`
      );
      diagnostics.overall.score += 2;
    } else {
      printResult(
        "Service Integration",
        "FAIL",
        serviceResults.overall.error,
        "Check individual test results above"
      );
    }
    diagnostics.overall.maxScore += 2;
  } catch (error) {
    printResult(
      "Service Integration",
      "FAIL",
      `Service test error: ${error.message}`
    );
    diagnostics.tests.service = { error: error.message };
    diagnostics.overall.maxScore += 2;
  }

  // Calculate overall success
  diagnostics.overall.success =
    diagnostics.overall.score >= diagnostics.overall.maxScore * 0.8;

  return diagnostics;
}

/**
 * Generate recommendations based on test results
 */
function generateRecommendations(allResults) {
  const recommendations = [];

  for (const result of allResults) {
    if (!result.overall.success) {
      const mintUrl = result.mintUrl;

      // DNS issues
      if (result.tests.dns?.lookup?.error || result.tests.dns?.resolve?.error) {
        recommendations.push({
          type: "DNS",
          severity: "HIGH",
          message: `DNS resolution failed for ${mintUrl}`,
          actions: [
            "Check your internet connection",
            "Try using a different DNS server (8.8.8.8, 1.1.1.1)",
            "Verify the mint URL is correct",
            "Check if your ISP blocks certain domains",
          ],
        });
      }

      // HTTP connectivity issues
      if (result.tests.http?.error) {
        const error = result.tests.http.error;
        if (error.code === "ETIMEDOUT") {
          recommendations.push({
            type: "TIMEOUT",
            severity: "HIGH",
            message: `Connection timeout to ${mintUrl}`,
            actions: [
              "Check your internet connection speed",
              "Try connecting from a different network",
              "Check if a firewall is blocking the connection",
              "Verify the mint server is operational",
            ],
          });
        } else if (error.code === "ENOTFOUND") {
          recommendations.push({
            type: "DNS",
            severity: "HIGH",
            message: `Host not found: ${mintUrl}`,
            actions: [
              "Verify the mint URL is correct",
              "Check DNS settings",
              "Try accessing the URL in a web browser",
            ],
          });
        } else if (error.code === "ECONNREFUSED") {
          recommendations.push({
            type: "CONNECTION",
            severity: "HIGH",
            message: `Connection refused by ${mintUrl}`,
            actions: [
              "The mint server may be down",
              "Check if the port is correct",
              "Try again later",
              "Contact the mint operator",
            ],
          });
        }
      }

      // SSL issues
      if (result.tests.ssl?.error) {
        recommendations.push({
          type: "SSL",
          severity: "MEDIUM",
          message: `SSL certificate issues with ${mintUrl}`,
          actions: [
            "Check if the certificate is valid",
            "Verify system time is correct",
            "Update your system certificates",
            "Contact the mint operator about certificate issues",
          ],
        });
      }

      // Cashu library issues
      if (result.tests.cashu?.initialization?.error) {
        recommendations.push({
          type: "LIBRARY",
          severity: "HIGH",
          message: "Cashu library initialization failed",
          actions: [
            "Update @cashu/cashu-ts to the latest version",
            "Check Node.js version compatibility",
            "Reinstall node_modules",
            "Check for conflicting dependencies",
          ],
        });
      }
    }
  }

  // General recommendations if no specific issues found
  if (
    recommendations.length === 0 &&
    allResults.some((r) => !r.overall.success)
  ) {
    recommendations.push({
      type: "GENERAL",
      severity: "MEDIUM",
      message: "Some tests failed but no specific issues identified",
      actions: [
        "Try running the diagnostic again",
        "Check your network connection",
        "Verify system time is correct",
        "Update Node.js and dependencies",
      ],
    });
  }

  return recommendations;
}

/**
 * Print recommendations
 */
function printRecommendations(recommendations) {
  if (recommendations.length === 0) {
    printResult(
      "Recommendations",
      "PASS",
      "No issues detected - all systems operational!"
    );
    return;
  }

  console.log(colorize("\n💡 Recommendations", COLORS.BOLD + COLORS.YELLOW));
  console.log(colorize("-".repeat(50), COLORS.DIM));

  for (const rec of recommendations) {
    const severityColor =
      rec.severity === "HIGH"
        ? COLORS.RED
        : rec.severity === "MEDIUM"
        ? COLORS.YELLOW
        : COLORS.BLUE;

    console.log(
      `\n${INDICATORS.WARN} ${colorize(
        `[${rec.severity}] ${rec.type}:`,
        COLORS.BOLD + severityColor
      )} ${rec.message}`
    );

    rec.actions.forEach((action, index) => {
      console.log(colorize(`   ${index + 1}. ${action}`, COLORS.DIM));
    });
  }
}

/**
 * Print summary
 */
function printSummary(allResults) {
  console.log(colorize("\n📊 Summary", COLORS.BOLD + COLORS.WHITE));
  console.log(colorize("-".repeat(50), COLORS.DIM));

  const totalMints = allResults.length;
  const successfulMints = allResults.filter((r) => r.overall.success).length;
  const failedMints = totalMints - successfulMints;

  console.log(
    `\n${INDICATORS.INFO} ${colorize(
      "Total Mints Tested:",
      COLORS.BOLD
    )} ${totalMints}`
  );
  console.log(
    `${INDICATORS.PASS} ${colorize(
      "Successful:",
      COLORS.GREEN
    )} ${successfulMints}`
  );
  console.log(
    `${INDICATORS.FAIL} ${colorize("Failed:", COLORS.RED)} ${failedMints}`
  );

  if (successfulMints === totalMints) {
    console.log(
      `\n${INDICATORS.PASS} ${colorize(
        "Overall Status: ALL SYSTEMS OPERATIONAL",
        COLORS.BOLD + COLORS.GREEN
      )}`
    );
  } else if (successfulMints > 0) {
    console.log(
      `\n${INDICATORS.WARN} ${colorize(
        "Overall Status: PARTIAL CONNECTIVITY",
        COLORS.BOLD + COLORS.YELLOW
      )}`
    );
  } else {
    console.log(
      `\n${INDICATORS.FAIL} ${colorize(
        "Overall Status: CONNECTIVITY ISSUES DETECTED",
        COLORS.BOLD + COLORS.RED
      )}`
    );
  }

  // Performance summary
  const avgScores = allResults.map(
    (r) => (r.overall.score / r.overall.maxScore) * 100
  );
  const avgScore =
    avgScores.reduce((sum, score) => sum + score, 0) / avgScores.length;

  console.log(
    `\n${INDICATORS.INFO} ${colorize(
      "Average Success Rate:",
      COLORS.BOLD
    )} ${avgScore.toFixed(1)}%`
  );
}

/**
 * Main diagnostic function
 */
async function runDiagnostics() {
  // Print header
  console.log(
    colorize(
      "🔍 Cashu Mint Connectivity Diagnostics",
      COLORS.BOLD + COLORS.CYAN
    )
  );
  console.log(colorize("=".repeat(50), COLORS.CYAN));

  // Environment information
  printHeader("Environment Information");
  const env = getEnvironmentInfo();

  printResult("Node.js Version", "INFO", env.nodeVersion);
  printResult("Platform", "INFO", `${env.platform} (${env.architecture})`);
  printResult(
    "Memory Usage",
    "INFO",
    `${env.memory.used} / ${env.memory.total}`
  );
  printResult("Timezone", "INFO", env.timezone);
  printResult("Timestamp", "INFO", env.timestamp);

  // Get mint URLs to test
  const mintUrls = process.argv.slice(2);
  const urlsToTest = mintUrls.length > 0 ? mintUrls : DEFAULT_MINT_URLS;

  console.log(
    colorize(`\nTesting ${urlsToTest.length} mint server(s)...`, COLORS.BOLD)
  );

  const allResults = [];

  // Test each mint
  for (let i = 0; i < urlsToTest.length; i++) {
    const mintUrl = urlsToTest[i];
    console.log(
      colorize(`\n[${i + 1}/${urlsToTest.length}] `, COLORS.BOLD + COLORS.BLUE)
    );

    try {
      const result = await diagnoseMint(mintUrl);
      allResults.push(result);
    } catch (error) {
      console.log(
        colorize(
          `\nFATAL ERROR testing ${mintUrl}: ${error.message}`,
          COLORS.RED
        )
      );
      allResults.push({
        mintUrl,
        overall: { success: false, error: error.message },
        tests: {},
      });
    }
  }

  // Generate and print recommendations
  printHeader("Recommendations");
  const recommendations = generateRecommendations(allResults);
  printRecommendations(recommendations);

  // Print summary
  printSummary(allResults);

  // Exit with appropriate code
  const hasFailures = allResults.some((r) => !r.overall.success);
  process.exit(hasFailures ? 1 : 0);
}

/**
 * Handle uncaught errors gracefully
 */
process.on("uncaughtException", (error) => {
  console.error(
    colorize(`\n${INDICATORS.FAIL} FATAL ERROR: ${error.message}`, COLORS.RED)
  );
  console.error(colorize("Stack trace:", COLORS.DIM));
  console.error(colorize(error.stack, COLORS.DIM));
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(
    colorize(`\n${INDICATORS.FAIL} UNHANDLED REJECTION:`, COLORS.RED)
  );
  console.error(colorize(String(reason), COLORS.RED));
  process.exit(1);
});

// Run diagnostics if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDiagnostics().catch((error) => {
    console.error(
      colorize(
        `\n${INDICATORS.FAIL} DIAGNOSTIC ERROR: ${error.message}`,
        COLORS.RED
      )
    );
    process.exit(1);
  });
}
