#!/usr/bin/env node

/**
 * HTTP Connectivity Diagnostic Tool
 *
 * This script investigates the actual connectivity issue with the mint server
 * by testing various HTTP client configurations and identifying the root cause.
 */

import fetch from "node-fetch";
import https from "https";
import http from "http";
import { CashuMint, CashuWallet } from "@cashu/cashu-ts";

const MINT_URL = "https://mint.minibits.cash/Bitcoin";

console.log("🔍 HTTP Connectivity Diagnostic Tool");
console.log("=====================================");
console.log(`Testing mint URL: ${MINT_URL}`);
console.log(`Node.js version: ${process.version}`);
console.log(`Platform: ${process.platform}`);
console.log(`Architecture: ${process.arch}`);
console.log("");

/**
 * Test basic fetch with different configurations
 */
async function testBasicFetch() {
  console.log("📡 Testing Basic Fetch Configurations");
  console.log("-------------------------------------");

  const tests = [
    {
      name: "Default fetch",
      config: {},
    },
    {
      name: "With timeout",
      config: { timeout: 10000 },
    },
    {
      name: "With headers",
      config: {
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "nctool-debug/1.0",
        },
      },
    },
    {
      name: "With custom agent (rejectUnauthorized: false)",
      config: {
        agent: new https.Agent({
          rejectUnauthorized: false,
        }),
      },
    },
    {
      name: "With keepAlive agent",
      config: {
        agent: new https.Agent({
          keepAlive: true,
          timeout: 10000,
        }),
      },
    },
    {
      name: "With all options",
      config: {
        timeout: 15000,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "nctool-debug/1.0",
          Accept: "application/json",
        },
        agent: new https.Agent({
          keepAlive: true,
          timeout: 10000,
        }),
      },
    },
  ];

  for (const test of tests) {
    try {
      console.log(`\n🧪 ${test.name}:`);
      const startTime = Date.now();

      const response = await fetch(`${MINT_URL}/v1/info`, {
        method: "GET",
        ...test.config,
      });

      const duration = Date.now() - startTime;
      const data = await response.text();

      console.log(`   ✅ Success: ${response.status} ${response.statusText}`);
      console.log(`   ⏱️  Duration: ${duration}ms`);
      console.log(`   📊 Response size: ${data.length} bytes`);
      console.log(
        `   🔗 Headers: ${JSON.stringify(Object.fromEntries(response.headers))}`
      );

      // Try to parse as JSON
      try {
        const jsonData = JSON.parse(data);
        console.log(`   📄 JSON data: ${JSON.stringify(jsonData, null, 2)}`);
      } catch (e) {
        console.log(`   📄 Raw data: ${data.substring(0, 200)}...`);
      }
    } catch (error) {
      console.log(`   ❌ Failed: ${error.name}: ${error.message}`);
      console.log(`   🔍 Error code: ${error.code}`);
      console.log(`   🔍 Error cause: ${error.cause}`);
      if (error.stack) {
        console.log(
          `   📚 Stack: ${error.stack.split("\n").slice(0, 3).join("\n")}`
        );
      }
    }
  }
}

/**
 * Test DNS resolution
 */
async function testDNSResolution() {
  console.log("\n🌐 Testing DNS Resolution");
  console.log("-------------------------");

  const dns = await import("dns");
  const { promisify } = await import("util");
  const lookup = promisify(dns.lookup);
  const resolve4 = promisify(dns.resolve4);

  try {
    const hostname = new URL(MINT_URL).hostname;
    console.log(`Hostname: ${hostname}`);

    // Test DNS lookup
    const lookupResult = await lookup(hostname);
    console.log(
      `✅ DNS Lookup: ${lookupResult.address} (family: ${lookupResult.family})`
    );

    // Test DNS resolve
    const addresses = await resolve4(hostname);
    console.log(`✅ DNS Resolve: ${addresses.join(", ")}`);
  } catch (error) {
    console.log(`❌ DNS Error: ${error.message}`);
  }
}

/**
 * Test raw HTTP/HTTPS connection
 */
async function testRawConnection() {
  console.log("\n🔌 Testing Raw HTTPS Connection");
  console.log("-------------------------------");

  return new Promise((resolve) => {
    const url = new URL(MINT_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: "/v1/info",
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "nctool-debug/1.0",
      },
    };

    console.log(
      `Connecting to: ${options.hostname}:${options.port}${options.path}`
    );

    const req = https.request(options, (res) => {
      console.log(
        `✅ Connection established: ${res.statusCode} ${res.statusMessage}`
      );
      console.log(`📊 Headers: ${JSON.stringify(res.headers, null, 2)}`);

      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        console.log(`📄 Response: ${data.substring(0, 500)}...`);
        resolve();
      });
    });

    req.on("error", (error) => {
      console.log(`❌ Raw connection failed: ${error.message}`);
      console.log(`🔍 Error code: ${error.code}`);
      resolve();
    });

    req.on("timeout", () => {
      console.log(`❌ Raw connection timeout`);
      req.destroy();
      resolve();
    });

    req.setTimeout(10000);
    req.end();
  });
}

/**
 * Test Cashu library initialization
 */
async function testCashuLibrary() {
  console.log("\n⚡ Testing Cashu Library");
  console.log("------------------------");

  try {
    console.log("Creating CashuMint instance...");
    const mint = new CashuMint(MINT_URL);
    console.log("✅ CashuMint created successfully");

    console.log("Getting mint info...");
    const startTime = Date.now();
    const info = await mint.getInfo();
    const duration = Date.now() - startTime;

    console.log(`✅ Mint info retrieved in ${duration}ms:`);
    console.log(`   Name: ${info.name}`);
    console.log(`   Version: ${info.version}`);
    console.log(`   Description: ${info.description}`);
    console.log(
      `   Supported NUTs: ${Object.keys(info.nuts || {}).join(", ")}`
    );

    console.log("Creating CashuWallet instance...");
    const wallet = new CashuWallet(mint, { unit: "sat" });
    console.log("✅ CashuWallet created successfully");

    // Test wallet methods
    console.log("Testing wallet methods...");
    const methods = ["createMintQuote", "checkMintQuote", "mintProofs"];
    for (const method of methods) {
      if (typeof wallet[method] === "function") {
        console.log(`   ✅ Method ${method} exists`);
      } else {
        console.log(`   ❌ Method ${method} missing`);
      }
    }
  } catch (error) {
    console.log(`❌ Cashu library test failed: ${error.message}`);
    console.log(`🔍 Error name: ${error.name}`);
    console.log(`🔍 Error code: ${error.code}`);
    if (error.stack) {
      console.log(
        `📚 Stack: ${error.stack.split("\n").slice(0, 5).join("\n")}`
      );
    }
  }
}

/**
 * Test environment and dependencies
 */
async function testEnvironment() {
  console.log("\n🔧 Testing Environment & Dependencies");
  console.log("------------------------------------");

  // Test Node.js version
  const nodeVersion = process.version;
  console.log(`Node.js version: ${nodeVersion}`);

  // Test fetch availability
  console.log(`fetch available: ${typeof fetch !== "undefined"}`);

  // Test https module
  console.log(`https module available: ${typeof https !== "undefined"}`);

  // Test environment variables
  console.log(`MINT_URL env var: ${process.env.MINT_URL || "not set"}`);

  // Test network interfaces
  try {
    const os = await import("os");
    const interfaces = os.networkInterfaces();
    console.log("Network interfaces:");
    for (const [name, addrs] of Object.entries(interfaces)) {
      const ipv4 = addrs?.filter(
        (addr) => addr.family === "IPv4" && !addr.internal
      );
      if (ipv4?.length > 0) {
        console.log(
          `   ${name}: ${ipv4.map((addr) => addr.address).join(", ")}`
        );
      }
    }
  } catch (error) {
    console.log(`Network interface check failed: ${error.message}`);
  }

  // Test proxy settings
  const proxyVars = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "http_proxy",
    "https_proxy",
    "NO_PROXY",
    "no_proxy",
  ];
  console.log("Proxy environment variables:");
  for (const proxyVar of proxyVars) {
    const value = process.env[proxyVar];
    console.log(`   ${proxyVar}: ${value || "not set"}`);
  }
}

/**
 * Test with curl equivalent
 */
async function testCurlEquivalent() {
  console.log("\n🌐 Testing with curl equivalent");
  console.log("-------------------------------");

  const { spawn } = await import("child_process");

  return new Promise((resolve) => {
    const curl = spawn("curl", [
      "-v",
      "-X",
      "GET",
      "-H",
      "Content-Type: application/json",
      "-H",
      "User-Agent: nctool-debug/1.0",
      "--connect-timeout",
      "10",
      "--max-time",
      "30",
      `${MINT_URL}/v1/info`,
    ]);

    let stdout = "";
    let stderr = "";

    curl.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    curl.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    curl.on("close", (code) => {
      console.log(`curl exit code: ${code}`);
      if (stdout) {
        console.log(`✅ curl stdout:\n${stdout}`);
      }
      if (stderr) {
        console.log(`🔍 curl stderr:\n${stderr}`);
      }
      resolve();
    });

    curl.on("error", (error) => {
      console.log(`❌ curl command failed: ${error.message}`);
      resolve();
    });
  });
}

/**
 * Main diagnostic function
 */
async function runDiagnostics() {
  try {
    await testEnvironment();
    await testDNSResolution();
    await testRawConnection();
    await testBasicFetch();
    await testCashuLibrary();
    await testCurlEquivalent();

    console.log("\n🎯 Diagnostic Summary");
    console.log("====================");
    console.log(
      "All tests completed. Review the results above to identify the connectivity issue."
    );
    console.log(
      "Look for patterns in failures and successful connections to determine the root cause."
    );
  } catch (error) {
    console.error("❌ Diagnostic script failed:", error);
  }
}

// Run diagnostics
runDiagnostics().catch(console.error);
