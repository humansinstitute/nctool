import crypto from "crypto";
import { getPublicKey, nip19, nip04 } from "nostr-tools";
import { CashuMint, CashuWallet, getEncodedToken } from "@cashu/cashu-ts";
import walletRepositoryService from "./walletRepository.service.js";
import { logger } from "../utils/logger.js";
import https from "https";
import fetch from "node-fetch";

// Mint configuration
const MINT_URL = process.env.MINT_URL || "https://mint.minibits.cash/Bitcoin";

/**
 * Create a custom HTTPS agent that works with the mint server
 * This fixes Node.js connectivity issues with the mint server
 */
function createMintAgent() {
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
 * Configure fetch with the custom agent for mint connectivity
 */
export function createMintFetch() {
  const agent = createMintAgent();

  return (url, options = {}) => {
    return fetch(url, {
      ...options,
      agent: agent,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "nctool/1.0",
        ...options.headers,
      },
    });
  };
}

// Create the custom fetch instance for mint operations
const mintFetch = createMintFetch();

/**
 * Patch global fetch to use our custom HTTPS agent for Cashu library compatibility
 * This ensures the Cashu library uses our connectivity fixes
 */
function patchGlobalFetch() {
  const originalFetch = global.fetch;

  // Store reference to node-fetch if it exists
  if (!originalFetch && typeof fetch !== "undefined") {
    global.fetch = fetch;
  }

  // Override global fetch with our custom implementation
  global.fetch = (url, options = {}) => {
    // Use our custom fetch for mint URLs
    if (
      typeof url === "string" &&
      (url.includes("mint.minibits.cash") ||
        url.includes("testnut.cashu.space"))
    ) {
      logger.debug("Using custom fetch for mint URL", {
        url: url.substring(0, 50),
      });
      return mintFetch(url, options);
    }

    // Use original fetch for other URLs
    if (originalFetch) {
      return originalFetch(url, options);
    }

    // Fallback to node-fetch
    return fetch(url, options);
  };

  logger.info("Global fetch patched for Cashu library compatibility");
}

// Apply the patch immediately
patchGlobalFetch();

/**
 * Generates a P2PK keypair for an eCash wallet.
 * @returns {{ privkey: string, pubkey: string }} Private key and public key (hex without prefix).
 */
export function generateP2PKKeypair() {
  try {
    const privkey = crypto.randomBytes(32).toString("hex");
    const fullPubKey = getPublicKey(privkey);
    // Remove '02' prefix for storage per NIP-61
    const pubkey = fullPubKey.startsWith("02")
      ? fullPubKey.slice(2)
      : fullPubKey;
    return { privkey, pubkey };
  } catch (error) {
    console.error("Error generating P2PK keypair:", error);
    throw error;
  }
}

/**
 * Checks if a wallet metadata event (kind 17375) exists for the given user.
 * @param {string} npub - User's Nostr npub string.
 * @param {NDK} ndk - Connected NDK instance.
 * @returns {Promise<boolean>} True if a wallet event exists, false otherwise.
 */
export async function checkWalletExists(npub, ndk) {
  try {
    const { data: pubHex } = nip19.decode(npub);
    const events = await ndk.fetchEvents({
      authors: [pubHex],
      kinds: [17375],
      limit: 1,
    });
    return events.size > 0;
  } catch (error) {
    console.error("Error checking wallet existence:", error);
    throw error;
  }
}

/**
 * Retrieves and decrypts the wallet metadata for the given user.
 * @param {string} npub - User's Nostr npub string.
 * @param {string} nsec - User's Nostr nsec (private key).
 * @param {NDK} ndk - Connected NDK instance.
 * @returns {Promise<{ mint: string, p2pkPriv: string, p2pkPub: string } | null>}
 */
export async function getWalletDetails(npub, nsec, ndk) {
  try {
    const { data: pubHex } = nip19.decode(npub);
    const { data: privHex } = nip19.decode(nsec);

    const walletEvents = await ndk.fetchEvents({
      authors: [pubHex],
      kinds: [17375],
      limit: 1,
    });
    if (walletEvents.size === 0) {
      return null;
    }
    const [event] = [...walletEvents];
    // Decrypt the content
    const decrypted = await nip04.decrypt(privHex, pubHex, event.content);
    const { mint, p2pkPriv } = JSON.parse(decrypted);

    // Fetch Nutzap info event (kind 10019) to get the public receiving key
    const infoEvents = await ndk.fetchEvents({
      authors: [pubHex],
      kinds: [10019],
      limit: 1,
    });
    let p2pkPub = null;
    if (infoEvents.size > 0) {
      const [info] = [...infoEvents];
      const tag = info.tags.find((t) => t[0] === "pubkey");
      if (tag && tag[1]) {
        p2pkPub = tag[1].startsWith("02") ? tag[1].slice(2) : tag[1];
      }
    }

    return { mint, p2pkPriv, p2pkPub };
  } catch (error) {
    console.error("Error getting wallet details:", error);
    throw error;
  }
}

/**
 * Test mint connectivity with comprehensive diagnostics
 * @param {string} mintUrl - Mint URL to test
 * @returns {Promise<Object>} Connectivity test results
 */
async function testMintConnectivity(mintUrl) {
  const testResults = {
    mintUrl,
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    tests: {
      httpConnectivity: { success: false, error: null, duration: 0 },
      mintInfo: { success: false, error: null, duration: 0, data: null },
      cashuLibrary: { success: false, error: null, duration: 0 },
    },
    overall: { success: false, error: null },
  };

  try {
    logger.info("Starting comprehensive mint connectivity test", { mintUrl });

    // Test 1: Basic HTTP connectivity
    const httpStart = Date.now();
    try {
      const response = await mintFetch(`${mintUrl}/v1/info`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });

      testResults.tests.httpConnectivity.duration = Date.now() - httpStart;

      if (response.ok) {
        testResults.tests.httpConnectivity.success = true;
        logger.debug("HTTP connectivity test passed", {
          mintUrl,
          status: response.status,
          duration: testResults.tests.httpConnectivity.duration,
        });
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      testResults.tests.httpConnectivity.duration = Date.now() - httpStart;
      testResults.tests.httpConnectivity.error = {
        name: error.name,
        message: error.message,
        code: error.code,
        cause: error.cause,
      };
      logger.warn("HTTP connectivity test failed", {
        mintUrl,
        error: error.message,
        duration: testResults.tests.httpConnectivity.duration,
      });
    }

    // Test 2: Mint info retrieval
    const infoStart = Date.now();
    try {
      const mint = new CashuMint(mintUrl);
      const info = await mint.getInfo();

      testResults.tests.mintInfo.duration = Date.now() - infoStart;
      testResults.tests.mintInfo.success = true;
      testResults.tests.mintInfo.data = {
        name: info.name,
        version: info.version,
        description: info.description,
        nuts: Object.keys(info.nuts || {}),
      };

      logger.debug("Mint info test passed", {
        mintUrl,
        mintName: info.name,
        duration: testResults.tests.mintInfo.duration,
      });
    } catch (error) {
      testResults.tests.mintInfo.duration = Date.now() - infoStart;
      testResults.tests.mintInfo.error = {
        name: error.name,
        message: error.message,
        code: error.code,
        cause: error.cause,
        stack: error.stack?.split("\n").slice(0, 3),
      };
      logger.warn("Mint info test failed", {
        mintUrl,
        error: error.message,
        duration: testResults.tests.mintInfo.duration,
      });
    }

    // Test 3: Cashu library initialization
    const libStart = Date.now();
    try {
      const mint = new CashuMint(mintUrl);
      const wallet = new CashuWallet(mint, { unit: "sat" });

      // Test basic wallet functionality
      if (wallet && typeof wallet.createMintQuote === "function") {
        testResults.tests.cashuLibrary.duration = Date.now() - libStart;
        testResults.tests.cashuLibrary.success = true;
        logger.debug("Cashu library test passed", {
          mintUrl,
          duration: testResults.tests.cashuLibrary.duration,
        });
      } else {
        throw new Error(
          "Wallet initialization succeeded but missing expected methods"
        );
      }
    } catch (error) {
      testResults.tests.cashuLibrary.duration = Date.now() - libStart;
      testResults.tests.cashuLibrary.error = {
        name: error.name,
        message: error.message,
        code: error.code,
        cause: error.cause,
        stack: error.stack?.split("\n").slice(0, 3),
      };
      logger.warn("Cashu library test failed", {
        mintUrl,
        error: error.message,
        duration: testResults.tests.cashuLibrary.duration,
      });
    }

    // Determine overall success
    const allTests = Object.values(testResults.tests);
    const successfulTests = allTests.filter((test) => test.success).length;
    const totalTests = allTests.length;

    testResults.overall.success = successfulTests === totalTests;

    if (!testResults.overall.success) {
      const failedTests = allTests.filter((test) => !test.success);
      testResults.overall.error = `${
        failedTests.length
      }/${totalTests} tests failed: ${failedTests
        .map((test) =>
          Object.keys(testResults.tests).find(
            (key) => testResults.tests[key] === test
          )
        )
        .join(", ")}`;
    }

    logger.info("Mint connectivity test completed", {
      mintUrl,
      success: testResults.overall.success,
      successfulTests: `${successfulTests}/${totalTests}`,
      totalDuration: allTests.reduce((sum, test) => sum + test.duration, 0),
    });

    return testResults;
  } catch (error) {
    testResults.overall.error = {
      name: error.name,
      message: error.message,
      code: error.code,
      cause: error.cause,
      stack: error.stack?.split("\n").slice(0, 5),
    };

    logger.error("Mint connectivity test failed with unexpected error", {
      mintUrl,
      error: error.message,
      stack: error.stack,
    });

    return testResults;
  }
}

// ==================== ENHANCED CASHU SERVICE LAYER ====================

/**
 * Initialize a CashuWallet instance for a user with enhanced connectivity testing
 * @param {string} npub - User's Nostr npub string
 * @param {boolean} [testConnectivity=false] - Whether to run connectivity tests
 * @returns {Promise<{wallet: CashuWallet, walletDoc: Object, mint: CashuMint, connectivityTest?: Object}>} Initialized wallet instance and components
 */
export async function initializeWallet(npub, testConnectivity = false) {
  try {
    logger.info("Initializing Cashu wallet with per-request mint", {
      npub,
      mintUrl: MINT_URL,
      testConnectivity,
    });

    let connectivityTestResult = null;

    // Run connectivity test if requested
    if (testConnectivity) {
      logger.info("Running mint connectivity test", {
        npub,
        mintUrl: MINT_URL,
      });
      connectivityTestResult = await testMintConnectivity(MINT_URL);

      if (!connectivityTestResult.overall.success) {
        const error = new Error(
          `Mint connectivity test failed: ${connectivityTestResult.overall.error}`
        );
        error.connectivityTest = connectivityTestResult;
        throw error;
      }

      logger.info("Mint connectivity test passed", {
        npub,
        mintUrl: MINT_URL,
        successfulTests: Object.values(connectivityTestResult.tests).filter(
          (t) => t.success
        ).length,
      });
    }

    // Create fresh mint instance per request (no global state)
    const mint = new CashuMint(MINT_URL);

    // Test basic mint functionality
    try {
      await mint.getInfo();
      logger.debug("Mint info retrieval successful", {
        npub,
        mintUrl: MINT_URL,
      });
    } catch (mintError) {
      logger.error("Failed to retrieve mint info during initialization", {
        npub,
        mintUrl: MINT_URL,
        error: mintError.message,
        errorName: mintError.name,
        errorCode: mintError.code,
      });
      throw new Error(`Mint not accessible: ${mintError.message}`);
    }

    // Find or create wallet in database
    let walletDoc = await walletRepositoryService.findWallet(npub, MINT_URL);

    if (!walletDoc) {
      // Generate new P2PK keypair for wallet
      const { privkey, pubkey } = generateP2PKKeypair();

      // Create wallet in database
      walletDoc = await walletRepositoryService.createWallet({
        npub,
        mint_url: MINT_URL,
        p2pk_pubkey: pubkey,
        p2pk_privkey: privkey, // In production, this should be encrypted
        wallet_config: { unit: "sat" },
      });

      logger.info("Created new wallet in database", {
        npub,
        walletId: walletDoc._id,
        p2pkPubkey: pubkey,
      });
    }

    // Initialize CashuWallet instance with fresh mint
    const wallet = new CashuWallet(mint, {
      unit: walletDoc.wallet_config?.unit || "sat",
    });

    // Load mint keysets - CRITICAL FIX for Lightning Melt operations
    await wallet.loadMint();

    // Validate wallet initialization
    if (!wallet || typeof wallet.createMintQuote !== "function") {
      throw new Error(
        "Wallet initialization failed - missing required methods"
      );
    }

    logger.info("Cashu wallet initialized successfully", {
      npub,
      mintUrl: MINT_URL,
      walletId: walletDoc._id,
      hasConnectivityTest: !!connectivityTestResult,
      keysets: wallet.keysets?.length || 0, // Verify keysets loaded
    });

    const result = { wallet, walletDoc, mint };
    if (connectivityTestResult) {
      result.connectivityTest = connectivityTestResult;
    }

    return result;
  } catch (error) {
    // Enhanced error logging with environment details
    const errorDetails = {
      npub,
      mintUrl: MINT_URL,
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        cause: error.cause,
        stack: error.stack?.split("\n").slice(0, 5),
      },
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        timestamp: new Date().toISOString(),
      },
      connectivityTest: error.connectivityTest || null,
    };

    logger.error("Failed to initialize Cashu wallet", errorDetails);

    // Preserve connectivity test data in error
    const enhancedError = new Error(
      `Failed to initialize wallet: ${error.message}`
    );
    if (error.connectivityTest) {
      enhancedError.connectivityTest = error.connectivityTest;
    }

    throw enhancedError;
  }
}

/**
 * Create mint quote and mint tokens from Lightning with enhanced error diagnostics
 * @param {string} npub - User's Nostr npub string
 * @param {number} amount - Amount to mint in satoshis
 * @param {boolean} [testConnectivity=false] - Whether to run connectivity tests on failure
 * @returns {Promise<Object>} Mint result with quote and proofs
 */
export async function mintTokens(npub, amount, testConnectivity = false) {
  const operationStart = Date.now();

  try {
    logger.info("Starting enhanced mint tokens operation", {
      npub,
      amount,
      testConnectivity,
      timestamp: new Date().toISOString(),
    });

    // Initialize wallet with optional connectivity testing
    const { wallet, walletDoc, mint } = await initializeWallet(
      npub,
      testConnectivity
    );

    logger.info("Wallet initialized successfully, creating mint quote", {
      npub,
      amount,
      mintUrl: MINT_URL,
      walletId: walletDoc._id,
    });

    // Create mint quote with comprehensive error handling
    let mintQuote;
    try {
      const quoteStart = Date.now();
      mintQuote = await wallet.createMintQuote(amount);
      const quoteDuration = Date.now() - quoteStart;

      logger.info("Created mint quote successfully", {
        npub,
        amount,
        quoteId: mintQuote.quote,
        invoice: mintQuote.request,
        quoteDuration,
        expiry: mintQuote.expiry,
      });
    } catch (quoteError) {
      // Enhanced error logging for mint quote creation failure
      const errorDetails = {
        npub,
        amount,
        mintUrl: MINT_URL,
        operation: "createMintQuote",
        error: {
          name: quoteError.name,
          message: quoteError.message,
          code: quoteError.code,
          cause: quoteError.cause,
          stack: quoteError.stack?.split("\n").slice(0, 10),
        },
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          timestamp: new Date().toISOString(),
          operationDuration: Date.now() - operationStart,
        },
        walletState: {
          walletId: walletDoc._id,
          hasWallet: !!wallet,
          hasMint: !!mint,
          walletMethods: wallet
            ? Object.getOwnPropertyNames(Object.getPrototypeOf(wallet))
            : null,
        },
      };

      logger.error(
        "CRITICAL: Mint quote creation failed - this is the reported issue",
        errorDetails
      );

      // If connectivity testing wasn't done initially and this is the main error, run it now
      if (!testConnectivity) {
        logger.info(
          "Running connectivity test to diagnose mint quote failure",
          { npub, amount }
        );
        try {
          const connectivityTest = await testMintConnectivity(MINT_URL);
          errorDetails.connectivityTest = connectivityTest;

          logger.error("Connectivity test results for failed mint quote", {
            npub,
            amount,
            connectivityTest: {
              overall: connectivityTest.overall,
              httpConnectivity: connectivityTest.tests.httpConnectivity.success,
              mintInfo: connectivityTest.tests.mintInfo.success,
              cashuLibrary: connectivityTest.tests.cashuLibrary.success,
            },
          });
        } catch (connectivityError) {
          logger.error("Connectivity test also failed", {
            npub,
            amount,
            connectivityError: connectivityError.message,
          });
          errorDetails.connectivityTestError = connectivityError.message;
        }
      }

      // Create enhanced error with all diagnostic information
      const enhancedError = new Error(
        `Failed to create mint quote: ${quoteError.message}`
      );
      enhancedError.diagnostics = errorDetails;
      enhancedError.originalError = quoteError;

      throw enhancedError;
    }

    // Generate transaction ID
    const transactionId = walletRepositoryService.generateTransactionId("mint");

    // Create a pending mint transaction record for tracking
    await walletRepositoryService.storeTokens({
      npub,
      wallet_id: walletDoc._id,
      proofs: [], // Empty proofs array for pending transaction
      mint_url: MINT_URL,
      transaction_type: "minted",
      transaction_id: transactionId,
      status: "pending", // Mark as pending until payment is confirmed
      total_amount: 0, // Explicitly set to 0 for pending transactions
      metadata: {
        source: "lightning",
        quote_id: mintQuote.quote,
        mint_amount: amount,
        invoice: mintQuote.request,
        expiry: mintQuote.expiry,
        created_at: new Date(),
        pending_amount: amount, // Track the expected amount when completed
      },
    });

    logger.info("Created pending mint transaction record", {
      npub,
      quoteId: mintQuote.quote,
      transactionId,
      amount,
    });

    // Start background polling for payment completion
    startMintPolling(npub, mintQuote.quote, amount, transactionId);

    logger.info("Started background polling for mint completion", {
      npub,
      quoteId: mintQuote.quote,
      pollingDuration: "3 minutes",
      pollingInterval: "10 seconds",
    });

    const operationDuration = Date.now() - operationStart;
    logger.info("Mint tokens operation completed successfully", {
      npub,
      amount,
      transactionId,
      quoteId: mintQuote.quote,
      operationDuration,
    });

    return {
      quote: mintQuote.quote,
      invoice: mintQuote.request,
      amount,
      transactionId,
      expiry: mintQuote.expiry,
      mintUrl: MINT_URL,
    };
  } catch (error) {
    const operationDuration = Date.now() - operationStart;

    // Enhanced error logging for any other failures
    const errorContext = {
      npub,
      amount,
      testConnectivity,
      operationDuration,
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        cause: error.cause,
        stack: error.stack?.split("\n").slice(0, 5),
      },
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        timestamp: new Date().toISOString(),
      },
      diagnostics: error.diagnostics || null,
    };

    logger.error("Enhanced mint tokens operation failed", errorContext);

    // Preserve diagnostic information in the thrown error
    const enhancedError = new Error(`Failed to mint tokens: ${error.message}`);
    if (error.diagnostics) {
      enhancedError.diagnostics = error.diagnostics;
    }
    if (error.originalError) {
      enhancedError.originalError = error.originalError;
    }

    throw enhancedError;
  }
}

/**
 * Complete minting process after Lightning invoice is paid
 * Enhanced version with race condition protection and better error handling
 * @param {string} npub - User's Nostr npub string
 * @param {string} quoteId - Mint quote ID
 * @param {number} amount - Amount to mint
 * @param {string} transactionId - Transaction ID
 * @returns {Promise<Object>} Minted proofs and token storage result
 */
export async function completeMinting(npub, quoteId, amount, transactionId) {
  try {
    logger.info("Starting enhanced minting completion", {
      npub,
      quoteId,
      amount,
      transactionId,
    });

    const { wallet, walletDoc } = await initializeWallet(npub);

    // Double-check quote is still paid (race condition protection)
    const quoteStatus = await wallet.checkMintQuote(quoteId);
    if (quoteStatus.state !== "PAID") {
      throw new Error(
        `Quote status changed to ${quoteStatus.state} during completion`
      );
    }

    // Check if transaction was already completed (race condition protection)
    const existingTokens =
      await walletRepositoryService.findTokensByTransactionId(transactionId);
    const pendingToken = existingTokens.find((t) => t.status === "pending");

    if (!pendingToken) {
      // Check if already completed
      const completedToken = existingTokens.find((t) => t.status === "unspent");
      if (completedToken) {
        logger.warn("Transaction already completed", {
          npub,
          quoteId,
          transactionId,
          tokenId: completedToken._id,
        });
        return {
          proofs: completedToken.proofs,
          tokenId: completedToken._id,
          transactionId,
          totalAmount: completedToken.total_amount,
          alreadyCompleted: true,
        };
      }
      throw new Error(`No pending transaction found for ID: ${transactionId}`);
    }

    // Mint the proofs
    logger.info("Minting proofs", { npub, quoteId, amount });
    const proofs = await wallet.mintProofs(amount, quoteId);

    if (!proofs || proofs.length === 0) {
      throw new Error("No proofs returned from minting operation");
    }

    const totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0);

    logger.info("Successfully minted proofs", {
      npub,
      quoteId,
      proofsCount: proofs.length,
      totalAmount,
      expectedAmount: amount,
    });

    // Validate minted amount matches expected
    if (totalAmount !== amount) {
      logger.warn("Minted amount differs from expected", {
        npub,
        quoteId,
        expectedAmount: amount,
        actualAmount: totalAmount,
        difference: totalAmount - amount,
      });
    }

    // Update the pending transaction with enhanced validation
    const tokenDoc = await walletRepositoryService.updatePendingTransaction(
      pendingToken._id,
      {
        proofs,
        status: "unspent",
        total_amount: totalAmount,
        metadata: {
          ...pendingToken.metadata,
          completed_at: new Date(),
          completion_method: "background_polling",
          actual_minted_amount: totalAmount,
          proofs_count: proofs.length,
        },
      }
    );

    logger.info("Successfully updated pending transaction", {
      npub,
      tokenId: tokenDoc._id,
      transactionId,
      proofsCount: proofs.length,
      totalAmount,
    });

    return {
      proofs,
      tokenId: tokenDoc._id,
      transactionId,
      totalAmount,
      alreadyCompleted: false,
    };
  } catch (error) {
    logger.error("Enhanced minting completion failed", {
      npub,
      quoteId,
      amount,
      transactionId,
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`Failed to complete minting: ${error.message}`);
  }
}

/**
 * Send tokens to another user
 * @param {string} npub - Sender's Nostr npub string
 * @param {number} amount - Amount to send in satoshis
 * @param {string} [recipientPubkey] - Optional recipient P2PK public key
 * @returns {Promise<Object>} Encoded token and change information
 */
export async function sendTokens(npub, amount, recipientPubkey = null) {
  try {
    logger.info("Starting send tokens operation", {
      npub,
      amount,
      recipientPubkey,
    });

    const { wallet, walletDoc } = await initializeWallet(npub);

    // Select tokens for spending
    const selection = await walletRepositoryService.selectTokensForSpending(
      npub,
      amount,
      MINT_URL
    );
    logger.info("Selected tokens for spending", {
      npub,
      amount,
      selectedAmount: selection.total_selected,
      changeAmount: selection.change_amount,
      tokenCount: selection.selected_tokens.length,
    });

    // Collect all proofs from selected tokens
    const allProofs = [];
    const tokenIds = [];

    for (const token of selection.selected_tokens) {
      allProofs.push(...token.proofs);
      tokenIds.push(token._id);
    }

    // Create send transaction with optional P2PK
    const sendOptions = recipientPubkey ? { pubkey: recipientPubkey } : {};
    const sendResponse = await wallet.send(amount, allProofs, sendOptions);

    logger.info("Created send transaction", {
      npub,
      amount,
      sendProofsCount: sendResponse.send.length,
      keepProofsCount: sendResponse.keep.length,
    });

    // Generate transaction ID
    const transactionId = walletRepositoryService.generateTransactionId("send");

    // Mark spent tokens as spent
    await walletRepositoryService.markTokensAsSpent(tokenIds);

    // Store sent tokens record for transaction history
    await walletRepositoryService.storeTokens({
      npub,
      wallet_id: walletDoc._id,
      proofs: sendResponse.send,
      mint_url: MINT_URL,
      transaction_type: "sent",
      transaction_id: transactionId,
      metadata: {
        source: "p2p",
        recipient_pubkey: recipientPubkey,
        sent_amount: amount,
        original_amount: selection.total_selected,
      },
    });

    // Store change tokens if any
    if (sendResponse.keep.length > 0) {
      await walletRepositoryService.storeTokens({
        npub,
        wallet_id: walletDoc._id,
        proofs: sendResponse.keep,
        mint_url: MINT_URL,
        transaction_type: "change",
        transaction_id: transactionId,
        metadata: {
          source: "change",
          original_amount: selection.total_selected,
          sent_amount: amount,
          change_amount: selection.change_amount,
        },
      });
    }

    // Encode tokens for sharing
    const encodedToken = getEncodedToken({
      mint: MINT_URL,
      proofs: sendResponse.send,
    });

    logger.info("Successfully created send tokens", {
      npub,
      amount,
      transactionId,
      encodedTokenLength: encodedToken.length,
    });

    return {
      encodedToken,
      transactionId,
      amount,
      changeAmount: selection.change_amount,
      recipientPubkey,
      mintUrl: MINT_URL,
    };
  } catch (error) {
    logger.error("Failed to send tokens", {
      npub,
      amount,
      recipientPubkey,
      error: error.message,
    });
    throw new Error(`Failed to send tokens: ${error.message}`);
  }
}

/**
 * Receive tokens from encoded token
 * @param {string} npub - Receiver's Nostr npub string
 * @param {string} encodedToken - Encoded token string
 * @param {string} [privateKey] - Optional private key for P2PK tokens
 * @returns {Promise<Object>} Received proofs and storage result
 */
export async function receiveTokens(npub, encodedToken, privateKey = null) {
  try {
    logger.info("Starting receive tokens operation", {
      npub,
      hasPrivateKey: !!privateKey,
    });

    const { wallet, walletDoc } = await initializeWallet(npub);

    // Receive tokens with optional private key for P2PK
    const receiveOptions = privateKey ? { privkey: privateKey } : {};
    const receivedProofs = await wallet.receive(encodedToken, receiveOptions);

    const totalAmount = receivedProofs.reduce(
      (sum, proof) => sum + proof.amount,
      0
    );
    logger.info("Successfully received proofs", {
      npub,
      proofsCount: receivedProofs.length,
      totalAmount,
    });

    // Generate transaction ID
    const transactionId =
      walletRepositoryService.generateTransactionId("receive");

    // Store received tokens
    const tokenDoc = await walletRepositoryService.storeTokens({
      npub,
      wallet_id: walletDoc._id,
      proofs: receivedProofs,
      mint_url: MINT_URL,
      transaction_type: "received",
      transaction_id: transactionId,
      metadata: {
        source: "p2p",
        encoded_token: encodedToken,
        encoded_token_length: encodedToken.length,
        used_private_key: !!privateKey,
      },
    });

    logger.info("Stored received tokens in database", {
      npub,
      tokenId: tokenDoc._id,
      transactionId,
      totalAmount,
    });

    return {
      proofs: receivedProofs,
      tokenId: tokenDoc._id,
      transactionId,
      totalAmount,
      mintUrl: MINT_URL,
    };
  } catch (error) {
    logger.error("Failed to receive tokens", {
      npub,
      hasPrivateKey: !!privateKey,
      error: error.message,
    });
    throw new Error(`Failed to receive tokens: ${error.message}`);
  }
}

/**
 * Pay Lightning invoice with tokens (melt operation) with atomic transactions and state consistency
 * @param {string} npub - User's Nostr npub string
 * @param {string} invoice - Lightning invoice to pay
 * @returns {Promise<Object>} Payment result and change information
 */
export async function meltTokens(npub, invoice) {
  try {
    logger.info(
      "Starting atomic melt tokens operation with state consistency",
      {
        npub,
        invoice: invoice.substring(0, 50) + "...",
      }
    );

    // Step 1: Run state reconciliation before operation to ensure consistency
    logger.info("Running proof state reconciliation before melt operation", {
      npub,
    });
    const reconciliationResult = await reconcileProofStates(npub);

    if (
      !reconciliationResult.consistent &&
      reconciliationResult.reconciled === 0
    ) {
      logger.warn(
        "State inconsistencies detected but could not be reconciled",
        {
          npub,
          discrepancies: reconciliationResult.changes.length,
          errors: reconciliationResult.errors,
        }
      );

      // Continue with operation but log the warning
    } else if (reconciliationResult.reconciled > 0) {
      logger.info("State reconciliation completed before melt", {
        npub,
        reconciled: reconciliationResult.reconciled,
        nowConsistent: reconciliationResult.consistent,
      });
    }

    const { wallet, walletDoc } = await initializeWallet(npub);

    // Create melt quote
    const meltQuote = await wallet.createMeltQuote(invoice);
    const totalNeeded = meltQuote.amount + meltQuote.fee_reserve;

    logger.info("Created melt quote", {
      npub,
      invoiceAmount: meltQuote.amount,
      feeReserve: meltQuote.fee_reserve,
      totalNeeded,
      quoteId: meltQuote.quote,
    });

    // Select tokens for spending (including fees)
    const selection = await walletRepositoryService.selectTokensForSpending(
      npub,
      totalNeeded,
      MINT_URL
    );

    logger.info("Token selection completed", {
      npub,
      totalNeeded,
      selectedTokensCount: selection.selected_tokens.length,
      totalSelected: selection.total_selected,
      changeAmount: selection.change_amount,
    });

    // Collect all proofs from selected tokens
    const allProofs = [];
    const tokenIds = [];

    for (const token of selection.selected_tokens) {
      logger.debug("Processing token for melt", {
        tokenId: token._id,
        totalAmount: token.total_amount,
        proofsCount: token.proofs?.length || 0,
        status: token.status,
      });

      // Convert Mongoose documents to plain objects before passing to Cashu-ts
      const plainProofs = token.proofs.map((proof) =>
        proof.toObject ? proof.toObject() : proof
      );
      allProofs.push(...plainProofs);
      tokenIds.push(token._id);
    }

    // Step 2: Verify proof states BEFORE using them in melt operation
    logger.info("Verifying proof states before melt operation", { npub });
    const proofStateCheck = await checkProofStates(npub, allProofs);

    if (!proofStateCheck.consistent) {
      const criticalIssues = proofStateCheck.discrepancies.filter(
        (d) => d.severity === "HIGH"
      );

      if (criticalIssues.length > 0) {
        logger.error("Critical proof state inconsistencies detected", {
          npub,
          criticalIssues: criticalIssues.length,
          totalDiscrepancies: proofStateCheck.discrepancies.length,
        });

        throw new Error(
          `Cannot proceed with melt: ${criticalIssues.length} proofs are already spent on mint but marked as unspent in database. Please run reconciliation first.`
        );
      }

      logger.warn(
        "Non-critical proof state inconsistencies detected, proceeding with caution",
        {
          npub,
          discrepancies: proofStateCheck.discrepancies.length,
        }
      );
    }

    // Check if any proofs are already spent on the mint
    const spentProofs = proofStateCheck.states.filter((state, index) => {
      return state.state === "SPENT";
    });

    if (spentProofs.length > 0) {
      logger.error("Attempted to use already spent proofs", {
        npub,
        spentProofsCount: spentProofs.length,
        totalProofs: allProofs.length,
      });

      throw new Error(
        `Token already spent: ${spentProofs.length} of ${allProofs.length} selected proofs are already spent on the mint. Database state is inconsistent.`
      );
    }

    logger.info("All proofs verified as unspent, proceeding with melt", {
      npub,
      allProofsCount: allProofs.length,
      totalAmount: allProofs.reduce((sum, p) => sum + (p.amount || 0), 0),
    });

    // Send the required amount for melting with enhanced error handling
    let send, keep;
    try {
      logger.info("Creating send transaction for melt", {
        totalNeeded,
        proofsCount: allProofs.length,
      });

      const result = await wallet.send(totalNeeded, allProofs, {
        includeFees: true,
      });
      send = result.send;
      keep = result.keep;

      logger.info("Send transaction created successfully", {
        sendProofs: send.length,
        keepProofs: keep.length,
      });
    } catch (sendError) {
      logger.error("Send transaction failed", {
        npub,
        error: sendError.message,
        errorName: sendError.name,
        errorCode: sendError.code,
        stack: sendError.stack?.split("\n").slice(0, 5),
      });
      throw new Error(
        `Failed to create send transaction: ${sendError.message}`
      );
    }

    // Execute the melt operation
    let meltResponse;
    try {
      logger.info("Executing melt operation", {
        npub,
        quoteId: meltQuote.quote,
        sendProofsCount: send.length,
      });

      meltResponse = await wallet.meltProofs(meltQuote, send);

      logger.info("Melt operation completed successfully", {
        npub,
        quoteId: meltQuote.quote,
        paymentResult: meltResponse.state,
        changeProofs: meltResponse.change?.length || 0,
      });
    } catch (meltError) {
      logger.error("Melt operation failed", {
        npub,
        quoteId: meltQuote.quote,
        error: meltError.message,
        errorName: meltError.name,
      });
      throw new Error(`Melt operation failed: ${meltError.message}`);
    }

    // Step 3: Execute atomic database operations
    const transactionId = walletRepositoryService.generateTransactionId("melt");

    try {
      logger.info("Executing atomic database operations", {
        npub,
        transactionId,
        tokenIdsToSpend: tokenIds.length,
      });

      const atomicResult = await walletRepositoryService.executeAtomicMelt({
        npub,
        walletId: walletDoc._id,
        tokenIds,
        sendProofs: send,
        keepProofs: keep,
        meltChangeProofs: meltResponse.change || [],
        transactionId,
        meltQuote,
        mintUrl: MINT_URL,
      });

      logger.info("Atomic database operations completed successfully", {
        npub,
        transactionId,
        atomicResult,
      });

      return {
        transactionId,
        paymentResult: meltResponse.state,
        paidAmount: meltQuote.amount,
        feesPaid: meltQuote.fee_reserve,
        changeAmount:
          keep.reduce((sum, p) => sum + p.amount, 0) +
          (meltResponse.change?.reduce((sum, p) => sum + p.amount, 0) || 0),
        quoteId: meltQuote.quote,
        atomicOperationId: atomicResult.transactionId,
        reconciliationPerformed: reconciliationResult.reconciled > 0,
      };
    } catch (dbError) {
      logger.error("Atomic database operations failed", {
        npub,
        transactionId,
        error: dbError.message,
        stack: dbError.stack,
      });

      // The melt operation succeeded on the mint but database operations failed
      // This is the exact scenario we're trying to prevent
      throw new Error(
        `CRITICAL: Melt succeeded on mint but database update failed: ${dbError.message}. Manual reconciliation required.`
      );
    }
  } catch (error) {
    logger.error("Atomic melt tokens operation failed", {
      npub,
      invoice: invoice.substring(0, 50) + "...",
      error: error.message,
      errorType: error.constructor.name,
    });

    // Provide specific error codes for different failure scenarios
    if (error.message.includes("Token already spent")) {
      const enhancedError = new Error(error.message);
      enhancedError.code = "TOKEN_ALREADY_SPENT";
      enhancedError.severity = "HIGH";
      enhancedError.requiresReconciliation = true;
      throw enhancedError;
    }

    if (error.message.includes("CRITICAL: Melt succeeded")) {
      const enhancedError = new Error(error.message);
      enhancedError.code = "MINT_DB_INCONSISTENCY";
      enhancedError.severity = "CRITICAL";
      enhancedError.requiresManualIntervention = true;
      throw enhancedError;
    }

    throw new Error(`Failed to melt tokens: ${error.message}`);
  }
}

/**
 * Calculate total wallet balance using repository
 * @param {string} npub - User's Nostr npub string
 * @returns {Promise<Object>} Balance information
 */
export async function getBalance(npub) {
  try {
    logger.info("Getting wallet balance", { npub });

    // Get detailed balance from repository
    const balance = await walletRepositoryService.getDetailedBalance(
      npub,
      MINT_URL
    );

    logger.info("Retrieved wallet balance", {
      npub,
      unspentBalance: balance.unspent_balance,
      totalBalance: balance.total_balance,
    });

    return {
      ...balance,
      mintUrl: MINT_URL,
    };
  } catch (error) {
    logger.error("Failed to get balance", {
      npub,
      error: error.message,
    });
    throw new Error(`Failed to get balance: ${error.message}`);
  }
}

/**
 * Verify proof states with mint and detect discrepancies with database
 * @param {string} npub - User's Nostr npub string
 * @param {Array} [proofs] - Optional specific proofs to check, otherwise checks all unspent
 * @returns {Promise<Object>} Proof states and any discrepancies
 */
export async function checkProofStates(npub, proofs = null) {
  try {
    logger.info("Checking proof states with enhanced discrepancy detection", {
      npub,
      customProofs: !!proofs,
    });

    const { wallet } = await initializeWallet(npub);

    let proofsToCheck = proofs;
    let tokenMap = new Map(); // Map proof secrets to token info

    // If no specific proofs provided, get all unspent tokens
    if (!proofsToCheck) {
      const unspentTokens = await walletRepositoryService.findUnspentTokens(
        npub,
        MINT_URL
      );
      proofsToCheck = [];

      for (const token of unspentTokens) {
        for (const proof of token.proofs) {
          proofsToCheck.push(proof);
          tokenMap.set(proof.secret, {
            tokenId: token._id,
            status: token.status,
            transactionId: token.transaction_id,
            amount: proof.amount,
          });
        }
      }
    } else {
      // For custom proofs, we still need to check database state
      const secrets = proofs.map((p) => p.secret);
      const secretMap = await walletRepositoryService.checkProofSecrets(
        secrets
      );

      proofs.forEach((proof) => {
        if (secretMap[proof.secret]) {
          tokenMap.set(proof.secret, secretMap[proof.secret]);
        }
      });
    }

    if (proofsToCheck.length === 0) {
      return {
        states: [],
        totalProofs: 0,
        spentCount: 0,
        unspentCount: 0,
        pendingCount: 0,
        discrepancies: [],
        consistent: true,
      };
    }

    // Check proof states with mint
    const states = await wallet.checkProofsStates(proofsToCheck);

    // Analyze states and detect discrepancies
    const stateAnalysis = {
      UNSPENT: 0,
      SPENT: 0,
      PENDING: 0,
    };

    const discrepancies = [];

    states.forEach((state, index) => {
      stateAnalysis[state.state]++;

      const proof = proofsToCheck[index];
      const dbInfo = tokenMap.get(proof.secret);

      // Check for discrepancies between mint state and database state
      if (dbInfo) {
        const mintState = state.state;
        const dbState = dbInfo.status;

        // Critical discrepancy: proof is spent on mint but unspent in database
        if (mintState === "SPENT" && dbState === "unspent") {
          discrepancies.push({
            type: "CRITICAL_SPENT_MISMATCH",
            secret: proof.secret,
            amount: proof.amount,
            mintState,
            dbState,
            tokenId: dbInfo.tokenId,
            transactionId: dbInfo.transactionId,
            severity: "HIGH",
            description:
              "Proof is spent on mint but marked as unspent in database",
          });
        }

        // Warning: proof is unspent on mint but spent in database
        if (mintState === "UNSPENT" && dbState === "spent") {
          discrepancies.push({
            type: "WARNING_UNSPENT_MISMATCH",
            secret: proof.secret,
            amount: proof.amount,
            mintState,
            dbState,
            tokenId: dbInfo.tokenId,
            transactionId: dbInfo.transactionId,
            severity: "MEDIUM",
            description:
              "Proof is unspent on mint but marked as spent in database",
          });
        }

        // Pending state discrepancies
        if (mintState === "PENDING" && dbState !== "pending") {
          discrepancies.push({
            type: "PENDING_STATE_MISMATCH",
            secret: proof.secret,
            amount: proof.amount,
            mintState,
            dbState,
            tokenId: dbInfo.tokenId,
            transactionId: dbInfo.transactionId,
            severity: "MEDIUM",
            description: "Proof state mismatch involving pending state",
          });
        }
      }
    });

    const isConsistent = discrepancies.length === 0;

    logger.info("Completed enhanced proof state check", {
      npub,
      totalProofs: proofsToCheck.length,
      unspentCount: stateAnalysis.UNSPENT,
      spentCount: stateAnalysis.SPENT,
      pendingCount: stateAnalysis.PENDING,
      discrepancyCount: discrepancies.length,
      consistent: isConsistent,
      criticalIssues: discrepancies.filter((d) => d.severity === "HIGH").length,
    });

    return {
      states,
      totalProofs: proofsToCheck.length,
      spentCount: stateAnalysis.SPENT,
      unspentCount: stateAnalysis.UNSPENT,
      pendingCount: stateAnalysis.PENDING,
      discrepancies,
      consistent: isConsistent,
      mintUrl: MINT_URL,
    };
  } catch (error) {
    logger.error("Failed to check proof states", {
      npub,
      customProofs: !!proofs,
      error: error.message,
    });
    throw new Error(`Failed to check proof states: ${error.message}`);
  }
}

/**
 * Reconcile proof states between mint and database
 * Fixes database state to match mint state when inconsistencies are detected
 * @param {string} npub - User's Nostr npub string
 * @param {Object} [options] - Reconciliation options
 * @param {boolean} [options.dryRun=false] - If true, only report what would be changed
 * @param {Array} [options.specificProofs] - Only reconcile specific proofs
 * @returns {Promise<Object>} Reconciliation results
 */
export async function reconcileProofStates(npub, options = {}) {
  const { dryRun = false, specificProofs = null } = options;

  try {
    logger.info("Starting proof state reconciliation", {
      npub,
      dryRun,
      specificProofs: !!specificProofs,
    });

    // First, check current proof states to identify discrepancies
    const stateCheck = await checkProofStates(npub, specificProofs);

    if (stateCheck.consistent) {
      logger.info("No reconciliation needed - states are consistent", { npub });
      return {
        reconciled: 0,
        errors: 0,
        changes: [],
        consistent: true,
        dryRun,
      };
    }

    const changes = [];
    const errors = [];
    let reconciledCount = 0;

    // Process each discrepancy
    for (const discrepancy of stateCheck.discrepancies) {
      try {
        const change = {
          tokenId: discrepancy.tokenId,
          transactionId: discrepancy.transactionId,
          secret: discrepancy.secret,
          amount: discrepancy.amount,
          type: discrepancy.type,
          severity: discrepancy.severity,
          oldState: discrepancy.dbState,
          newState: null,
          action: null,
        };

        // Determine the correct action based on discrepancy type
        if (discrepancy.type === "CRITICAL_SPENT_MISMATCH") {
          // Proof is spent on mint but unspent in database - mark as spent
          change.newState = "spent";
          change.action = "mark_as_spent";

          if (!dryRun) {
            await walletRepositoryService.markTokensAsSpent([
              discrepancy.tokenId,
            ]);
            logger.info("Reconciled critical spent mismatch", {
              npub,
              tokenId: discrepancy.tokenId,
              secret: discrepancy.secret,
            });
          }

          reconciledCount++;
        } else if (discrepancy.type === "WARNING_UNSPENT_MISMATCH") {
          // Proof is unspent on mint but spent in database - mark as unspent
          change.newState = "unspent";
          change.action = "mark_as_unspent";

          if (!dryRun) {
            // Update token status back to unspent
            await walletRepositoryService.updateTokenStatus(
              discrepancy.tokenId,
              "unspent"
            );
            logger.info("Reconciled unspent mismatch", {
              npub,
              tokenId: discrepancy.tokenId,
              secret: discrepancy.secret,
            });
          }

          reconciledCount++;
        } else if (discrepancy.type === "PENDING_STATE_MISMATCH") {
          // Handle pending state mismatches case by case
          if (
            discrepancy.mintState === "PENDING" &&
            discrepancy.dbState === "unspent"
          ) {
            change.newState = "pending";
            change.action = "mark_as_pending";

            if (!dryRun) {
              await walletRepositoryService.updateTokenStatus(
                discrepancy.tokenId,
                "pending"
              );
            }

            reconciledCount++;
          }
        }

        changes.push(change);
      } catch (error) {
        logger.error("Failed to reconcile individual discrepancy", {
          npub,
          discrepancy,
          error: error.message,
        });

        errors.push({
          discrepancy,
          error: error.message,
        });
      }
    }

    const result = {
      reconciled: reconciledCount,
      errors: errors.length,
      changes,
      errorDetails: errors,
      consistent:
        reconciledCount === stateCheck.discrepancies.length &&
        errors.length === 0,
      dryRun,
    };

    logger.info("Completed proof state reconciliation", {
      npub,
      dryRun,
      totalDiscrepancies: stateCheck.discrepancies.length,
      reconciled: reconciledCount,
      errors: errors.length,
      nowConsistent: result.consistent,
    });

    return result;
  } catch (error) {
    logger.error("Failed to reconcile proof states", {
      npub,
      dryRun,
      error: error.message,
    });
    throw new Error(`Failed to reconcile proof states: ${error.message}`);
  }
}

// ==================== BACKGROUND POLLING ====================

// Store active polling intervals for cleanup
const activePollingIntervals = new Map();

/**
 * Start background polling to check if mint quote is paid and complete minting
 * Enhanced version with improved error handling, retry logic, and cleanup
 * @param {string} npub - User's Nostr npub string
 * @param {string} quoteId - Mint quote ID to monitor
 * @param {number} amount - Amount to mint
 * @param {string} transactionId - Transaction ID
 */
function startMintPolling(npub, quoteId, amount, transactionId) {
  const POLLING_INTERVAL = 10000; // 10 seconds
  const POLLING_DURATION = 180000; // 3 minutes
  const MAX_RETRY_ATTEMPTS = 3;
  const startTime = Date.now();

  // Create unique polling key
  const pollingKey = `${npub}_${quoteId}_${transactionId}`;

  // Check if polling is already active for this transaction
  if (activePollingIntervals.has(pollingKey)) {
    logger.warn("Polling already active for transaction", {
      npub,
      quoteId,
      transactionId,
      pollingKey,
    });
    return pollingKey;
  }

  logger.info("Starting enhanced mint polling", {
    npub,
    quoteId,
    amount,
    transactionId,
    pollingKey,
    pollingInterval: `${POLLING_INTERVAL / 1000}s`,
    pollingDuration: `${POLLING_DURATION / 1000}s`,
    maxRetries: MAX_RETRY_ATTEMPTS,
  });

  let consecutiveErrors = 0;
  let pollAttempts = 0;

  const pollInterval = setInterval(async () => {
    try {
      const elapsed = Date.now() - startTime;
      pollAttempts++;

      // Stop polling after timeout
      if (elapsed >= POLLING_DURATION) {
        await cleanupPolling(pollingKey, pollInterval, {
          npub,
          quoteId,
          transactionId,
          reason: "timeout",
          elapsed: `${elapsed / 1000}s`,
          totalAttempts: pollAttempts,
        });

        // Mark transaction as failed due to timeout
        await markTransactionAsFailed(
          transactionId,
          `Polling timeout after ${elapsed / 1000}s`
        );
        return;
      }

      logger.info("Checking mint quote status with retry logic", {
        npub,
        quoteId,
        elapsed: `${elapsed / 1000}s`,
        attempt: pollAttempts,
        consecutiveErrors,
      });

      // Check quote status with retry logic
      const quoteStatus = await checkQuoteStatusWithRetry(
        npub,
        quoteId,
        MAX_RETRY_ATTEMPTS
      );

      // Reset error counter on successful check
      consecutiveErrors = 0;

      if (quoteStatus.state === "PAID") {
        logger.info("Invoice paid! Completing minting automatically", {
          npub,
          quoteId,
          elapsed: `${elapsed / 1000}s`,
          status: "paid",
          totalAttempts: pollAttempts,
        });

        // Complete the minting process with enhanced error handling
        try {
          const completionResult = await completeMinting(
            npub,
            quoteId,
            amount,
            transactionId
          );

          logger.info("Background minting completed successfully", {
            npub,
            quoteId,
            transactionId: completionResult.transactionId,
            totalAmount: completionResult.totalAmount,
            tokenId: completionResult.tokenId,
            totalAttempts: pollAttempts,
          });

          // Clean up polling on success
          await cleanupPolling(pollingKey, pollInterval, {
            npub,
            quoteId,
            transactionId,
            reason: "completed",
            elapsed: `${elapsed / 1000}s`,
            totalAttempts: pollAttempts,
          });
        } catch (completionError) {
          logger.error("Failed to complete background minting", {
            npub,
            quoteId,
            transactionId,
            error: completionError.message,
            stack: completionError.stack,
            totalAttempts: pollAttempts,
          });

          // Mark transaction as failed and cleanup
          await markTransactionAsFailed(transactionId, completionError.message);
          await cleanupPolling(pollingKey, pollInterval, {
            npub,
            quoteId,
            transactionId,
            reason: "completion_failed",
            error: completionError.message,
          });
        }
      } else {
        logger.info("Invoice not yet paid, continuing to poll", {
          npub,
          quoteId,
          status: quoteStatus.state,
          elapsed: `${elapsed / 1000}s`,
          attempt: pollAttempts,
          nextCheckIn: `${POLLING_INTERVAL / 1000}s`,
        });
      }
    } catch (error) {
      consecutiveErrors++;

      logger.error("Error during mint polling", {
        npub,
        quoteId,
        transactionId,
        error: error.message,
        consecutiveErrors,
        maxRetries: MAX_RETRY_ATTEMPTS,
        attempt: pollAttempts,
      });

      // Stop polling if too many consecutive errors
      if (consecutiveErrors >= MAX_RETRY_ATTEMPTS) {
        logger.error("Too many consecutive polling errors, stopping", {
          npub,
          quoteId,
          transactionId,
          consecutiveErrors,
          totalAttempts: pollAttempts,
        });

        await markTransactionAsFailed(
          transactionId,
          `Polling failed after ${consecutiveErrors} consecutive errors: ${error.message}`
        );
        await cleanupPolling(pollingKey, pollInterval, {
          npub,
          quoteId,
          transactionId,
          reason: "too_many_errors",
          consecutiveErrors,
          lastError: error.message,
        });
      }
    }
  }, POLLING_INTERVAL);

  // Store the interval for cleanup
  activePollingIntervals.set(pollingKey, {
    interval: pollInterval,
    startTime,
    npub,
    quoteId,
    transactionId,
  });

  return pollingKey;
}

/**
 * Check quote status with retry logic and database timeout handling
 * @param {string} npub - User's npub for wallet initialization
 * @param {string} quoteId - Quote ID to check
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<Object>} Quote status
 */
async function checkQuoteStatusWithRetry(npub, quoteId, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug("Checking quote status with per-request initialization", {
        npub,
        quoteId,
        attempt,
        maxRetries,
      });

      // Initialize wallet with fresh mint instance (no connectivity test for polling)
      const { wallet } = await initializeWallet(npub, false);
      const status = await wallet.checkMintQuote(quoteId);

      logger.debug("Quote status check successful", {
        quoteId,
        status: status.state,
        attempt,
      });

      return status;
    } catch (error) {
      lastError = error;

      logger.warn("Quote status check failed", {
        quoteId,
        attempt,
        maxRetries,
        error: {
          name: error.name,
          message: error.message,
          code: error.code,
        },
        willRetry: attempt < maxRetries,
      });

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // Enhanced error for final failure
  const enhancedError = new Error(
    `Failed to check quote status after ${maxRetries} attempts: ${lastError.message}`
  );
  enhancedError.originalError = lastError;
  enhancedError.attempts = maxRetries;
  enhancedError.quoteId = quoteId;

  throw enhancedError;
}

/**
 * Clean up polling interval and log completion
 * @param {string} pollingKey - Unique polling identifier
 * @param {NodeJS.Timeout} pollInterval - Interval to clear
 * @param {Object} context - Logging context
 */
async function cleanupPolling(pollingKey, pollInterval, context) {
  try {
    // Clear the interval
    clearInterval(pollInterval);

    // Remove from active polling map
    activePollingIntervals.delete(pollingKey);

    logger.info("Polling cleanup completed", {
      pollingKey,
      ...context,
      activePollingCount: activePollingIntervals.size,
    });
  } catch (error) {
    logger.error("Error during polling cleanup", {
      pollingKey,
      error: error.message,
      context,
    });
  }
}

/**
 * Mark a transaction as failed
 * @param {string} transactionId - Transaction ID
 * @param {string} reason - Failure reason
 */
async function markTransactionAsFailed(transactionId, reason) {
  try {
    const existingTokens =
      await walletRepositoryService.findTokensByTransactionId(transactionId);
    const pendingToken = existingTokens.find((t) => t.status === "pending");

    if (pendingToken) {
      await walletRepositoryService.updatePendingTransaction(pendingToken._id, {
        status: "failed",
        metadata: {
          ...pendingToken.metadata,
          failed_at: new Date(),
          failure_reason: reason,
        },
      });

      logger.info("Marked transaction as failed", {
        transactionId,
        tokenId: pendingToken._id,
        reason,
      });
    }
  } catch (error) {
    logger.error("Failed to mark transaction as failed", {
      transactionId,
      reason,
      error: error.message,
    });
  }
}

/**
 * Get status of all active polling operations
 * @returns {Array} Array of active polling operations
 */
export function getActivePollingStatus() {
  const now = Date.now();
  return Array.from(activePollingIntervals.entries()).map(([key, data]) => ({
    pollingKey: key,
    npub: data.npub,
    quoteId: data.quoteId,
    transactionId: data.transactionId,
    elapsedTime: now - data.startTime,
    startTime: new Date(data.startTime).toISOString(),
  }));
}

/**
 * Force cleanup of a specific polling operation
 * @param {string} pollingKey - Polling key to cleanup
 * @returns {boolean} True if cleanup was performed
 */
export function forceCleanupPolling(pollingKey) {
  const pollingData = activePollingIntervals.get(pollingKey);
  if (pollingData) {
    clearInterval(pollingData.interval);
    activePollingIntervals.delete(pollingKey);

    logger.info("Force cleanup of polling operation", {
      pollingKey,
      npub: pollingData.npub,
      quoteId: pollingData.quoteId,
      transactionId: pollingData.transactionId,
    });

    return true;
  }
  return false;
}

/**
 * Cleanup all active polling operations (for shutdown)
 */
export function cleanupAllPolling() {
  const activeCount = activePollingIntervals.size;

  for (const [key, data] of activePollingIntervals.entries()) {
    clearInterval(data.interval);
  }

  activePollingIntervals.clear();

  logger.info("Cleaned up all active polling operations", {
    cleanedCount: activeCount,
  });
}

/**
 * Test mint connectivity - exported for external use
 * @returns {Promise<Object>} Comprehensive connectivity test results
 */
export async function testMintConnectivityExternal(mintUrl = MINT_URL) {
  return await testMintConnectivity(mintUrl);
}
