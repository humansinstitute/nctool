#!/usr/bin/env node

/**
 * Diagnostic script to test Cashu mint connectivity and isolate the fetch failure issue
 */

import { CashuMint, CashuWallet } from "@cashu/cashu-ts";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

async function testMintConnectivity() {
  console.log("🔍 Starting Cashu Mint Connectivity Diagnostics\n");
  
  const mintUrls = [
    "https://mint.minibits.cash/Bitcoin",
    "https://testnut.cashu.space",
    "https://8333.space:3338",
    "https://mint.coinos.io"
  ];
  
  for (const url of mintUrls) {
    console.log(`\n📡 Testing mint: ${url}`);
    console.log("=" + "=".repeat(50));
    
    try {
      // Test 1: Basic mint initialization
      console.log("1️⃣  Initializing CashuMint...");
      const mint = new CashuMint(url);
      console.log("   ✅ CashuMint initialized successfully");
      
      // Test 2: Get mint info
      console.log("2️⃣  Fetching mint info...");
      const info = await mint.getInfo();
      console.log("   ✅ Mint info retrieved:");
      console.log("   📋 Name:", info.name || "Unknown");
      console.log("   📋 Version:", info.version || "Unknown");
      console.log("   📋 Description:", info.description || "No description");
      console.log("   📋 Contact:", JSON.stringify(info.contact || {}));
      
      // Test 3: Get keysets
      console.log("3️⃣  Fetching keysets...");
      const keysets = await mint.getKeys();
      console.log("   ✅ Keysets retrieved:");
      console.log("   🔑 Keyset count:", Object.keys(keysets).length);
      
      // Test 4: Initialize wallet
      console.log("4️⃣  Initializing CashuWallet...");
      const wallet = new CashuWallet(mint, { unit: "sat" });
      console.log("   ✅ CashuWallet initialized successfully");
      
      // Test 5: Create mint quote (the failing operation)
      console.log("5️⃣  Creating mint quote for 21 sats...");
      const quote = await wallet.createMintQuote(21);
      console.log("   ✅ Mint quote created successfully:");
      console.log("   💰 Quote ID:", quote.quote);
      console.log("   ⚡ Invoice:", quote.request.substring(0, 50) + "...");
      console.log("   ⏰ Expiry:", new Date(quote.expiry * 1000).toISOString());
      
      console.log(`\n🎉 SUCCESS: ${url} is working correctly!`);
      
    } catch (error) {
      console.error(`\n❌ ERROR with ${url}:`);
      console.error("   💥 Error message:", error.message);
      console.error("   🔍 Error name:", error.name);
      console.error("   📚 Error stack:", error.stack?.split('\n')[0]);
      
      // Additional error details
      if (error.cause) {
        console.error("   🔗 Error cause:", error.cause);
      }
      
      if (error.code) {
        console.error("   🏷️  Error code:", error.code);
      }
      
      // Network-specific error details
      if (error.message.includes('fetch')) {
        console.error("   🌐 This appears to be a network/fetch error");
        console.error("   💡 Possible causes:");
        console.error("      - Mint server is down");
        console.error("      - Network connectivity issues");
        console.error("      - DNS resolution problems");
        console.error("      - Firewall/proxy blocking requests");
        console.error("      - SSL/TLS certificate issues");
      }
    }
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("🏁 Diagnostic complete!");
  console.log("\n💡 Next steps:");
  console.log("   1. If any mint worked, update MINT_URL in .env");
  console.log("   2. If all failed, check network connectivity");
  console.log("   3. Consider implementing fallback mint logic");
  console.log("   4. Add retry logic for network requests");
}

async function testBasicFetch() {
  console.log("\n🌐 Testing basic fetch connectivity...\n");
  
  const testUrls = [
    "https://mint.minibits.cash/Bitcoin/v1/info",
    "https://mint.minibits.cash/Bitcoin/info",
    "https://testnut.cashu.space/v1/info",
    "https://testnut.cashu.space/info"
  ];
  
  for (const url of testUrls) {
    try {
      console.log(`🔗 Testing: ${url}`);
      const response = await fetch(url);
      console.log(`   📊 Status: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`   ✅ Response: ${JSON.stringify(data).substring(0, 100)}...`);
      } else {
        console.log(`   ❌ Failed with status: ${response.status}`);
      }
    } catch (error) {
      console.error(`   💥 Fetch error: ${error.message}`);
    }
  }
}

async function main() {
  console.log("🚀 Cashu Mint Connectivity Diagnostic Tool");
  console.log("==========================================\n");
  
  // Test basic fetch first
  await testBasicFetch();
  
  // Then test Cashu library
  await testMintConnectivity();
}

// Run the diagnostic
main().catch(console.error);