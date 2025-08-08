#!/usr/bin/env node
// CLI Import Flow Testing Script
import "dotenv/config";
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import connectDB from "../../src/config/db.js";
import { getAllKeys } from "../../src/services/identity.service.js";

const TEST_NSEC = "nsec1p00px962gxlz7c4lasd4zrjxy4hdl9lyq9tc05laac4zhm8esukqzkydsy";
const TEST_NAME = "CLITestUser";

async function testCLIFlow(testName, inputs, expectedOutcomes) {
    console.log(`\n🧪 Testing: ${testName}`);
    console.log("=" .repeat(50));
    
    return new Promise((resolve) => {
        const child = spawn('node', ['index.js'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd()
        });
        
        let output = '';
        let currentInputIndex = 0;
        let testResults = {
            passed: [],
            failed: [],
            output: ''
        };
        
        child.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            console.log('STDOUT:', text.trim());
            
            // Check for expected outcomes
            expectedOutcomes.forEach(outcome => {
                if (text.includes(outcome.text)) {
                    if (outcome.shouldAppear) {
                        testResults.passed.push(`✅ Found expected: "${outcome.text}"`);
                    } else {
                        testResults.failed.push(`❌ Found unexpected: "${outcome.text}"`);
                    }
                }
            });
            
            // Send next input if available
            if (currentInputIndex < inputs.length) {
                const nextInput = inputs[currentInputIndex];
                if (text.includes(nextInput.trigger)) {
                    setTimeout(() => {
                        console.log(`SENDING: ${nextInput.response}`);
                        child.stdin.write(nextInput.response + '\n');
                        currentInputIndex++;
                    }, 100);
                }
            }
        });
        
        child.stderr.on('data', (data) => {
            const text = data.toString();
            console.log('STDERR:', text.trim());
            output += text;
        });
        
        child.on('close', (code) => {
            testResults.output = output;
            console.log(`Process exited with code: ${code}`);
            resolve(testResults);
        });
        
        // Timeout after 30 seconds
        setTimeout(() => {
            child.kill();
            testResults.failed.push('❌ Test timed out');
            resolve(testResults);
        }, 30000);
    });
}

async function runCLITests() {
    console.log("🚀 Starting CLI Import Flow Tests");
    console.log("=" .repeat(60));
    
    try {
        await connectDB();
        console.log("✅ Database connected");
        
        // Test 1: Security Warning Cancellation
        console.log("\n📋 Test 1: Security Warning Cancellation");
        const cancelTest = await testCLIFlow(
            "Security Warning Cancellation",
            [
                { trigger: "Enter number, n, or i:", response: "i" },
                { trigger: "Continue? (y/n)", response: "n" }
            ],
            [
                { text: "SECURITY WARNING", shouldAppear: true },
                { text: "Import cancelled", shouldAppear: true },
                { text: "Enter number, n, or i:", shouldAppear: true } // Should return to menu
            ]
        );
        
        console.log("\n📊 Cancel Test Results:");
        cancelTest.passed.forEach(p => console.log(p));
        cancelTest.failed.forEach(f => console.log(f));
        
        // Test 2: Empty nsec input
        console.log("\n📋 Test 2: Empty nsec input");
        const emptyNsecTest = await testCLIFlow(
            "Empty nsec input",
            [
                { trigger: "Enter number, n, or i:", response: "i" },
                { trigger: "Continue? (y/n)", response: "y" },
                { trigger: "Enter your nsec private key:", response: "" }
            ],
            [
                { text: "nsec is required", shouldAppear: true },
                { text: "Returning to menu", shouldAppear: true }
            ]
        );
        
        console.log("\n📊 Empty nsec Test Results:");
        emptyNsecTest.passed.forEach(p => console.log(p));
        emptyNsecTest.failed.forEach(f => console.log(f));
        
        // Test 3: Empty name input
        console.log("\n📋 Test 3: Empty name input");
        const emptyNameTest = await testCLIFlow(
            "Empty name input",
            [
                { trigger: "Enter number, n, or i:", response: "i" },
                { trigger: "Continue? (y/n)", response: "y" },
                { trigger: "Enter your nsec private key:", response: TEST_NSEC },
                { trigger: "Enter a name/label for this identity:", response: "" }
            ],
            [
                { text: "Name is required", shouldAppear: true },
                { text: "Returning to menu", shouldAppear: true }
            ]
        );
        
        console.log("\n📊 Empty name Test Results:");
        emptyNameTest.passed.forEach(p => console.log(p));
        emptyNameTest.failed.forEach(f => console.log(f));
        
        // Test 4: Invalid nsec format
        console.log("\n📋 Test 4: Invalid nsec format");
        const invalidNsecTest = await testCLIFlow(
            "Invalid nsec format",
            [
                { trigger: "Enter number, n, or i:", response: "i" },
                { trigger: "Continue? (y/n)", response: "y" },
                { trigger: "Enter your nsec private key:", response: "invalid_nsec_format" },
                { trigger: "Enter a name/label for this identity:", response: "InvalidTest" }
            ],
            [
                { text: "Import failed", shouldAppear: true },
                { text: "Invalid nsec", shouldAppear: true },
                { text: "Returning to menu", shouldAppear: true }
            ]
        );
        
        console.log("\n📊 Invalid nsec Test Results:");
        invalidNsecTest.passed.forEach(p => console.log(p));
        invalidNsecTest.failed.forEach(f => console.log(f));
        
        // Check for sensitive data in outputs
        console.log("\n🔒 Security Check: Sensitive Data in CLI Output");
        const allOutputs = [cancelTest.output, emptyNsecTest.output, emptyNameTest.output, invalidNsecTest.output];
        let sensitiveDataFound = false;
        
        allOutputs.forEach((output, index) => {
            if (output.includes(TEST_NSEC)) {
                console.log(`❌ Test ${index + 1}: nsec found in output`);
                sensitiveDataFound = true;
            } else {
                console.log(`✅ Test ${index + 1}: No nsec in output`);
            }
        });
        
        if (!sensitiveDataFound) {
            console.log("✅ Overall: No sensitive data found in CLI outputs");
        }
        
    } catch (error) {
        console.error("❌ CLI test setup failed:", error.message);
    }
}

// Check if we can run the tests
if (process.argv.includes('--run')) {
    runCLITests().catch(console.error);
} else {
    console.log("CLI Test Script Created");
    console.log("To run: node doc/temp/test-cli-import-flow.js --run");
    console.log("Note: This will spawn multiple CLI processes for testing");
}