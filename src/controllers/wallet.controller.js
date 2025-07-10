import { nip04, nip19 } from "nostr-tools";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { connect } from "../services/nostr.service.js";
import { getAllKeys, updateWalletInfo } from "../services/identity.service.js";
import {
  generateP2PKKeypair,
  checkWalletExists,
  getWalletDetails,
  getBalance as cashuGetBalance,
  mintTokens as cashuMintTokens,
  completeMinting,
  sendTokens as cashuSendTokens,
  receiveTokens as cashuReceiveTokens,
  meltTokens as cashuMeltTokens,
  checkProofStates as cashuCheckProofStates,
} from "../services/cashu.service.js";
import walletRepositoryService from "../services/walletRepository.service.js";
import ValidationService from "../services/validation.service.js";
import MonitoringService from "../services/monitoring.service.js";
import RecoveryService from "../services/recovery.service.js";
import { logger } from "../utils/logger.js";

const MINT_URL = process.env.MINT_URL || "https://mint.minibits.cash/Bitcoin";

/**
 * Creates a new eCash wallet for a user by publishing:
 *  - kind 17375 (wallet metadata)
 *  - kind 10019 (NIP-61 payment info)
 */
export const create = asyncHandler(async (req, res) => {
  const { npub } = req.body;
  logger.info("Creating eCash wallet", { npub });

  if (!npub) {
    logger.error("Wallet creation failed: npub is required");
    return res.status(400).json({ error: "npub is required" });
  }

  // Validate npub format
  try {
    nip19.decode(npub);
  } catch (error) {
    logger.error("Wallet creation failed: Invalid npub format", { npub });
    return res.status(400).json({ error: "Invalid npub format" });
  }

  try {
    // Look up user's key object
    const keys = await getAllKeys();
    const keyObj = keys.find((k) => k.npub === npub);
    if (!keyObj) {
      logger.error("Wallet creation failed: User not found", { npub });
      return res.status(404).json({ error: "User not found" });
    }

    const { nsec } = keyObj;
    const { ndk } = await connect(keyObj);

    // Check if wallet already exists in Nostr events
    const exists = await checkWalletExists(npub, ndk);
    if (exists) {
      const details = await getWalletDetails(npub, nsec, ndk);
      logger.info("Wallet already exists", { npub, mint: details.mint });
      return res.json({
        message: "Wallet already exists",
        walletDetails: {
          mint: details.mint,
          p2pkPub: details.p2pkPub,
        },
      });
    }

    // Check if wallet exists in database
    const existingWallet = await walletRepositoryService.findWallet(
      npub,
      MINT_URL
    );
    if (existingWallet) {
      logger.info("Wallet already exists in database", {
        npub,
        walletId: existingWallet._id,
      });
      return res.json({
        message: "Wallet already exists",
        walletDetails: {
          mint: MINT_URL,
          p2pkPub: existingWallet.p2pk_pubkey,
        },
      });
    }

    // Generate new P2PK keypair
    const { privkey: p2pkPriv, pubkey: p2pkPub } = generateP2PKKeypair();
    logger.info("Generated P2PK keypair for wallet", {
      npub,
      p2pkPub: p2pkPub.substring(0, 10) + "...",
    });

    // Create wallet in database
    const walletData = {
      npub,
      mint_url: MINT_URL,
      p2pk_pubkey: p2pkPub,
      p2pk_privkey: p2pkPriv, // In production, this should be encrypted
      wallet_config: {
        unit: "sat",
        created_via: "api",
      },
    };

    const wallet = await walletRepositoryService.createWallet(walletData);
    logger.info("Created wallet in database", { npub, walletId: wallet._id });

    // Decode Nostr keys for encryption
    const { data: privHex } = nip19.decode(nsec);
    const { data: pubHex } = nip19.decode(npub);

    // Build and encrypt wallet metadata event (kind 17375)
    const walletContent = JSON.stringify({ mint: MINT_URL, p2pkPriv });
    const encryptedContent = await nip04.encrypt(
      privHex,
      pubHex,
      walletContent
    );
    const walletEvent = new NDKEvent(ndk, {
      kind: 17375,
      content: encryptedContent,
      tags: [["mint", MINT_URL]],
    });
    await walletEvent.sign();
    const walletRelays = await walletEvent.publish();
    logger.info("Published wallet metadata event", {
      npub,
      eventId: walletEvent.id,
    });

    // Build Nutzap info event (kind 10019)
    const infoEvent = new NDKEvent(ndk, {
      kind: 10019,
      content: "",
      tags: [
        ["relay", process.env.RELAYS?.split(",")[0] || "wss://relay.damus.io"],
        ["mint", MINT_URL],
        ["pubkey", "02" + p2pkPub],
      ],
    });
    await infoEvent.sign();
    const infoRelays = await infoEvent.publish();
    logger.info("Published Nutzap info event", { npub, eventId: infoEvent.id });

    // Store wallet info in keys.json
    keyObj.wallet = { mint: MINT_URL, p2pkPub };
    await updateWalletInfo(npub, { mint: MINT_URL, p2pkPub });

    logger.info("Successfully created wallet", {
      npub,
      mint: MINT_URL,
      p2pkPub,
    });

    // Return success with details and event IDs
    res.json({
      success: true,
      message: "Wallet created successfully",
      walletDetails: {
        mint: MINT_URL,
        p2pkPub,
      },
      events: {
        wallet: {
          id: walletEvent.id,
          relays: [...walletRelays].map((r) => r.url),
        },
        info: {
          id: infoEvent.id,
          relays: [...infoRelays].map((r) => r.url),
        },
      },
    });
  } catch (error) {
    logger.error("Failed to create wallet", {
      npub,
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to create wallet",
      message: error.message,
    });
  }
});

// ==================== PRODUCTION API ENDPOINTS ====================

/**
 * Get wallet balance for a user
 * GET /api/wallet/:npub/balance
 */
export const getBalance = asyncHandler(async (req, res) => {
  const { npub } = req.params;
  logger.info("Getting wallet balance", { npub });

  if (!npub) {
    return res.status(400).json({ error: "npub is required" });
  }

  // Validate npub format
  try {
    nip19.decode(npub);
  } catch (error) {
    return res.status(400).json({ error: "Invalid npub format" });
  }

  // Validate user exists
  const keys = await getAllKeys();
  const keyObj = keys.find((k) => k.npub === npub);
  if (!keyObj) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    const balance = await cashuGetBalance(npub);

    // DEBUG: Log the exact balance structure
    logger.info("DEBUG: Balance object structure", {
      npub,
      balanceType: typeof balance,
      balanceKeys: Object.keys(balance),
      balanceStringified: JSON.stringify(balance),
    });

    logger.info("Successfully retrieved wallet balance", {
      npub,
      unspentBalance: balance.unspent_balance,
      totalBalance: balance.total_balance,
    });

    res.json({
      success: true,
      balance: balance.total_balance, // Client expects this to be a number
      details: {
        totalBalance: balance.total_balance,
        unspentBalance: balance.unspent_balance,
        pendingBalance: balance.pending_balance,
        spentBalance: balance.spent_balance,
      },
    });
  } catch (error) {
    logger.error("Failed to get wallet balance", {
      npub,
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to get wallet balance",
      message: error.message,
    });
  }
});

/**
 * Mint tokens from Lightning invoice
 * POST /api/wallet/:npub/mint
 */
export const mintTokens = asyncHandler(async (req, res) => {
  const { npub } = req.params;
  const { amount } = req.body;
  logger.info("Starting mint tokens operation with safeguards", {
    npub,
    amount,
  });

  // Enhanced input validation using ValidationService
  const validation = await ValidationService.validateMintingRequest({
    npub,
    amount,
  });

  if (!validation.isValid) {
    logger.warn("Minting request validation failed", {
      npub,
      amount,
      errors: validation.errors,
    });

    return res.status(400).json({
      error: "Validation failed",
      details: validation.errors,
      warnings: validation.warnings,
    });
  }

  // Log warnings if any
  if (validation.warnings.length > 0) {
    logger.warn("Minting request has warnings", {
      npub,
      amount,
      warnings: validation.warnings,
    });
  }

  // Validate user exists (additional check)
  const keys = await getAllKeys();
  const keyObj = keys.find((k) => k.npub === npub);
  if (!keyObj) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    // Track minting attempt
    MonitoringService.trackMintingAttempt(npub, amount, null);

    const mintResult = await cashuMintTokens(npub, amount);

    // Track successful minting
    MonitoringService.trackMintingSuccess(
      npub,
      mintResult.transactionId,
      mintResult
    );

    logger.info("Successfully created mint quote with safeguards", {
      npub,
      amount,
      quoteId: mintResult.quote,
      transactionId: mintResult.transactionId,
    });

    res.json({
      success: true,
      quote: mintResult.quote,
      invoice: mintResult.invoice,
      amount: mintResult.amount,
      transactionId: mintResult.transactionId,
      expiry: mintResult.expiry,
      mintUrl: mintResult.mintUrl,
      warnings: validation.warnings,
    });
  } catch (error) {
    // Track failed minting
    MonitoringService.trackMintingFailure(npub, null, error.message);

    logger.error("Failed to mint tokens", {
      npub,
      amount,
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to mint tokens",
      message: error.message,
    });
  }
});

/**
 * Complete minting process after Lightning invoice is paid
 * POST /api/wallet/:npub/mint/complete
 */
export const completeMintTokens = asyncHandler(async (req, res) => {
  const { npub } = req.params;
  const { quoteId, amount, transactionId } = req.body;
  const startTime = Date.now();

  logger.info("Starting complete mint operation with safeguards", {
    npub,
    quoteId,
    amount,
    transactionId,
  });

  // Enhanced input validation using ValidationService
  const validation = ValidationService.validateCompletionRequest({
    npub,
    quoteId,
    amount,
    transactionId,
  });

  if (!validation.isValid) {
    logger.warn("Completion request validation failed", {
      npub,
      quoteId,
      transactionId,
      errors: validation.errors,
    });

    return res.status(400).json({
      error: "Validation failed",
      details: validation.errors,
    });
  }

  // Validate user exists
  const keys = await getAllKeys();
  const keyObj = keys.find((k) => k.npub === npub);
  if (!keyObj) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    // Track completion attempt
    MonitoringService.trackCompletionAttempt(npub, transactionId, quoteId);

    const completionResult = await completeMinting(
      npub,
      quoteId,
      amount,
      transactionId
    );

    const completionTime = Date.now() - startTime;

    // Track successful completion
    MonitoringService.trackCompletionSuccess(
      npub,
      transactionId,
      completionTime,
      completionResult
    );

    logger.info("Successfully completed minting with safeguards", {
      npub,
      quoteId,
      transactionId: completionResult.transactionId,
      totalAmount: completionResult.totalAmount,
      completionTime: `${completionTime}ms`,
    });

    res.json({
      success: true,
      proofs: completionResult.proofs,
      tokenId: completionResult.tokenId,
      transactionId: completionResult.transactionId,
      totalAmount: completionResult.totalAmount,
      mintUrl: MINT_URL,
      completionTime,
    });
  } catch (error) {
    // Track failed completion
    MonitoringService.trackCompletionFailure(
      npub,
      transactionId,
      error.message
    );

    logger.error("Failed to complete minting", {
      npub,
      quoteId,
      amount,
      transactionId,
      error: error.message,
    });

    // If it's an updatePendingTransaction error, try recovery
    if (error.message.includes("Failed to update pending transaction")) {
      logger.info("Attempting recovery for failed updatePendingTransaction", {
        npub,
        transactionId,
      });

      try {
        // Find the token to get its ID
        const tokens = await walletRepositoryService.findTokensByTransactionId(
          transactionId
        );
        if (tokens.length > 0) {
          const retryResult =
            await RecoveryService.retryUpdatePendingTransaction(tokens[0]._id, {
              status: "failed",
              metadata: {
                ...tokens[0].metadata,
                failed_at: new Date(),
                failure_reason: error.message,
                recovery_attempted: true,
              },
            });

          if (retryResult.success) {
            logger.info("Recovery successful for updatePendingTransaction", {
              npub,
              transactionId,
              attempts: retryResult.attempts,
            });
          }
        }
      } catch (recoveryError) {
        logger.error("Recovery failed for updatePendingTransaction", {
          npub,
          transactionId,
          recoveryError: recoveryError.message,
        });
      }
    }

    res.status(500).json({
      error: "Failed to complete minting",
      message: error.message,
    });
  }
});

/**
 * Send tokens to another user
 * POST /api/wallet/:npub/send
 */
export const sendTokens = asyncHandler(async (req, res) => {
  const { npub } = req.params;
  const { amount, recipientPubkey } = req.body;
  logger.info("Starting send tokens operation", {
    npub,
    amount,
    recipientPubkey,
  });

  if (!npub) {
    return res.status(400).json({ error: "npub is required" });
  }

  if (!amount || typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({
      error: "amount is required and must be a positive number",
    });
  }

  // Validate npub format
  try {
    nip19.decode(npub);
  } catch (error) {
    return res.status(400).json({ error: "Invalid npub format" });
  }

  // Validate user exists
  const keys = await getAllKeys();
  const keyObj = keys.find((k) => k.npub === npub);
  if (!keyObj) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    const sendResult = await cashuSendTokens(npub, amount, recipientPubkey);

    logger.info("Successfully sent tokens", {
      npub,
      amount,
      transactionId: sendResult.transactionId,
      changeAmount: sendResult.changeAmount,
    });

    res.json({
      success: true,
      encodedToken: sendResult.encodedToken,
      transactionId: sendResult.transactionId,
      amount: sendResult.amount,
      changeAmount: sendResult.changeAmount,
      recipientPubkey: sendResult.recipientPubkey,
      mintUrl: sendResult.mintUrl,
    });
  } catch (error) {
    logger.error("Failed to send tokens", {
      npub,
      amount,
      recipientPubkey,
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to send tokens",
      message: error.message,
    });
  }
});

/**
 * Receive tokens from encoded token
 * POST /api/wallet/:npub/receive
 */
export const receiveTokens = asyncHandler(async (req, res) => {
  const { npub } = req.params;
  const { encodedToken, privateKey } = req.body;
  logger.info("Starting receive tokens operation", {
    npub,
    hasPrivateKey: !!privateKey,
  });

  if (!npub) {
    return res.status(400).json({ error: "npub is required" });
  }

  if (!encodedToken || typeof encodedToken !== "string") {
    return res.status(400).json({
      error: "encodedToken is required and must be a string",
    });
  }

  // Validate npub format
  try {
    nip19.decode(npub);
  } catch (error) {
    return res.status(400).json({ error: "Invalid npub format" });
  }

  // Validate user exists
  const keys = await getAllKeys();
  const keyObj = keys.find((k) => k.npub === npub);
  if (!keyObj) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    const receiveResult = await cashuReceiveTokens(
      npub,
      encodedToken,
      privateKey
    );

    logger.info("Successfully received tokens", {
      npub,
      transactionId: receiveResult.transactionId,
      totalAmount: receiveResult.totalAmount,
    });

    res.json({
      success: true,
      proofs: receiveResult.proofs,
      tokenId: receiveResult.tokenId,
      transactionId: receiveResult.transactionId,
      totalAmount: receiveResult.totalAmount,
      mintUrl: receiveResult.mintUrl,
    });
  } catch (error) {
    logger.error("Failed to receive tokens", {
      npub,
      hasPrivateKey: !!privateKey,
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to receive tokens",
      message: error.message,
    });
  }
});

/**
 * Melt tokens to pay Lightning invoice
 * POST /api/wallet/:npub/melt
 */
export const meltTokens = asyncHandler(async (req, res) => {
  const { npub } = req.params;
  const { invoice } = req.body;
  logger.info("Starting melt tokens operation", { npub });

  if (!npub) {
    return res.status(400).json({ error: "npub is required" });
  }

  if (!invoice || typeof invoice !== "string") {
    return res.status(400).json({
      error: "invoice is required and must be a string",
    });
  }

  // Validate npub format
  try {
    nip19.decode(npub);
  } catch (error) {
    return res.status(400).json({ error: "Invalid npub format" });
  }

  // Validate user exists
  const keys = await getAllKeys();
  const keyObj = keys.find((k) => k.npub === npub);
  if (!keyObj) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    const meltResult = await cashuMeltTokens(npub, invoice);

    logger.info("Successfully melted tokens", {
      npub,
      transactionId: meltResult.transactionId,
      paidAmount: meltResult.paidAmount,
      paymentResult: meltResult.paymentResult,
    });

    res.json({
      success: true,
      transactionId: meltResult.transactionId,
      paymentResult: meltResult.paymentResult,
      paidAmount: meltResult.paidAmount,
      feesPaid: meltResult.feesPaid,
      changeAmount: meltResult.changeAmount,
      quoteId: meltResult.quoteId,
    });
  } catch (error) {
    logger.error("Failed to melt tokens", {
      npub,
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to melt tokens",
      message: error.message,
    });
  }
});

/**
 * Check proof states with mint
 * GET /api/wallet/:npub/proofs/status
 */
export const checkProofStates = asyncHandler(async (req, res) => {
  const { npub } = req.params;
  const { proofs } = req.query; // Optional query parameter for specific proofs
  logger.info("Checking proof states", { npub, customProofs: !!proofs });

  if (!npub) {
    return res.status(400).json({ error: "npub is required" });
  }

  // Validate npub format
  try {
    nip19.decode(npub);
  } catch (error) {
    return res.status(400).json({ error: "Invalid npub format" });
  }

  // Validate user exists
  const keys = await getAllKeys();
  const keyObj = keys.find((k) => k.npub === npub);
  if (!keyObj) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    let proofsToCheck = null;

    // Parse proofs if provided
    if (proofs) {
      try {
        proofsToCheck = JSON.parse(proofs);
      } catch (error) {
        return res.status(400).json({
          error: "Invalid proofs format - must be valid JSON array",
        });
      }
    }

    const stateResult = await cashuCheckProofStates(npub, proofsToCheck);

    logger.info("Successfully checked proof states", {
      npub,
      totalProofs: stateResult.totalProofs,
      unspentCount: stateResult.unspentCount,
      spentCount: stateResult.spentCount,
    });

    res.json({
      success: true,
      ...stateResult,
    });
  } catch (error) {
    logger.error("Failed to check proof states", {
      npub,
      customProofs: !!proofs,
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to check proof states",
      message: error.message,
    });
  }
});

/**
 * Get transaction history for a user
 * GET /api/wallet/:npub/transactions
 */
export const getTransactionHistory = asyncHandler(async (req, res) => {
  const { npub } = req.params;
  const { limit = 50, skip = 0, transaction_type, mint_url } = req.query;

  logger.info("Getting transaction history", {
    npub,
    limit,
    skip,
    transaction_type,
  });

  if (!npub) {
    return res.status(400).json({ error: "npub is required" });
  }

  // Validate npub format
  try {
    nip19.decode(npub);
  } catch (error) {
    return res.status(400).json({ error: "Invalid npub format" });
  }

  // Validate user exists
  const keys = await getAllKeys();
  const keyObj = keys.find((k) => k.npub === npub);
  if (!keyObj) {
    return res.status(404).json({ error: "User not found" });
  }

  // Validate query parameters
  const limitNum = parseInt(limit, 10);
  const skipNum = parseInt(skip, 10);

  if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
    return res.status(400).json({
      error: "limit must be a number between 1 and 100",
    });
  }

  if (isNaN(skipNum) || skipNum < 0) {
    return res.status(400).json({
      error: "skip must be a non-negative number",
    });
  }

  try {
    const historyResult = await walletRepositoryService.getTransactionHistory(
      npub,
      {
        limit: limitNum,
        skip: skipNum,
        transaction_type,
        mint_url,
      }
    );

    logger.info("Successfully retrieved transaction history", {
      npub,
      transactionCount: historyResult.transactions.length,
      totalTransactions: historyResult.pagination.total,
    });

    res.json({
      success: true,
      ...historyResult,
    });
  } catch (error) {
    logger.error("Failed to get transaction history", {
      npub,
      limit: limitNum,
      skip: skipNum,
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to get transaction history",
      message: error.message,
    });
  }
});

/**
 * Get wallet information and metadata
 * GET /api/wallet/:npub/info
 */
export const getWalletInfo = asyncHandler(async (req, res) => {
  const { npub } = req.params;
  logger.info("Getting wallet info", { npub });

  if (!npub) {
    return res.status(400).json({ error: "npub is required" });
  }

  // Validate npub format
  try {
    nip19.decode(npub);
  } catch (error) {
    return res.status(400).json({ error: "Invalid npub format" });
  }

  // Validate user exists
  const keys = await getAllKeys();
  const keyObj = keys.find((k) => k.npub === npub);
  if (!keyObj) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    // Get wallet statistics and details
    const [walletStats, balance] = await Promise.all([
      walletRepositoryService.getWalletStats(npub),
      cashuGetBalance(npub),
    ]);

    // Get wallet details from Nostr events if available
    let walletDetails = null;
    try {
      const { ndk } = await connect(keyObj);
      const exists = await checkWalletExists(npub, ndk);
      if (exists) {
        walletDetails = await getWalletDetails(npub, keyObj.nsec, ndk);
      }
    } catch (error) {
      logger.warn("Could not retrieve wallet details from Nostr", {
        npub,
        error: error.message,
      });
    }

    const walletInfo = {
      npub,
      mintUrl: MINT_URL,
      balance: balance.total_balance, // Extract just the total balance number for client compatibility
      statistics: walletStats,
      walletDetails: walletDetails
        ? {
            mint: walletDetails.mint,
            p2pkPub: walletDetails.p2pkPub,
          }
        : null,
      createdAt: walletStats.wallets[0]?.created_at || null,
    };

    logger.info("Successfully retrieved wallet info", {
      npub,
      walletCount: walletStats.wallet_count,
      totalTransactions: walletStats.total_transactions,
    });

    res.json({
      success: true,
      walletInfo,
    });
  } catch (error) {
    logger.error("Failed to get wallet info", {
      npub,
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to get wallet info",
      message: error.message,
    });
  }
});

/**
 * Check pending receipts and automatically complete paid minting operations
 * GET /api/wallet/:npub/receipts/check
 */
export const checkPendingReceipts = asyncHandler(async (req, res) => {
  const { npub } = req.params;
  logger.info("Checking pending receipts for automatic completion", { npub });

  if (!npub) {
    return res.status(400).json({ error: "npub is required" });
  }

  // Validate npub format
  try {
    nip19.decode(npub);
  } catch (error) {
    return res.status(400).json({ error: "Invalid npub format" });
  }

  // Validate user exists
  const keys = await getAllKeys();
  const keyObj = keys.find((k) => k.npub === npub);
  if (!keyObj) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    // Get CASHU_POLL hours from environment (default 24 hours)
    const pollHours = parseInt(process.env.CASHU_POLL || "24", 10);
    const lookbackMs = pollHours * 60 * 60 * 1000; // Convert to milliseconds
    const cutoffDate = new Date(Date.now() - lookbackMs);

    logger.info("Querying pending mint transactions", {
      npub,
      pollHours,
      cutoffDate: cutoffDate.toISOString(),
    });

    // Find pending mint transactions within the CASHU_POLL timeframe
    const pendingTransactions =
      await walletRepositoryService.findPendingMintTransactions(
        npub,
        cutoffDate
      );

    logger.info("Found pending mint transactions", {
      npub,
      count: pendingTransactions.length,
    });

    const completedTransactions = [];
    let completedCount = 0;

    // Process each pending transaction
    for (const transaction of pendingTransactions) {
      try {
        const { transaction_id, metadata } = transaction;
        const quoteId = metadata?.quote_id;
        const amount = metadata?.mint_amount;

        if (!quoteId || !amount) {
          logger.warn("Skipping transaction with missing quote_id or amount", {
            npub,
            transactionId: transaction_id,
            hasQuoteId: !!quoteId,
            hasAmount: !!amount,
          });
          continue;
        }

        logger.info("Checking quote status for pending transaction", {
          npub,
          transactionId: transaction_id,
          quoteId,
          amount,
        });

        // Use existing completeMinting function which checks quote status
        const completionResult = await completeMinting(
          npub,
          quoteId,
          amount,
          transaction_id
        );

        completedCount++;
        completedTransactions.push({
          transactionId: transaction_id,
          amount,
          quoteId,
          tokenId: completionResult.tokenId,
          totalAmount: completionResult.totalAmount,
        });

        logger.info("Successfully completed pending mint transaction", {
          npub,
          transactionId: transaction_id,
          quoteId,
          amount,
          tokenId: completionResult.tokenId,
        });
      } catch (error) {
        // Log error but continue processing other transactions
        logger.warn("Failed to complete pending transaction", {
          npub,
          transactionId: transaction.transaction_id,
          quoteId: transaction.metadata?.quote_id,
          error: error.message,
        });

        // If the error indicates the quote is not paid yet, that's expected
        if (error.message.includes("Quote not paid yet")) {
          logger.info("Quote not yet paid, will check again later", {
            npub,
            transactionId: transaction.transaction_id,
            quoteId: transaction.metadata?.quote_id,
          });
        }
      }
    }

    logger.info("Completed pending receipts check", {
      npub,
      checked: pendingTransactions.length,
      completed: completedCount,
    });

    res.json({
      success: true,
      checked: pendingTransactions.length,
      completed: completedCount,
      receipts: completedTransactions.map((tx) => ({
        transactionId: tx.transactionId,
        amount: tx.amount,
        quoteId: tx.quoteId,
        tokenId: tx.tokenId,
        totalAmount: tx.totalAmount,
      })),
      completedTransactions, // Keep for backward compatibility
    });
  } catch (error) {
    logger.error("Failed to check pending receipts", {
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to check pending receipts",
      message: error.message,
    });
  }
});

/**
 * Get system health and monitoring metrics
 * GET /api/wallet/system/health
 */
export const getSystemHealth = asyncHandler(async (req, res) => {
  logger.info("Getting system health metrics");

  try {
    const healthMetrics = await MonitoringService.getHealthMetrics();
    const runtimeMetrics = MonitoringService.getMintingMetrics();

    logger.info("Successfully retrieved system health", {
      status: healthMetrics.status,
      alertCount: healthMetrics.alerts?.length || 0,
    });

    res.json({
      success: true,
      health: healthMetrics,
      runtime: runtimeMetrics,
    });
  } catch (error) {
    logger.error("Failed to get system health", {
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to get system health",
      message: error.message,
    });
  }
});

/**
 * Clean up stuck pending transactions
 * POST /api/wallet/:npub/cleanup
 */
export const cleanupStuckTransactions = asyncHandler(async (req, res) => {
  const { npub } = req.params;
  const { dryRun = false, maxAge } = req.body;

  logger.info("Starting stuck transaction cleanup", {
    npub,
    dryRun,
  });

  // Validate npub format
  try {
    nip19.decode(npub);
  } catch (error) {
    return res.status(400).json({ error: "Invalid npub format" });
  }

  // Validate user exists
  const keys = await getAllKeys();
  const keyObj = keys.find((k) => k.npub === npub);
  if (!keyObj) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    const cleanupOptions = {};
    if (dryRun !== undefined) cleanupOptions.dryRun = dryRun;
    if (maxAge) cleanupOptions.maxAge = maxAge;

    const cleanupResult = await RecoveryService.cleanupStuckTransactions(
      npub,
      cleanupOptions
    );

    logger.info("Cleanup completed", {
      npub,
      dryRun,
      processed: cleanupResult.processed,
      cleaned: cleanupResult.cleaned,
      failed: cleanupResult.failed,
    });

    res.json({
      success: true,
      ...cleanupResult,
    });
  } catch (error) {
    logger.error("Failed to cleanup stuck transactions", {
      npub,
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to cleanup stuck transactions",
      message: error.message,
    });
  }
});

/**
 * Get recovery statistics for a user
 * GET /api/wallet/:npub/recovery/stats
 */
export const getRecoveryStats = asyncHandler(async (req, res) => {
  const { npub } = req.params;
  logger.info("Getting recovery stats", { npub });

  // Validate npub format
  try {
    nip19.decode(npub);
  } catch (error) {
    return res.status(400).json({ error: "Invalid npub format" });
  }

  // Validate user exists
  const keys = await getAllKeys();
  const keyObj = keys.find((k) => k.npub === npub);
  if (!keyObj) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    const recoveryStats = await RecoveryService.getRecoveryStats(npub);

    logger.info("Successfully retrieved recovery stats", {
      npub,
      totalPending: recoveryStats.totalPending,
      stuckOneHour: recoveryStats.stuckOneHour,
    });

    res.json({
      success: true,
      stats: recoveryStats,
    });
  } catch (error) {
    logger.error("Failed to get recovery stats", {
      npub,
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to get recovery stats",
      message: error.message,
    });
  }
});

/**
 * Manual alert check for stuck transactions
 * POST /api/wallet/system/check-alerts
 */
export const checkAlerts = asyncHandler(async (req, res) => {
  logger.info("Manual alert check requested");

  try {
    const alertResult = await MonitoringService.checkStuckTransactionAlerts();

    logger.info("Alert check completed", {
      alertSent: alertResult.alertSent,
    });

    res.json({
      success: true,
      ...alertResult,
    });
  } catch (error) {
    logger.error("Failed to check alerts", {
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to check alerts",
      message: error.message,
    });
  }
});
