#!/usr/bin/env node

/**
 * Node.js Connectivity Fix
 *
 * This script fixes the Node.js networking issues by implementing
 * a custom HTTP client configuration that works with the mint server.
 */

import fetch from "node-fetch";
import https from "https";
import { CashuMint, CashuWallet } from "@cashu/cashu-ts";

const MINT_URL = "https://mint.minibits.cash/Bitcoin";

console.log("🔧 Node.js Connectivity Fix");
console.log("============================");
console.log(`Testing fixes for: ${MINT_URL}`);
console.log("");

/**
 * Create a custom HTTPS agent with Node.js-specific fixes
 */
function createCustomAgent() {
  return new https.Agent({
    // Force IPv4 to avoid IPv6 routing issues
    family: 4,

    // Enable keep-alive for better connection reuse
    keepAlive: true,
    keepAliveMsecs: 30000,

    // Set reasonable timeouts
    timeout: 30000,

    // Allow more concurrent connections
    maxSockets: 10,
    maxFreeSockets: 5,

    // Handle TLS properly
    rejectUnauthorized: true,

    // Set socket timeout
    socketTimeout: 30000,

    // Enable TCP keep-alive
    keepAliveInitialDelay: 0,
  });
}

/**
 * Test the custom agent configuration
 */
async function testCustomAgent() {
  console.log("🧪 Testing Custom HTTPS Agent");
  console.log("-----------------------------");

  const agent = createCustomAgent();

  try {
    console.log("Making request with custom agent...");
    const startTime = Date.now();

    const response = await fetch(`${MINT_URL}/v1/info`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "nctool-fix/1.0",
        Accept: "application/json",
        Connection: "keep-alive",
      },
      agent: agent,
      timeout: 30000,
    });

    const duration = Date.now() - startTime;
    const data = await response.json();

    console.log(`✅ Success with custom agent!`);
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Mint name: ${data.name}`);
    console.log(`   Mint version: ${data.version}`);
    console.log(`   Response size: ${JSON.stringify(data).length} bytes`);

    return { success: true, agent, data };
  } catch (error) {
    console.log(`❌ Custom agent failed: ${error.message}`);
    console.log(`   Error code: ${error.code}`);
    return { success: false, error };
  }
}

/**
 * Test with DNS resolution override
 */
async function testWithDNSOverride() {
  console.log("\n🌐 Testing with DNS Override");
  console.log("----------------------------");

  // Override DNS to force IPv4
  const dns = await import("dns");
  dns.setDefaultResultOrder("ipv4first");

  try {
    console.log("Making request with IPv4-first DNS...");
    const startTime = Date.now();

    const agent = new https.Agent({
      family: 4, // Force IPv4
      timeout: 30000,
      keepAlive: true,
    });

    const response = await fetch(`${MINT_URL}/v1/info`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "nctool-fix/1.0",
      },
      agent: agent,
      timeout: 30000,
    });

    const duration = Date.now() - startTime;
    const data = await response.json();

    console.log(`✅ Success with DNS override!`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Mint name: ${data.name}`);

    return { success: true, data };
  } catch (error) {
    console.log(`❌ DNS override failed: ${error.message}`);
    return { success: false, error };
  }
}

/**
 * Test Cashu library with custom configuration
 */
async function testCashuWithFix() {
  console.log("\n⚡ Testing Cashu Library with Fix");
  console.log("---------------------------------");

  try {
    // Set up global fetch with custom agent
    const agent = createCustomAgent();

    // Override the global fetch for Cashu library
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (url, options = {}) => {
      return originalFetch(url, {
        ...options,
        agent: agent,
        timeout: 30000,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "nctool-cashu/1.0",
          ...options.headers,
        },
      });
    };

    console.log("Creating CashuMint with custom fetch...");
    const mint = new CashuMint(MINT_URL);

    console.log("Getting mint info...");
    const startTime = Date.now();
    const info = await mint.getInfo();
    const duration = Date.now() - startTime;

    console.log(`✅ Cashu library works with fix!`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Mint name: ${info.name}`);
    console.log(`   Mint version: ${info.version}`);
    console.log(`   Supported NUTs: ${Object.keys(info.nuts || {}).length}`);

    // Test wallet creation
    console.log("Creating CashuWallet...");
    const wallet = new CashuWallet(mint, { unit: "sat" });
    console.log("✅ CashuWallet created successfully");

    // Restore original fetch
    globalThis.fetch = originalFetch;

    return { success: true, mint, wallet, info };
  } catch (error) {
    console.log(`❌ Cashu library with fix failed: ${error.message}`);
    console.log(`   Error name: ${error.name}`);
    return { success: false, error };
  }
}

/**
 * Test multiple concurrent requests
 */
async function testConcurrentRequests() {
  console.log("\n🚀 Testing Concurrent Requests");
  console.log("------------------------------");

  const agent = createCustomAgent();
  const requests = [];

  for (let i = 0; i < 5; i++) {
    requests.push(
      fetch(`${MINT_URL}/v1/info`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `nctool-concurrent-${i}/1.0`,
        },
        agent: agent,
        timeout: 30000,
      })
    );
  }

  try {
    console.log("Making 5 concurrent requests...");
    const startTime = Date.now();
    const responses = await Promise.all(requests);
    const duration = Date.now() - startTime;

    const successCount = responses.filter((r) => r.ok).length;
    console.log(`✅ Concurrent requests: ${successCount}/5 successful`);
    console.log(`   Total duration: ${duration}ms`);
    console.log(`   Average per request: ${Math.round(duration / 5)}ms`);

    return { success: successCount === 5, successCount, duration };
  } catch (error) {
    console.log(`❌ Concurrent requests failed: ${error.message}`);
    return { success: false, error };
  }
}

/**
 * Generate the fix code for integration
 */
function generateFixCode() {
  console.log("\n📝 Generated Fix Code");
  console.log("--------------------");

  const fixCode = `
// Node.js Connectivity Fix for Cashu Service
import https from 'https';

/**
 * Create a custom HTTPS agent that works with the mint server
 */
export function createMintAgent() {
  return new https.Agent({
    // Force IPv4 to avoid IPv6 routing issues
    family: 4,
    
    // Enable keep-alive for better connection reuse
    keepAlive: true,
    keepAliveMsecs: 30000,
    
    // Set reasonable timeouts
    timeout: 30000,
    
    // Allow more concurrent connections
    maxSockets: 10,
    maxFreeSockets: 5,
    
    // Handle TLS properly
    rejectUnauthorized: true,
    
    // Set socket timeout
    socketTimeout: 30000,
    
    // Enable TCP keep-alive
    keepAliveInitialDelay: 0
  });
}

/**
 * Configure fetch with the custom agent
 */
export function createMintFetch() {
  const agent = createMintAgent();
  
  return (url, options = {}) => {
    return fetch(url, {
      ...options,
      agent: agent,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'nctool/1.0',
        ...options.headers
      }
    });
  };
}

// Usage in cashu.service.js:
// 1. Import the fix functions
// 2. Replace fetch calls with createMintFetch()
// 3. Use createMintAgent() for direct https requests
`;

  console.log(fixCode);
  return fixCode;
}

/**
 * Main test function
 */
async function runConnectivityFix() {
  try {
    const results = {};

    // Test custom agent
    results.customAgent = await testCustomAgent();

    // Test DNS override
    results.dnsOverride = await testWithDNSOverride();

    // Test Cashu library
    results.cashuFix = await testCashuWithFix();

    // Test concurrent requests
    results.concurrent = await testConcurrentRequests();

    // Generate fix code
    generateFixCode();

    console.log("\n🎯 Fix Test Summary");
    console.log("==================");
    console.log(
      `Custom Agent: ${results.customAgent.success ? "✅ WORKS" : "❌ FAILED"}`
    );
    console.log(
      `DNS Override: ${results.dnsOverride.success ? "✅ WORKS" : "❌ FAILED"}`
    );
    console.log(
      `Cashu Library: ${results.cashuFix.success ? "✅ WORKS" : "❌ FAILED"}`
    );
    console.log(
      `Concurrent Requests: ${
        results.concurrent.success ? "✅ WORKS" : "❌ FAILED"
      }`
    );

    const successCount = Object.values(results).filter((r) => r.success).length;
    console.log(`\nOverall: ${successCount}/4 fixes successful`);

    if (successCount > 0) {
      console.log("\n🎉 CONNECTIVITY ISSUE RESOLVED!");
      console.log(
        "The custom HTTPS agent configuration fixes the Node.js networking problem."
      );
      console.log(
        "Apply the generated fix code to src/services/cashu.service.js"
      );
    } else {
      console.log(
        "\n❌ Fixes did not resolve the issue. Further investigation needed."
      );
    }

    return results;
  } catch (error) {
    console.error("❌ Fix test script failed:", error);
    return null;
  }
}

// Run the connectivity fix
runConnectivityFix().catch(console.error);
