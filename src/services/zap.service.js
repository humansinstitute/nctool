import { nip19 } from "nostr-tools";
import fetch from "node-fetch";
import ValidationService from "./validation.service.js";
import walletRepositoryService from "./walletRepository.service.js";
import { discoverWithApplesauce, requestInvoiceWithZap } from "./lnurl.applesauce.service.js";
import { meltTokens } from "./cashu.service.js";
import { buildZapRequest as buildZapReqApplesauce, buildZapReceipt as buildReceiptApplesauce, publishToRelays, buildTextNoteApplesauce } from "./applesauceZap.service.js";

function mapError(err) {
  const code = err.code || "PAYMENT_FAILED";
  const message = err.message || "payment failed";
  return { code, message };
}

export async function zap({ senderNpub, recipientNpub, amount, lightningAddress, relays }) {
  // 1) Validate inputs
  const vSender = ValidationService.validateNpub(senderNpub);
  const vRecipient = ValidationService.validateNpub(recipientNpub);
  const vAmount = ValidationService.validateAmount(amount);
  if (!vSender.isValid) throw Object.assign(new Error("Invalid sender npub"), { code: "INVALID_NPUB" });
  if (!vRecipient.isValid) throw Object.assign(new Error("Invalid recipient npub"), { code: "INVALID_NPUB" });
  if (!vAmount.isValid) throw Object.assign(new Error(vAmount.error), { code: "INVALID_AMOUNT" });

  // 2) Validate wallet exists and has balance
  const MINT_URL = process.env.MINT_URL;
  const walletCheck = await ValidationService.validateWalletExists(senderNpub);
  if (!walletCheck.isValid) {
    throw Object.assign(new Error("Sender wallet not found"), { code: "SENDER_WALLET_NOT_FOUND" });
  }
  const balance = await walletRepositoryService.getDetailedBalance(senderNpub, MINT_URL);
  if ((balance.unspent_balance || 0) < amount) {
    throw Object.assign(new Error("Wallet balance insufficient for zap amount"), { code: "INSUFFICIENT_BALANCE" });
  }

  // Build relay list (used for discovery, zap request, and publishing)
  const relayListEffective = (Array.isArray(relays) && relays.length)
    ? relays
    : (process.env.NOSTR_RELAY_MODE === 'remote'
        ? (process.env.NOSTR_REMOTE_RELAYS || '').split(',').map(s=>s.trim()).filter(Boolean)
        : (process.env.NOSTR_LOCAL_RELAYS || '').split(',').map(s=>s.trim()).filter(Boolean));

  // 3) LNURL discovery (prefer Applesauce), or use provided lightningAddress
  let ln;
  if (lightningAddress) {
    // Build lnurlp endpoint directly from provided address
    const [u, d] = String(lightningAddress).trim().toLowerCase().split("@");
    if (!u || !d) throw Object.assign(new Error("Invalid lightningAddress"), { code: "LNURL_ERROR" });
    ln = {
      endpoint: `https://${d}/.well-known/lnurlp/${encodeURIComponent(u)}`,
      // Will fill callback after fetch
    };
    // fetch metadata
    const metaResp = await fetch(ln.endpoint);
    if (!metaResp.ok) throw Object.assign(new Error(`LNURL service error: HTTP ${metaResp.status}`), { code: "LNURL_ERROR" });
    const meta = await metaResp.json();
    if (meta.status === "ERROR") throw Object.assign(new Error(meta.reason || "LNURL error"), { code: "LNURL_ERROR" });
    ln = { ...ln, callback: meta.callback, minSendable: meta.minSendable, maxSendable: meta.maxSendable, metadata: meta.metadata, method: "lud16", recipientName: null };
  } else {
    // Applesauce-only discovery; use effective relay list
    ln = await discoverWithApplesauce(recipientNpub, { relays: relayListEffective });
  }

  // 4) Build zap request (9734) using local signer via Applesauce
  const { data: recipientPubHex } = nip19.decode(recipientNpub);
  const extraTags = [];
  // Include relays tag per validator requirement
  const zapRequest = await buildZapReqApplesauce({ senderNpub, recipientPubHex, msats: amount * 1000, extraTags, relayList: relayListEffective });

  // 5) Request invoice
  const { invoice } = await requestInvoiceWithZap(ln.callback, amount * 1000, zapRequest);
  if (!invoice) {
    throw Object.assign(new Error("Could not generate Lightning invoice"), { code: "INVOICE_GENERATION_FAILED" });
  }

  // 6) Execute payment using Cashu melt
  const paymentResult = await meltTokens(senderNpub, invoice);

  // 7) Broadcast zap receipt (NIP-57) via Applesauce (no preimage available from melt)
  const zapReceipt = await buildReceiptApplesauce({ senderNpub, zapRequest, invoice, preimage: null, relayList: relayListEffective, recipientPubHexFallback: recipientPubHex });
  await publishToRelays(zapReceipt, relayListEffective);

  // 8) Social broadcasting (kind 1) via Applesauce only
  const recipientName = ln.recipientName || recipientNpub;
  const socialEvent = await buildTextNoteApplesauce({
    senderNpub,
    content: `Donation made to ${recipientName} - ${amount} sats`,
    tags: [["p", recipientPubHex]],
  });
  await publishToRelays(socialEvent, relayListEffective);

  return {
    transactionId: paymentResult.transactionId,
    zapReceiptId: zapReceipt.id,
    donationNoteId: socialEvent.id,
    amount,
    recipientNpub,
    recipientName,
  };
}

export async function zapHandler(body) {
  try {
    const { senderNpub, recipientNpub, amount } = body || {};
    const data = await zap({ senderNpub, recipientNpub, amount });
    return { success: true, data };
  } catch (err) {
    const error = mapError(err);
    const status =
      error.code === "INVALID_NPUB" ||
      error.code === "INVALID_AMOUNT" ||
      error.code === "SENDER_WALLET_NOT_FOUND" ||
      error.code === "INSUFFICIENT_BALANCE" ||
      error.code === "NO_LIGHTNING_ADDRESS"
        ? 400
        : 500;
    return { success: false, status, error };
  }
}
