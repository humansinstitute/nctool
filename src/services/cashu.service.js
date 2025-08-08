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
  const operationStart = Date.now();
  
  try {
    logger.info(
      "Starting enhanced melt tokens operation with pre-flight reconciliation and atomic transactions",
      {
        npub,
        invoice: invoice.substring(0, 50) + "...",
        timestamp: new Date().toISOString(),
      }
    );

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

    logger.info("All proofs collected, starting pre-flight reconciliation", {
      npub,
      allProofsCount: allProofs.length,
      totalAmount: allProofs.reduce((sum, p) => sum + (p.amount || 0), 0),
    });

    // CRITICAL: Pre-flight reconciliation to ensure proof state consistency
    try {
      const reconciliationResult = await performPreFlightReconciliation(npub, allProofs);
      
      if (!reconciliationResult.operationCleared) {
        const error = new Error(
          `Melt operation blocked due to critical proof state discrepancies. ` +
          `Database state inconsistent with mint ground truth. ` +
          `Please contact support for manual reconciliation.`
        );
        error.code = 'MELT_BLOCKED_BY_RECONCILIATION';
        error.reconciliationResult = reconciliationResult;
        throw error;
      }
      
      logger.info('Pre-flight reconciliation completed successfully', {
        npub,
        discrepanciesFound: reconciliationResult.discrepanciesFound,
        discrepanciesResolved: reconciliationResult.discrepanciesResolved || false,
        operationCleared: reconciliationResult.operationCleared,
      });
      
    } catch (reconciliationError) {
      if (reconciliationError.code === 'HIGH_SEVERITY_DISCREPANCIES' ||
          reconciliationError.code === 'MELT_BLOCKED_BY_RECONCILIATION') {
        logger.error('CRITICAL: Melt operation blocked by pre-flight reconciliation', {
          npub,
          error: reconciliationError.message,
          discrepancies: reconciliationError.discrepancies || [],
          reconciliationResult: reconciliationError.reconciliationResult,
        });
        
        // Re-throw with enhanced context for user
        const userError = new Error(
          `Cannot proceed with Lightning payment. Critical proof state inconsistencies detected. ` +
          `This protects your funds from potential loss. Please try again in a few minutes or contact support.`
        );
        userError.code = 'PROOF_STATE_INCONSISTENCY';
        userError.severity = 'CRITICAL';
        userError.originalError = reconciliationError;
        throw userError;
      }
      
      // Re-throw other reconciliation errors
      logger.error('Pre-flight reconciliation failed with unexpected error', {
        npub,
        error: reconciliationError.message,
        stack: reconciliationError.stack?.split('\n').slice(0, 5),
      });
      throw new Error(`Pre-flight validation failed: ${reconciliationError.message}`);
    }

    // Split proofs for payment with includeFees
    let send, keep;
    try {
      logger.info("Creating send transaction for melt with fee inclusion", {
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
        sendAmount: send.reduce((sum, p) => sum + p.amount, 0),
        keepAmount: keep.reduce((sum, p) => sum + p.amount, 0),
      });
    } catch (sendError) {
      logger.error("CRITICAL: Send transaction failed after successful reconciliation", {
        npub,
        error: sendError.message,
        errorName: sendError.name,
        errorCode: sendError.code,
        stack: sendError.stack?.split("\n").slice(0, 5),
        severity: 'CRITICAL',
      });
      throw new Error(
        `Failed to prepare payment transaction: ${sendError.message}`
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
      logger.error("CRITICAL: Melt operation failed - mint may have consumed proofs", {
        npub,
        quoteId: meltQuote.quote,
        error: meltError.message,
        errorName: meltError.name,
        severity: 'CRITICAL',
        context: 'MINT_SUCCESS_DB_FAILURE_RISK',
      });
      
      // This is a critical scenario - the mint operation may have succeeded
      // but we can't update our database. Mark this for manual investigation.
      const criticalError = new Error(
        `Lightning payment may have succeeded but local state update failed. ` +
        `Please check your Lightning wallet and contact support immediately. ` +
        `Quote ID: ${meltQuote.quote}`
      );
      criticalError.code = 'CRITICAL_MELT_FAILURE';
      criticalError.severity = 'CRITICAL';
      criticalError.quoteId = meltQuote.quote;
      criticalError.originalError = meltError;
      throw criticalError;
    }

    // Generate transaction ID for atomic operation
    const transactionId = walletRepositoryService.generateTransactionId("melt");

    // CRITICAL: Execute atomic melt transaction - replaces all sequential operations
    try {
      logger.info("Executing atomic melt transaction", {
        npub,
        transactionId,
        sourceTokensCount: tokenIds.length,
        keepProofsCount: keep.length,
        meltChangeProofsCount: meltResponse.change?.length || 0,
      });

      const atomicResult = await walletRepositoryService.executeAtomicMelt(
        tokenIds,
        keep,
        meltResponse.change || [],
        transactionId,
        {
          npub,
          wallet_id: walletDoc._id,
          mint_url: MINT_URL,
          parent_transaction_id: transactionId,
          quote_id: meltQuote.quote,
          invoice_amount: meltQuote.amount,
          fee_reserve: meltQuote.fee_reserve,
          total_amount: totalNeeded,
          payment_result: meltResponse.state,
        }
      );

      logger.info("Atomic melt transaction completed successfully", {
        npub,
        transactionId,
        sourceTokensSpent: atomicResult.source_tokens_spent,
        keepTokenId: atomicResult.keep_token_id,
        keepAmount: atomicResult.keep_amount,
        meltChangeTokenId: atomicResult.melt_change_token_id,
        meltChangeAmount: atomicResult.melt_change_amount,
        operationsPerformed: atomicResult.operations.length,
      });

      const operationDuration = Date.now() - operationStart;
      logger.info("Enhanced melt tokens operation completed successfully", {
        npub,
        transactionId,
        quoteId: meltQuote.quote,
        paymentResult: meltResponse.state,
        operationDuration: `${operationDuration}ms`,
        totalChangeAmount: atomicResult.keep_amount + atomicResult.melt_change_amount,
      });

      return {
        transactionId,
        paymentResult: meltResponse.state,
        paidAmount: meltQuote.amount,
        feesPaid: meltQuote.fee_reserve,
        changeAmount: atomicResult.keep_amount + atomicResult.melt_change_amount,
        quoteId: meltQuote.quote,
        atomicResult,
        operationDuration,
      };

    } catch (atomicError) {
      // CRITICAL: Mint succeeded but database update failed
      logger.error("CRITICAL: Atomic melt transaction failed after successful mint operation", {
        npub,
        transactionId,
        quoteId: meltQuote.quote,
        paymentResult: meltResponse.state,
        error: atomicError.message,
        severity: 'CRITICAL',
        context: 'MINT_SUCCESS_DB_FAILURE',
        requiresManualIntervention: true,
      });

      // This is the most critical error scenario - payment succeeded but we can't update state
      const criticalError = new Error(
        `CRITICAL: Lightning payment succeeded but database update failed. ` +
        `Your payment was processed but local wallet state is inconsistent. ` +
        `Please contact support immediately with Quote ID: ${meltQuote.quote} ` +
        `and Transaction ID: ${transactionId}`
      );
      criticalError.code = 'CRITICAL_DB_FAILURE_AFTER_MINT_SUCCESS';
      criticalError.severity = 'CRITICAL';
      criticalError.quoteId = meltQuote.quote;
      criticalError.transactionId = transactionId;
      criticalError.paymentResult = meltResponse.state;
      criticalError.requiresManualIntervention = true;
      criticalError.originalError = atomicError;
      throw criticalError;
    }

  } catch (error) {
    const operationDuration = Date.now() - operationStart;
    
    // Enhanced error logging with severity classification
    const errorContext = {
      npub,
      invoice: invoice.substring(0, 50) + "...",
      operationDuration: `${operationDuration}ms`,
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        severity: error.severity || 'HIGH',
        stack: error.stack?.split("\n").slice(0, 5),
      },
      timestamp: new Date().toISOString(),
    };

    // Log with appropriate severity
    if (error.severity === 'CRITICAL') {
      logger.error("CRITICAL: Enhanced melt tokens operation failed with critical error", errorContext);
    } else {
      logger.error("Enhanced melt tokens operation failed", errorContext);
    }

    // Preserve error context for upstream handling
    if (error.code && ['PROOF_STATE_INCONSISTENCY', 'CRITICAL_MELT_FAILURE', 'CRITICAL_DB_FAILURE_AFTER_MINT_SUCCESS'].includes(error.code)) {
      throw error; // Re-throw critical errors with full context
    }

    // Wrap other errors with enhanced context
    const enhancedError = new Error(`Failed to melt tokens: ${error.message}`);
    enhancedError.originalError = error;
    enhancedError.operationDuration = operationDuration;
    throw enhancedError;
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
 * Enhanced with severity-based discrepancy detection for pre-flight reconciliation
 * @param {string} npub - User's Nostr npub string
 * @param {Array} [proofs] - Optional specific proofs to check, otherwise checks all unspent
 * @returns {Promise<Object>} Proof states and discrepancies with severity levels
 */
export async function checkProofStates(npub, proofs = null) {
  try {
    logger.info("Checking proof states with enhanced discrepancy detection", {
      npub,
      customProofs: !!proofs,
    });

    const { wallet } = await initializeWallet(npub);

    let proofsToCheck = proofs;
    let dbTokenMap = new Map(); // Map proof secrets to database token info

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
          // Map proof secret to database token info
          dbTokenMap.set(proof.secret, {
            token_id: token._id,
            status: token.status,
            spent_at: token.spent_at,
            created_at: token.created_at,
            transaction_type: token.transaction_type,
          });
        }
      }
    } else {
      // For custom proofs, we need to check their database status
      const secrets = proofsToCheck.map(p => p.secret);
      const secretMap = await walletRepositoryService.checkProofSecrets(secrets);
      
      for (const proof of proofsToCheck) {
        if (secretMap[proof.secret]) {
          dbTokenMap.set(proof.secret, secretMap[proof.secret]);
        } else {
          // Proof not found in database - this is a discrepancy
          dbTokenMap.set(proof.secret, {
            token_id: null,
            status: 'unknown',
            spent_at: null,
            created_at: null,
            transaction_type: null,
          });
        }
      }
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
        severityCounts: { HIGH: 0, MEDIUM: 0, LOW: 0 },
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
    const severityCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 };

    states.forEach((state, index) => {
      const proof = proofsToCheck[index];
      const dbInfo = dbTokenMap.get(proof.secret);
      const mintState = state.state;
      const dbStatus = dbInfo?.status || 'unknown';

      stateAnalysis[mintState]++;

      // Detect discrepancies with severity levels
      let discrepancy = null;

      if (dbStatus === 'unspent' && mintState === 'SPENT') {
        // HIGH severity: DB says unspent, mint says SPENT (critical - blocks operations)
        discrepancy = {
          severity: 'HIGH',
          type: 'DB_UNSPENT_MINT_SPENT',
          description: 'Database shows proof as unspent but mint shows as spent',
          proof_secret: proof.secret,
          proof_amount: proof.amount,
          db_status: dbStatus,
          mint_state: mintState,
          token_id: dbInfo?.token_id,
          action_required: 'BLOCK_OPERATION',
          recommendation: 'Update database to mark proof as spent immediately',
        };
        severityCounts.HIGH++;
      } else if (dbStatus === 'spent' && mintState === 'UNSPENT') {
        // MEDIUM severity: DB says spent, mint says UNSPENT (requires investigation)
        discrepancy = {
          severity: 'MEDIUM',
          type: 'DB_SPENT_MINT_UNSPENT',
          description: 'Database shows proof as spent but mint shows as unspent',
          proof_secret: proof.secret,
          proof_amount: proof.amount,
          db_status: dbStatus,
          mint_state: mintState,
          token_id: dbInfo?.token_id,
          spent_at: dbInfo?.spent_at,
          action_required: 'INVESTIGATE',
          recommendation: 'Investigate transaction history and potentially restore proof to unspent',
        };
        severityCounts.MEDIUM++;
      } else if (dbStatus === 'pending' && mintState === 'SPENT') {
        // MEDIUM severity: DB says pending, mint says SPENT
        discrepancy = {
          severity: 'MEDIUM',
          type: 'DB_PENDING_MINT_SPENT',
          description: 'Database shows proof as pending but mint shows as spent',
          proof_secret: proof.secret,
          proof_amount: proof.amount,
          db_status: dbStatus,
          mint_state: mintState,
          token_id: dbInfo?.token_id,
          action_required: 'UPDATE_STATUS',
          recommendation: 'Update database status from pending to spent',
        };
        severityCounts.MEDIUM++;
      } else if (dbStatus === 'unknown') {
        // LOW severity: Proof not found in database
        discrepancy = {
          severity: 'LOW',
          type: 'PROOF_NOT_IN_DB',
          description: 'Proof exists but not found in database',
          proof_secret: proof.secret,
          proof_amount: proof.amount,
          db_status: dbStatus,
          mint_state: mintState,
          token_id: null,
          action_required: 'LOG_ONLY',
          recommendation: 'Log for audit purposes - may be external proof',
        };
        severityCounts.LOW++;
      } else if (dbStatus === 'unspent' && mintState === 'PENDING') {
        // LOW severity: Minor state mismatch
        discrepancy = {
          severity: 'LOW',
          type: 'DB_UNSPENT_MINT_PENDING',
          description: 'Database shows proof as unspent but mint shows as pending',
          proof_secret: proof.secret,
          proof_amount: proof.amount,
          db_status: dbStatus,
          mint_state: mintState,
          token_id: dbInfo?.token_id,
          action_required: 'MONITOR',
          recommendation: 'Monitor for state resolution - may be temporary',
        };
        severityCounts.LOW++;
      }

      if (discrepancy) {
        discrepancies.push(discrepancy);
      }
    });

    const isConsistent = discrepancies.length === 0;
    const hasHighSeverity = severityCounts.HIGH > 0;

    logger.info("Completed enhanced proof state check with discrepancy analysis", {
      npub,
      totalProofs: proofsToCheck.length,
      unspentCount: stateAnalysis.UNSPENT,
      spentCount: stateAnalysis.SPENT,
      pendingCount: stateAnalysis.PENDING,
      discrepancyCount: discrepancies.length,
      severityCounts,
      consistent: isConsistent,
      hasHighSeverity,
    });

    return {
      states,
      totalProofs: proofsToCheck.length,
      spentCount: stateAnalysis.SPENT,
      unspentCount: stateAnalysis.UNSPENT,
      pendingCount: stateAnalysis.PENDING,
      discrepancies,
      severityCounts,
      consistent: isConsistent,
      hasHighSeverity,
      mintUrl: MINT_URL,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error("Failed to check proof states", {
      npub,
      customProofs: !!proofs,
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 5),
    });
    throw new Error(`Failed to check proof states: ${error.message}`);
  }
}

/**
 * Reconcile proof state discrepancies by automatically correcting database inconsistencies
 * Blocks operations when HIGH severity discrepancies are detected
 * @param {string} npub - User's Nostr npub string
 * @param {Array} discrepancies - Array of discrepancy objects from checkProofStates
 * @returns {Promise<Object>} Reconciliation results with actions taken
 */
export async function reconcileProofStates(npub, discrepancies) {
  try {
    logger.info("Starting proof state reconciliation", {
      npub,
      discrepancyCount: discrepancies.length,
      severityBreakdown: discrepancies.reduce((acc, d) => {
        acc[d.severity] = (acc[d.severity] || 0) + 1;
        return acc;
      }, {}),
    });

    if (!discrepancies || discrepancies.length === 0) {
      return {
        success: true,
        actionsPerformed: [],
        highSeverityBlocked: false,
        reconciliationSummary: {
          totalDiscrepancies: 0,
          resolved: 0,
          blocked: 0,
          failed: 0,
        },
        timestamp: new Date().toISOString(),
      };
    }

    // Check for HIGH severity discrepancies that should block operations
    const highSeverityDiscrepancies = discrepancies.filter(d => d.severity === 'HIGH');
    
    if (highSeverityDiscrepancies.length > 0) {
      logger.error("HIGH severity discrepancies detected - blocking operation", {
        npub,
        highSeverityCount: highSeverityDiscrepancies.length,
        discrepancies: highSeverityDiscrepancies.map(d => ({
          type: d.type,
          proof_secret: d.proof_secret.substring(0, 10) + '...',
          proof_amount: d.proof_amount,
        })),
      });

      // For HIGH severity, we still attempt to fix them but block the operation
      const highSeverityActions = [];
      
      for (const discrepancy of highSeverityDiscrepancies) {
        try {
          if (discrepancy.type === 'DB_UNSPENT_MINT_SPENT' && discrepancy.token_id) {
            // Update database to mark token as spent
            const updateResult = await walletRepositoryService.markTokensAsSpent([discrepancy.token_id]);
            
            highSeverityActions.push({
              discrepancy_type: discrepancy.type,
              action: 'MARKED_TOKEN_AS_SPENT',
              token_id: discrepancy.token_id,
              proof_amount: discrepancy.proof_amount,
              success: updateResult > 0,
              timestamp: new Date().toISOString(),
            });

            logger.info("Corrected HIGH severity discrepancy", {
              npub,
              type: discrepancy.type,
              token_id: discrepancy.token_id,
              action: 'MARKED_TOKEN_AS_SPENT',
            });
          }
        } catch (error) {
          logger.error("Failed to correct HIGH severity discrepancy", {
            npub,
            discrepancy_type: discrepancy.type,
            token_id: discrepancy.token_id,
            error: error.message,
          });

          highSeverityActions.push({
            discrepancy_type: discrepancy.type,
            action: 'CORRECTION_FAILED',
            token_id: discrepancy.token_id,
            error: error.message,
            success: false,
            timestamp: new Date().toISOString(),
          });
        }
      }

      return {
        success: false,
        blocked: true,
        reason: 'HIGH_SEVERITY_DISCREPANCIES_DETECTED',
        highSeverityBlocked: true,
        actionsPerformed: highSeverityActions,
        reconciliationSummary: {
          totalDiscrepancies: discrepancies.length,
          resolved: highSeverityActions.filter(a => a.success).length,
          blocked: highSeverityDiscrepancies.length,
          failed: highSeverityActions.filter(a => !a.success).length,
        },
        timestamp: new Date().toISOString(),
      };
    }

    // Process MEDIUM and LOW severity discrepancies
    const actionsPerformed = [];
    let resolvedCount = 0;
    let failedCount = 0;

    for (const discrepancy of discrepancies) {
      try {
        let action = null;

        switch (discrepancy.type) {
          case 'DB_SPENT_MINT_UNSPENT':
            // MEDIUM: Investigate and potentially restore proof to unspent
            // For now, we log this for manual investigation
            action = {
              discrepancy_type: discrepancy.type,
              action: 'LOGGED_FOR_INVESTIGATION',
              token_id: discrepancy.token_id,
              proof_amount: discrepancy.proof_amount,
              recommendation: discrepancy.recommendation,
              success: true,
              timestamp: new Date().toISOString(),
            };
            
            logger.warn("MEDIUM severity discrepancy logged for investigation", {
              npub,
              type: discrepancy.type,
              token_id: discrepancy.token_id,
              spent_at: discrepancy.spent_at,
            });
            break;

          case 'DB_PENDING_MINT_SPENT':
            // MEDIUM: Update database status from pending to spent
            if (discrepancy.token_id) {
              const updateResult = await walletRepositoryService.markTokensAsSpent([discrepancy.token_id]);
              
              action = {
                discrepancy_type: discrepancy.type,
                action: 'UPDATED_PENDING_TO_SPENT',
                token_id: discrepancy.token_id,
                proof_amount: discrepancy.proof_amount,
                success: updateResult > 0,
                timestamp: new Date().toISOString(),
              };

              if (updateResult > 0) {
                resolvedCount++;
                logger.info("Resolved MEDIUM severity discrepancy", {
                  npub,
                  type: discrepancy.type,
                  token_id: discrepancy.token_id,
                  action: 'UPDATED_PENDING_TO_SPENT',
                });
              }
            }
            break;

          case 'PROOF_NOT_IN_DB':
            // LOW: Log for audit purposes
            action = {
              discrepancy_type: discrepancy.type,
              action: 'LOGGED_EXTERNAL_PROOF',
              proof_secret: discrepancy.proof_secret.substring(0, 10) + '...',
              proof_amount: discrepancy.proof_amount,
              mint_state: discrepancy.mint_state,
              success: true,
              timestamp: new Date().toISOString(),
            };

            logger.info("LOW severity discrepancy logged", {
              npub,
              type: discrepancy.type,
              proof_amount: discrepancy.proof_amount,
              mint_state: discrepancy.mint_state,
            });
            break;

          case 'DB_UNSPENT_MINT_PENDING':
            // LOW: Monitor for state resolution
            action = {
              discrepancy_type: discrepancy.type,
              action: 'MONITORING_STATE_RESOLUTION',
              token_id: discrepancy.token_id,
              proof_amount: discrepancy.proof_amount,
              success: true,
              timestamp: new Date().toISOString(),
            };

            logger.info("LOW severity discrepancy set for monitoring", {
              npub,
              type: discrepancy.type,
              token_id: discrepancy.token_id,
            });
            break;

          default:
            action = {
              discrepancy_type: discrepancy.type,
              action: 'UNKNOWN_TYPE_LOGGED',
              success: true,
              timestamp: new Date().toISOString(),
            };
        }

        if (action) {
          actionsPerformed.push(action);
          if (!action.success) {
            failedCount++;
          }
        }

      } catch (error) {
        failedCount++;
        logger.error("Failed to process discrepancy during reconciliation", {
          npub,
          discrepancy_type: discrepancy.type,
          error: error.message,
        });

        actionsPerformed.push({
          discrepancy_type: discrepancy.type,
          action: 'PROCESSING_FAILED',
          error: error.message,
          success: false,
          timestamp: new Date().toISOString(),
        });
      }
    }

    const reconciliationSummary = {
      totalDiscrepancies: discrepancies.length,
      resolved: resolvedCount,
      blocked: 0,
      failed: failedCount,
      logged: actionsPerformed.filter(a =>
        a.action.includes('LOGGED') || a.action.includes('MONITORING')
      ).length,
    };

    logger.info("Proof state reconciliation completed", {
      npub,
      summary: reconciliationSummary,
      actionsCount: actionsPerformed.length,
    });

    return {
      success: true,
      blocked: false,
      highSeverityBlocked: false,
      actionsPerformed,
      reconciliationSummary,
      timestamp: new Date().toISOString(),
    };

  } catch (error) {
    logger.error("Proof state reconciliation failed", {
      npub,
      discrepancyCount: discrepancies?.length || 0,
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 5),
    });

    throw new Error(`Failed to reconcile proof states: ${error.message}`);
  }
}

/**
 * Perform pre-flight proof state reconciliation for melt operations
 * This function should be called before any melt operation to ensure proof state consistency
 * @param {string} npub - User's Nostr npub string
 * @param {Array} proofs - Array of proofs that will be used in the melt operation
 * @returns {Promise<Object>} Reconciliation result with operation clearance status
 * @throws {Error} If HIGH severity discrepancies block the operation
 */
export async function performPreFlightReconciliation(npub, proofs) {
  try {
    logger.info("Starting pre-flight proof state reconciliation for melt operation", {
      npub,
      proofsCount: proofs?.length || 0,
    });

    // Step 1: Check proof states against mint
    const stateCheck = await checkProofStates(npub, proofs);

    // Step 2: If no discrepancies, operation can proceed
    if (stateCheck.consistent) {
      logger.info("Pre-flight reconciliation passed - no discrepancies detected", {
        npub,
        proofsCount: stateCheck.totalProofs,
        unspentCount: stateCheck.unspentCount,
      });

      return {
        success: true,
        operationCleared: true,
        discrepanciesFound: false,
        stateCheck,
        reconciliationResult: null,
        timestamp: new Date().toISOString(),
      };
    }

    // Step 3: Discrepancies found - attempt reconciliation
    logger.warn("Discrepancies detected during pre-flight check - attempting reconciliation", {
      npub,
      discrepancyCount: stateCheck.discrepancies.length,
      severityCounts: stateCheck.severityCounts,
      hasHighSeverity: stateCheck.hasHighSeverity,
    });

    const reconciliationResult = await reconcileProofStates(npub, stateCheck.discrepancies);

    // Step 4: Determine if operation can proceed
    if (reconciliationResult.blocked || reconciliationResult.highSeverityBlocked) {
      logger.error("Pre-flight reconciliation BLOCKED operation due to HIGH severity discrepancies", {
        npub,
        blockedReason: reconciliationResult.reason,
        highSeverityCount: stateCheck.severityCounts.HIGH,
      });

      // Throw error to block the melt operation
      const error = new Error(
        `Melt operation blocked due to HIGH severity proof state discrepancies. ` +
        `${stateCheck.severityCounts.HIGH} critical discrepancies detected. ` +
        `Database state inconsistent with mint ground truth.`
      );
      error.code = 'HIGH_SEVERITY_DISCREPANCIES';
      error.discrepancies = stateCheck.discrepancies.filter(d => d.severity === 'HIGH');
      error.reconciliationResult = reconciliationResult;
      throw error;
    }

    // Step 5: Operation can proceed after reconciliation
    logger.info("Pre-flight reconciliation completed - operation cleared to proceed", {
      npub,
      discrepanciesResolved: reconciliationResult.reconciliationSummary.resolved,
      totalActions: reconciliationResult.actionsPerformed.length,
    });

    return {
      success: true,
      operationCleared: true,
      discrepanciesFound: true,
      discrepanciesResolved: true,
      stateCheck,
      reconciliationResult,
      timestamp: new Date().toISOString(),
    };

  } catch (error) {
    // If this is our HIGH severity error, re-throw it
    if (error.code === 'HIGH_SEVERITY_DISCREPANCIES') {
      throw error;
    }

    // For other errors, log and re-throw with context
    logger.error("Pre-flight reconciliation failed with unexpected error", {
      npub,
      proofsCount: proofs?.length || 0,
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 5),
    });

    throw new Error(`Pre-flight reconciliation failed: ${error.message}`);
  }
}

/**
 * Validate proof states before critical operations
 * Lightweight version for quick validation without full reconciliation
 * @param {string} npub - User's Nostr npub string
 * @param {Array} proofs - Array of proofs to validate
 * @returns {Promise<Object>} Validation result
 */
export async function validateProofStatesForOperation(npub, proofs) {
  try {
    logger.debug("Validating proof states for operation", {
      npub,
      proofsCount: proofs?.length || 0,
    });

    const stateCheck = await checkProofStates(npub, proofs);

    // Quick check for HIGH severity issues
    const hasHighSeverity = stateCheck.severityCounts?.HIGH > 0;
    const hasCriticalIssues = stateCheck.discrepancies?.some(d =>
      d.severity === 'HIGH' && d.type === 'DB_UNSPENT_MINT_SPENT'
    );

    return {
      valid: !hasHighSeverity && !hasCriticalIssues,
      hasHighSeverity,
      hasCriticalIssues,
      discrepancyCount: stateCheck.discrepancies?.length || 0,
      severityCounts: stateCheck.severityCounts || { HIGH: 0, MEDIUM: 0, LOW: 0 },
      recommendation: hasHighSeverity ?
        'PERFORM_FULL_RECONCILIATION' :
        (stateCheck.discrepancies?.length > 0 ? 'MONITOR_DISCREPANCIES' : 'PROCEED'),
    };

  } catch (error) {
    logger.error("Proof state validation failed", {
      npub,
      proofsCount: proofs?.length || 0,
      error: error.message,
    });

    return {
      valid: false,
      error: error.message,
      recommendation: 'ABORT_OPERATION',
    };
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
