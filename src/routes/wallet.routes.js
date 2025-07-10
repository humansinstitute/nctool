import express from "express";
import * as walletController from "../controllers/wallet.controller.js";

const router = express.Router();

// ==================== WALLET CREATION ====================

/**
 * Create a new eCash wallet for a user
 * POST /api/wallet/create
 *
 * Body: {
 *   "npub": "npub1..."
 * }
 */
router.post("/create", walletController.create);

// ==================== NPUB-BASED WALLET OPERATIONS ====================

/**
 * Get wallet balance for a user
 * GET /api/wallet/:npub/balance
 */
router.get("/:npub/balance", walletController.getBalance);

/**
 * Mint tokens from Lightning invoice
 * POST /api/wallet/:npub/mint
 *
 * Body: {
 *   "amount": 1000
 * }
 */
router.post("/:npub/mint", walletController.mintTokens);

/**
 * Complete minting process after Lightning invoice is paid
 * POST /api/wallet/:npub/mint/complete
 *
 * Body: {
 *   "quoteId": "quote_id_from_mint_response",
 *   "amount": 1000,
 *   "transactionId": "transaction_id_from_mint_response"
 * }
 */
router.post("/:npub/mint/complete", walletController.completeMintTokens);

/**
 * Send tokens to another user
 * POST /api/wallet/:npub/send
 *
 * Body: {
 *   "amount": 500,
 *   "recipientPubkey": "02abcd..." (optional)
 * }
 */
router.post("/:npub/send", walletController.sendTokens);

/**
 * Receive tokens from encoded token
 * POST /api/wallet/:npub/receive
 *
 * Body: {
 *   "encodedToken": "cashuAey...",
 *   "privateKey": "hex_private_key" (optional, for P2PK tokens)
 * }
 */
router.post("/:npub/receive", walletController.receiveTokens);

/**
 * Melt tokens to pay Lightning invoice
 * POST /api/wallet/:npub/melt
 *
 * Body: {
 *   "invoice": "lnbc1..."
 * }
 */
router.post("/:npub/melt", walletController.meltTokens);

/**
 * Check proof states with mint
 * GET /api/wallet/:npub/proofs/status
 *
 * Query params:
 *   - proofs: JSON array of proofs to check (optional)
 */
router.get("/:npub/proofs/status", walletController.checkProofStates);

/**
 * Get transaction history for a user
 * GET /api/wallet/:npub/transactions
 *
 * Query params:
 *   - limit: Number of transactions to return (1-100, default: 50)
 *   - skip: Number of transactions to skip (default: 0)
 *   - transaction_type: Filter by transaction type (optional)
 *   - mint_url: Filter by mint URL (optional)
 */
router.get("/:npub/transactions", walletController.getTransactionHistory);

/**
 * Get wallet information and metadata
 * GET /api/wallet/:npub/info
 */
router.get("/:npub/info", walletController.getWalletInfo);

/**
 * Check pending receipts and automatically complete paid minting operations
 * GET /api/wallet/:npub/receipts/check
 */
router.get("/:npub/receipts/check", walletController.checkPendingReceipts);

export default router;
