import crypto from "crypto";
import { getPublicKey, nip19, nip04 } from "nostr-tools";
import { CashuMint, CashuWallet, getEncodedToken } from "@cashu/cashu-ts";
import walletRepositoryService from "./walletRepository.service.js";
import { logger } from "../utils/logger.js";

// Initialize mint instance
const MINT_URL = process.env.MINT_URL || "https://mint.minibits.cash/Bitcoin";
const mint = new CashuMint(MINT_URL);

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

// ==================== ENHANCED CASHU SERVICE LAYER ====================

/**
 * Initialize a CashuWallet instance for a user
 * @param {string} npub - User's Nostr npub string
 * @returns {Promise<CashuWallet>} Initialized wallet instance
 */
async function initializeWallet(npub) {
  try {
    logger.info("Initializing Cashu wallet", { npub, mintUrl: MINT_URL });

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

    // Initialize CashuWallet instance
    const wallet = new CashuWallet(mint, {
      unit: walletDoc.wallet_config?.unit || "sat",
    });

    logger.info("Cashu wallet initialized successfully", {
      npub,
      mintUrl: MINT_URL,
    });
    return { wallet, walletDoc };
  } catch (error) {
    logger.error("Failed to initialize Cashu wallet", {
      npub,
      mintUrl: MINT_URL,
      error: error.message,
    });
    throw new Error(`Failed to initialize wallet: ${error.message}`);
  }
}

/**
 * Create mint quote and mint tokens from Lightning
 * @param {string} npub - User's Nostr npub string
 * @param {number} amount - Amount to mint in satoshis
 * @returns {Promise<Object>} Mint result with quote and proofs
 */
export async function mintTokens(npub, amount) {
  try {
    logger.info("Starting mint tokens operation", { npub, amount });

    const { wallet, walletDoc } = await initializeWallet(npub);

    // Create mint quote
    const mintQuote = await wallet.createMintQuote(amount);
    logger.info("Created mint quote", {
      npub,
      amount,
      quoteId: mintQuote.quote,
      invoice: mintQuote.request,
    });

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
      metadata: {
        source: "lightning",
        quote_id: mintQuote.quote,
        mint_amount: amount,
        invoice: mintQuote.request,
        expiry: mintQuote.expiry,
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

    return {
      quote: mintQuote.quote,
      invoice: mintQuote.request,
      amount,
      transactionId,
      expiry: mintQuote.expiry,
      mintUrl: MINT_URL,
    };
  } catch (error) {
    logger.error("Failed to create mint quote", {
      npub,
      amount,
      error: error.message,
    });
    throw new Error(`Failed to mint tokens: ${error.message}`);
  }
}

/**
 * Complete minting process after Lightning invoice is paid
 * @param {string} npub - User's Nostr npub string
 * @param {string} quoteId - Mint quote ID
 * @param {number} amount - Amount to mint
 * @param {string} transactionId - Transaction ID
 * @returns {Promise<Object>} Minted proofs and token storage result
 */
export async function completeMinting(npub, quoteId, amount, transactionId) {
  try {
    logger.info("Completing minting process", {
      npub,
      quoteId,
      amount,
      transactionId,
    });

    const { wallet, walletDoc } = await initializeWallet(npub);

    // Check if quote is paid
    const quoteStatus = await wallet.checkMintQuote(quoteId);
    if (quoteStatus.state !== "PAID") {
      throw new Error(`Quote not paid yet. Status: ${quoteStatus.state}`);
    }

    // Mint the proofs
    const proofs = await wallet.mintProofs(amount, quoteId);
    logger.info("Successfully minted proofs", {
      npub,
      quoteId,
      proofsCount: proofs.length,
      totalAmount: proofs.reduce((sum, p) => sum + p.amount, 0),
    });

    // Check if there's an existing pending transaction to update
    const existingTokens =
      await walletRepositoryService.findTokensByTransactionId(transactionId);
    let tokenDoc;

    if (existingTokens.length > 0 && existingTokens[0].status === "pending") {
      // Update the existing pending transaction with the minted proofs
      const pendingToken = existingTokens[0];
      tokenDoc = await walletRepositoryService.updatePendingTransaction(
        pendingToken._id,
        {
          proofs,
          status: "unspent",
          total_amount: proofs.reduce((sum, p) => sum + p.amount, 0),
          metadata: {
            ...pendingToken.metadata,
            completed_at: new Date(),
          },
        }
      );

      logger.info("Updated pending transaction with minted tokens", {
        npub,
        tokenId: tokenDoc._id,
        transactionId,
        proofsCount: proofs.length,
      });
    } else {
      // Create new token document (fallback for legacy transactions)
      tokenDoc = await walletRepositoryService.storeTokens({
        npub,
        wallet_id: walletDoc._id,
        proofs,
        mint_url: MINT_URL,
        transaction_type: "minted",
        transaction_id: transactionId,
        metadata: {
          source: "lightning",
          quote_id: quoteId,
          mint_amount: amount,
        },
      });

      logger.info("Stored minted tokens in database", {
        npub,
        tokenId: tokenDoc._id,
        transactionId,
      });
    }

    return {
      proofs,
      tokenId: tokenDoc._id,
      transactionId,
      totalAmount: proofs.reduce((sum, p) => sum + p.amount, 0),
    };
  } catch (error) {
    logger.error("Failed to complete minting", {
      npub,
      quoteId,
      amount,
      transactionId,
      error: error.message,
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
 * Pay Lightning invoice with tokens (melt operation)
 * @param {string} npub - User's Nostr npub string
 * @param {string} invoice - Lightning invoice to pay
 * @returns {Promise<Object>} Payment result and change information
 */
export async function meltTokens(npub, invoice) {
  try {
    logger.info("Starting melt tokens operation", {
      npub,
      invoice: invoice.substring(0, 50) + "...",
    });

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

    // Collect all proofs from selected tokens
    const allProofs = [];
    const tokenIds = [];

    for (const token of selection.selected_tokens) {
      allProofs.push(...token.proofs);
      tokenIds.push(token._id);
    }

    // Send the required amount for melting
    const { send, keep } = await wallet.send(totalNeeded, allProofs, {
      includeFees: true,
    });

    // Execute the melt operation
    const meltResponse = await wallet.meltProofs(meltQuote, send);

    logger.info("Successfully melted tokens", {
      npub,
      quoteId: meltQuote.quote,
      paymentResult: meltResponse.state,
      changeProofs: meltResponse.change?.length || 0,
    });

    // Generate transaction ID
    const transactionId = walletRepositoryService.generateTransactionId("melt");

    // Mark spent tokens as spent
    await walletRepositoryService.markTokensAsSpent(tokenIds);

    // Store melted tokens record for transaction history
    await walletRepositoryService.storeTokens({
      npub,
      wallet_id: walletDoc._id,
      proofs: send,
      mint_url: MINT_URL,
      transaction_type: "melted",
      transaction_id: transactionId,
      metadata: {
        source: "lightning",
        quote_id: meltQuote.quote,
        invoice_amount: meltQuote.amount,
        fee_reserve: meltQuote.fee_reserve,
        total_amount: totalNeeded,
      },
    });

    // Store change tokens (from send operation)
    if (keep.length > 0) {
      await walletRepositoryService.storeTokens({
        npub,
        wallet_id: walletDoc._id,
        proofs: keep,
        mint_url: MINT_URL,
        transaction_type: "change",
        transaction_id: transactionId,
        metadata: {
          source: "change",
          original_amount: selection.total_selected,
          melt_amount: totalNeeded,
          change_from_selection: true,
        },
      });
    }

    // Store change tokens from melt operation if any
    if (meltResponse.change && meltResponse.change.length > 0) {
      await walletRepositoryService.storeTokens({
        npub,
        wallet_id: walletDoc._id,
        proofs: meltResponse.change,
        mint_url: MINT_URL,
        transaction_type: "change",
        transaction_id: transactionId,
        metadata: {
          source: "change",
          change_from_melt: true,
          quote_id: meltQuote.quote,
        },
      });
    }

    return {
      transactionId,
      paymentResult: meltResponse.state,
      paidAmount: meltQuote.amount,
      feesPaid: meltQuote.fee_reserve,
      changeAmount:
        keep.reduce((sum, p) => sum + p.amount, 0) +
        (meltResponse.change?.reduce((sum, p) => sum + p.amount, 0) || 0),
      quoteId: meltQuote.quote,
    };
  } catch (error) {
    logger.error("Failed to melt tokens", {
      npub,
      invoice: invoice.substring(0, 50) + "...",
      error: error.message,
    });
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
 * Verify proof states with mint
 * @param {string} npub - User's Nostr npub string
 * @param {Array} [proofs] - Optional specific proofs to check, otherwise checks all unspent
 * @returns {Promise<Object>} Proof states and any discrepancies
 */
export async function checkProofStates(npub, proofs = null) {
  try {
    logger.info("Checking proof states", { npub, customProofs: !!proofs });

    const { wallet } = await initializeWallet(npub);

    let proofsToCheck = proofs;

    // If no specific proofs provided, get all unspent tokens
    if (!proofsToCheck) {
      const unspentTokens = await walletRepositoryService.findUnspentTokens(
        npub,
        MINT_URL
      );
      proofsToCheck = [];

      for (const token of unspentTokens) {
        proofsToCheck.push(...token.proofs);
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
      };
    }

    // Check proof states with mint
    const states = await wallet.checkProofsStates(proofsToCheck);

    // Analyze states
    const stateAnalysis = {
      UNSPENT: 0,
      SPENT: 0,
      PENDING: 0,
    };

    const discrepancies = [];

    states.forEach((state, index) => {
      stateAnalysis[state.state]++;

      // Check for discrepancies with database
      const proof = proofsToCheck[index];
      // This would require additional logic to compare with database state
    });

    logger.info("Completed proof state check", {
      npub,
      totalProofs: proofsToCheck.length,
      unspentCount: stateAnalysis.UNSPENT,
      spentCount: stateAnalysis.SPENT,
      pendingCount: stateAnalysis.PENDING,
    });

    return {
      states,
      totalProofs: proofsToCheck.length,
      spentCount: stateAnalysis.SPENT,
      unspentCount: stateAnalysis.UNSPENT,
      pendingCount: stateAnalysis.PENDING,
      discrepancies,
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

// ==================== BACKGROUND POLLING ====================

/**
 * Start background polling to check if mint quote is paid and complete minting
 * @param {string} npub - User's Nostr npub string
 * @param {string} quoteId - Mint quote ID to monitor
 * @param {number} amount - Amount to mint
 * @param {string} transactionId - Transaction ID
 */
function startMintPolling(npub, quoteId, amount, transactionId) {
  const POLLING_INTERVAL = 10000; // 10 seconds
  const POLLING_DURATION = 180000; // 3 minutes
  const startTime = Date.now();

  logger.info("Starting mint polling", {
    npub,
    quoteId,
    amount,
    transactionId,
    pollingInterval: `${POLLING_INTERVAL / 1000}s`,
    pollingDuration: `${POLLING_DURATION / 1000}s`,
  });

  const pollInterval = setInterval(async () => {
    try {
      const elapsed = Date.now() - startTime;

      // Stop polling after 3 minutes
      if (elapsed >= POLLING_DURATION) {
        clearInterval(pollInterval);
        logger.info("Mint polling timeout reached", {
          npub,
          quoteId,
          elapsed: `${elapsed / 1000}s`,
          status: "timeout",
        });
        return;
      }

      logger.info("Checking mint quote status", {
        npub,
        quoteId,
        elapsed: `${elapsed / 1000}s`,
        attempt: Math.floor(elapsed / POLLING_INTERVAL) + 1,
      });

      // Initialize wallet to check quote status
      const { wallet } = await initializeWallet(npub);
      const quoteStatus = await wallet.checkMintQuote(quoteId);

      if (quoteStatus.state === "PAID") {
        clearInterval(pollInterval);

        logger.info("Invoice paid! Completing minting automatically", {
          npub,
          quoteId,
          elapsed: `${elapsed / 1000}s`,
          status: "paid",
        });

        // Complete the minting process
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
          });
        } catch (completionError) {
          logger.error("Failed to complete background minting", {
            npub,
            quoteId,
            transactionId,
            error: completionError.message,
          });
        }
      } else {
        logger.info("Invoice not yet paid, continuing to poll", {
          npub,
          quoteId,
          status: quoteStatus.state,
          elapsed: `${elapsed / 1000}s`,
        });
      }
    } catch (error) {
      logger.error("Error during mint polling", {
        npub,
        quoteId,
        error: error.message,
      });
      // Continue polling despite errors
    }
  }, POLLING_INTERVAL);

  // Store the interval ID in case we need to cancel it
  // In a production system, you might want to store this in a database or cache
  return pollInterval;
}
