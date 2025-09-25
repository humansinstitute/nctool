import { nip19 } from "nostr-tools";
import { getDecodedToken } from "@cashu/cashu-ts";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { getAllKeys } from "../services/identity.service.js";
import { receiveTokens as cashuReceiveTokens } from "../services/cashu.service.js";
import walletRepositoryService from "../services/walletRepository.service.js";
import { logger } from "../utils/logger.js";

const DEFAULT_MIN_SATS = 21;
const MIN_SATS = (() => {
  const parsed = Number(process.env.CASHUWALL_MIN_SATS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_SATS;
})();

export const submit = asyncHandler(async (req, res) => {
  const { encodedToken, npub: npubIn, privateKey } = req.body || {};

  if (!encodedToken || typeof encodedToken !== "string") {
    return res.status(400).json({
      accepted: false,
      error: "encodedToken is required (cashu... string)",
    });
  }

  // Determine recipient npub
  const npub = npubIn || process.env.CASHUWALL_NPUB;
  if (!npub) {
    return res.status(400).json({
      accepted: false,
      error: "npub is required (pass in body or set CASHUWALL_NPUB)",
    });
  }

  // Validate user exists
  const keys = await getAllKeys();
  const keyObj = keys.find((k) => k.npub === npub);
  if (!keyObj) {
    return res.status(404).json({ accepted: false, error: "Recipient user not found" });
  }

  // Validate npub format
  try {
    nip19.decode(npub);
  } catch (error) {
    return res.status(400).json({ accepted: false, error: "Invalid npub format" });
  }

  // Decode token to check amount before redeeming
  let totalAmount = 0;
  let token;
  try {
    token = getDecodedToken(encodedToken);
    if (!token?.proofs || !Array.isArray(token.proofs)) {
      throw new Error("Invalid token structure");
    }
    totalAmount = token.proofs.reduce((sum, p) => sum + (p.amount || 0), 0);
  } catch (error) {
    return res.status(400).json({ accepted: false, error: `Invalid token: ${error.message}` });
  }

  // Optional: enforce mint URL match (prevents accidental deposit to wrong mint env)
  if (token.mint && process.env.MINT_URL && token.mint !== process.env.MINT_URL) {
    return res.status(400).json({
      accepted: false,
      error: "mint_url_mismatch",
      tokenMint: token.mint,
      serverMint: process.env.MINT_URL,
    });
  }

  if (totalAmount < MIN_SATS) {
    logger.info("CashuWall denied: below threshold", { npub, totalAmount, min: MIN_SATS });
    return res.status(200).json({
      accepted: false,
      status: "denied",
      reason: "amount_below_threshold",
      amount: totalAmount,
      required: MIN_SATS,
    });
  }

  // Redeem (receive) tokens into recipient's wallet
  try {
    const result = await cashuReceiveTokens(npub, encodedToken, privateKey);
    logger.info("CashuWall accepted and redeemed", {
      npub,
      amount: result.totalAmount,
      tokenId: result.tokenId,
      transactionId: result.transactionId,
    });

    return res.status(200).json({
      accepted: true,
      status: "accepted",
      amount: result.totalAmount,
      min: MIN_SATS,
      tokenId: result.tokenId,
      transactionId: result.transactionId,
    });
  } catch (error) {
    logger.error("CashuWall redeem failed", { npub, error: error.message });
    return res.status(500).json({ accepted: false, error: `Redeem failed: ${error.message}` });
  }
});
