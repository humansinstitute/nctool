#!/usr/bin/env node
// Comprehensive testing script for Import Nsec Keys feature
import "dotenv/config";
import { importKeyFromNsec, getAllKeys } from "../../src/services/identity.service.js";
import { validateNsec, decodeNsec } from "../../src/utils/validation.js";
import connectDB from "../../src/config/db.js";
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { nip19 } from 'nostr-tools';

// Test data
const TEST_KEYS = [
    {
        nsec: "nsec1s5stes53aztr6cxgcj6t62k589230vmdsumlq85nklj2vmvl28vqxcwkfm",
        npub: "npub1yfuavm8pe4zuxhq9tu98tzfucjjffl5pw7mw6770cx5gsdl9vr3se2sk60",
        name: "TestUser1"
    },
    {
        nsec: "nsec1p00px962gxlz7c4lasd4zrjxy4hdl9lyq9tc05laac4zhm8esukqzkydsy",
        npub: "npub12x9drjadtkg5nqk83csrp4jn373hgxw7vjt89pxt44u8hal4fy2qpv2t27",
        name: "TestUser2"
    },
    {
        nsec: "nsec18wh497uvy4zsyteqe4rcw2nvths5s7500atywavn7fy2a3nh2srs04cla0",
        npub: "npub1gx4048qwk7sw7e8dd6mwv4lcp8g4mm638xxajkz8t3kmqfrhcm7qyexgsf",
        name: "TestUser3"
    }
];

const INVALID_TEST_CASES = [
    { input: "", description: "Empty string" },
    { input: null, description: "Null value" },
    { input: undefined, description: "Undefined value" },
    { input: 12345, description: "Non-string input" },
    { input: "npub1yfuavm8pe4zuxhq9tu98tzfucjjffl5pw7mw6770cx5gsdl9vr3se2sk60", description: "npub instead of nsec" },
    { input: "nsec1invalidbech32data", description: "Invalid bech32 data" },
    { input: "nsec1abc", description: "Too short" },
    { input: "invalid1s5stes53aztr6cxgcj6t62k589230vmdsumlq85nklj2vmvl28vqxcwkfm", description: "Wrong prefix" },
    { input: "nsec", description: "Just prefix" },
    { input: "nsec1", description: "Prefix only" }
];

let testResults = {
    passed: 0,
    failed: 0,
    details: []
};

function logTest(testName, passed, details = "") {
    const status = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status}: ${testName}`);
    if (details) console.log(`   ${details}`);
    
    testResults.details.push({ testName, passed, details });
    if (passed) testResults.passed++;
    else testResults.failed++;
}

async function testValidation() {
    console.log("\n=== Testing Validation Functions ===");
    
    // Test valid nsec keys
    for (const testKey of TEST_KEYS) {
        try {
            const isValid = validateNsec(testKey.nsec);
            const decoded = decodeNsec(testKey.nsec);
            logTest(`Validate ${testKey.name} nsec`, isValid && decoded.length === 32, 
                `Valid: ${isValid}, Decoded length: ${decoded.length}`);
        } catch (error) {
            logTest(`Validate ${testKey.name} nsec`, false, error.message);
        }
    }
    
    // Test invalid cases
    for (const testCase of INVALID_TEST_CASES) {
        try {
            validateNsec(testCase.input);
            logTest(`Reject invalid: ${testCase.description}`, false, "Should have thrown error");
        } catch (error) {
            logTest(`Reject invalid: ${testCase.description}`, true, error.message);
        }
    }
}

async function testImportFunction() {
    console.log("\n=== Testing Import Function ===");
    
    // Test successful import
    try {
        const result = await importKeyFromNsec(TEST_KEYS[0].name, TEST_KEYS[0].nsec);
        const hasRequiredFields = result && result.name && result.npub && result.privkey;
        logTest("Import valid nsec", hasRequiredFields, 
            `Name: ${result?.name}, NPub: ${result?.npub?.substring(0, 20)}...`);
    } catch (error) {
        logTest("Import valid nsec", false, error.message);
    }
    
    // Test duplicate import
    try {
        await importKeyFromNsec(TEST_KEYS[0].name + "_duplicate", TEST_KEYS[0].nsec);
        logTest("Reject duplicate nsec", false, "Should have thrown duplicate error");
    } catch (error) {
        const isDuplicateError = error.message.includes("already exists");
        logTest("Reject duplicate nsec", isDuplicateError, error.message);
    }
    
    // Test invalid name inputs
    const invalidNames = ["", "   ", null, undefined];
    for (const invalidName of invalidNames) {
        try {
            await importKeyFromNsec(invalidName, TEST_KEYS[1].nsec);
            logTest(`Reject invalid name: ${JSON.stringify(invalidName)}`, false, "Should have thrown error");
        } catch (error) {
            const isNameError = error.message.includes("Name is required");
            logTest(`Reject invalid name: ${JSON.stringify(invalidName)}`, isNameError, error.message);
        }
    }
    
    // Test invalid nsec inputs
    for (const testCase of INVALID_TEST_CASES.slice(0, 5)) { // Test first 5 invalid cases
        try {
            await importKeyFromNsec("TestInvalid", testCase.input);
            logTest(`Reject invalid nsec: ${testCase.description}`, false, "Should have thrown error");
        } catch (error) {
            const isNsecError = error.message.includes("nsec") || error.message.includes("Invalid");
            logTest(`Reject invalid nsec: ${testCase.description}`, isNsecError, error.message);
        }
    }
}

async function testDatabaseIntegration() {
    console.log("\n=== Testing Database Integration ===");
    
    try {
        const allKeys = await getAllKeys();
        const importedKey = allKeys.find(k => k.name === TEST_KEYS[0].name);
        
        logTest("Key stored in database", !!importedKey, 
            `Found ${allKeys.length} total keys, imported key present: ${!!importedKey}`);
        
        if (importedKey) {
            const hasCorrectFields = importedKey.npub === TEST_KEYS[0].npub && 
                                   importedKey.name === TEST_KEYS[0].name &&
                                   importedKey.privkey && importedKey.pubkey;
            logTest("Database record complete", hasCorrectFields, 
                `NPub match: ${importedKey.npub === TEST_KEYS[0].npub}, Has privkey: ${!!importedKey.privkey}`);
        }
    } catch (error) {
        logTest("Database integration", false, error.message);
    }
}

async function testSecurityAspects() {
    console.log("\n=== Testing Security Aspects ===");
    
    // Test that sensitive data is not logged
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    let loggedContent = [];
    
    console.log = (...args) => {
        loggedContent.push(args.join(' '));
        originalConsoleLog(...args);
    };
    
    console.error = (...args) => {
        loggedContent.push(args.join(' '));
        originalConsoleError(...args);
    };
    
    try {
        await importKeyFromNsec("SecurityTest", TEST_KEYS[2].nsec);
    } catch (error) {
        // Expected if key already exists
    }
    
    // Restore original console functions
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    
    // Check if nsec appears in logs
    const nsecInLogs = loggedContent.some(log => log.includes(TEST_KEYS[2].nsec));
    logTest("No nsec in logs", !nsecInLogs, 
        `Checked ${loggedContent.length} log entries, nsec found: ${nsecInLogs}`);
    
    // Check if private key hex appears in logs
    const decoded = decodeNsec(TEST_KEYS[2].nsec);
    const privKeyHex = Buffer.from(decoded).toString('hex');
    const privKeyInLogs = loggedContent.some(log => log.includes(privKeyHex));
    logTest("No private key in logs", !privKeyInLogs, 
        `Private key hex found in logs: ${privKeyInLogs}`);
}

async function cleanupTestData() {
    console.log("\n=== Cleaning Up Test Data ===");
    
    try {
        // Note: In a real scenario, you might want to clean up test data
        // For now, we'll just report what would be cleaned
        const allKeys = await getAllKeys();
        const testKeys = allKeys.filter(k => k.name.startsWith("Test") || k.name.includes("SecurityTest"));
        
        console.log(`Found ${testKeys.length} test keys that could be cleaned up:`);
        testKeys.forEach(key => console.log(`  - ${key.name} (${key.npub.substring(0, 20)}...)`));
        
        logTest("Test data identified for cleanup", true, `${testKeys.length} test keys found`);
    } catch (error) {
        logTest("Cleanup identification", false, error.message);
    }
}

async function runAllTests() {
    console.log("🧪 Starting Comprehensive Import Nsec Keys Testing");
    console.log("=" .repeat(60));
    
    try {
        await connectDB();
        console.log("✅ Database connected");
        
        await testValidation();
        await testImportFunction();
        await testDatabaseIntegration();
        await testSecurityAspects();
        await cleanupTestData();
        
    } catch (error) {
        console.error("❌ Test setup failed:", error.message);
        process.exit(1);
    }
    
    // Print summary
    console.log("\n" + "=" .repeat(60));
    console.log("🏁 TEST SUMMARY");
    console.log("=" .repeat(60));
    console.log(`✅ Passed: ${testResults.passed}`);
    console.log(`❌ Failed: ${testResults.failed}`);
    console.log(`📊 Total: ${testResults.passed + testResults.failed}`);
    console.log(`📈 Success Rate: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1)}%`);
    
    if (testResults.failed > 0) {
        console.log("\n❌ FAILED TESTS:");
        testResults.details.filter(t => !t.passed).forEach(test => {
            console.log(`  - ${test.testName}: ${test.details}`);
        });
    }
    
    process.exit(testResults.failed > 0 ? 1 : 0);
}

runAllTests().catch(error => {
    console.error("💥 Unexpected error:", error);
    process.exit(1);
});