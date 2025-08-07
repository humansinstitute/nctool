#!/usr/bin/env node
// Test nsec keys for Import Nsec Keys feature testing
// DO NOT USE THESE KEYS FOR REAL PURPOSES - THEY ARE FOR TESTING ONLY

import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { nip19 } from 'nostr-tools';

console.log("=== Test Nsec Keys for Import Testing ===\n");

// Generate 3 valid test keys
for (let i = 1; i <= 3; i++) {
    const privKey = generateSecretKey();
    const pubKey = getPublicKey(privKey);
    const nsec = nip19.nsecEncode(privKey);
    const npub = nip19.npubEncode(pubKey);
    
    console.log(`Test Key ${i}:`);
    console.log(`  nsec: ${nsec}`);
    console.log(`  npub: ${npub}`);
    console.log(`  name: TestUser${i}`);
    console.log();
}

// Invalid test cases
console.log("=== Invalid Test Cases ===");
console.log("1. Wrong prefix: npub1... (should be nsec1)");
console.log("2. Invalid bech32: nsec1invalidbech32data");
console.log("3. Empty string: ''");
console.log("4. Null/undefined");
console.log("5. Wrong length: nsec1abc");
console.log("6. Non-string input: 12345");