import fetch from "node-fetch";
import { nip19 } from "nostr-tools";
import { connectWithRetry } from "./nostr.service.js";

// Utility to decode a Lightning address (lud16) into lnurlp endpoint
function resolveLightningAddress(lud16) {
  const [username, domain] = (lud16 || "").toLowerCase().split("@");
  if (!username || !domain) {
    throw Object.assign(new Error("Invalid Lightning address format"), {
      code: "LNURL_ERROR",
    });
  }
  const url = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(
    username
  )}`;
  return url;
}

// Minimal LNURL (bech32) decoder: for now, accept full https URLs directly, otherwise error
function decodeLnurlBech32(lud06) {
  // Some profiles publish full https callback; accept those
  if (typeof lud06 === "string" && lud06.startsWith("http")) return lud06;
  // TODO: Add bech32 decoding for lnurl (out of scope without extra deps)
  throw Object.assign(new Error("Unsupported LNURL bech32 format in this build"), {
    code: "LNURL_ERROR",
  });
}

export async function discoverRecipientLnurl(recipientNpub, timeoutMs = 10000) {
  if (!recipientNpub) {
    throw Object.assign(new Error("recipientNpub is required"), {
      code: "INVALID_NPUB",
    });
  }

  const { ndk } = await connectWithRetry();
  const { data: pubHex } = nip19.decode(recipientNpub);

  // Fetch kind 0 metadata
  const events = await ndk.fetchEvents(
    { authors: [pubHex], kinds: [0], limit: 1 },
    { timeoutSec: Math.ceil(timeoutMs / 1000) }
  );
  if (!events || events.size === 0) {
    throw Object.assign(new Error("Recipient profile not found"), {
      code: "RECIPIENT_PROFILE_NOT_FOUND",
    });
  }
  const [profile] = [...events];
  let meta;
  try {
    meta = JSON.parse(profile.content || "{}");
  } catch (_) {
    meta = {};
  }

  const { lud16, lud06, name } = meta || {};
  if (!lud16 && !lud06) {
    throw Object.assign(new Error("Recipient has no Lightning address/LNURL"), {
      code: "NO_LIGHTNING_ADDRESS",
    });
  }

  let endpointUrl;
  let method = "lud16";
  try {
    if (lud16) endpointUrl = resolveLightningAddress(lud16);
    else {
      method = "lud06";
      endpointUrl = decodeLnurlBech32(lud06);
    }
  } catch (err) {
    if (!err.code) err.code = "LNURL_ERROR";
    throw err;
  }

  // Fetch lnurlp metadata
  let resp;
  try {
    resp = await fetch(endpointUrl, { timeout: timeoutMs });
  } catch (err) {
    throw Object.assign(new Error("LNURL service unreachable"), {
      code: "LNURL_ERROR",
      details: err.message,
    });
  }
  if (!resp.ok) {
    throw Object.assign(new Error(`LNURL service error: HTTP ${resp.status}`), {
      code: "LNURL_ERROR",
    });
  }
  const body = await resp.json();
  if (body.status === "ERROR") {
    throw Object.assign(new Error(`LNURL error: ${body.reason || "unknown"}`), {
      code: "LNURL_ERROR",
    });
  }
  const { callback, minSendable, maxSendable, metadata } = body;
  if (!callback || !minSendable || !maxSendable) {
    throw Object.assign(new Error("Invalid LNURL metadata"), {
      code: "LNURL_ERROR",
    });
  }

  return {
    endpoint: endpointUrl,
    callback,
    minSendable,
    maxSendable,
    metadata,
    method,
    recipientName: name || null,
  };
}

export async function requestInvoice(callback, amountSats, comment = "", timeoutMs = 10000) {
  if (!callback) {
    throw Object.assign(new Error("LNURL callback missing"), { code: "LNURL_ERROR" });
  }
  if (!Number.isInteger(amountSats) || amountSats <= 0) {
    throw Object.assign(new Error("Invalid amount"), { code: "LNURL_ERROR" });
  }
  const amountMsat = amountSats * 1000;
  const url = new URL(callback);
  url.searchParams.set("amount", String(amountMsat));
  if (comment) url.searchParams.set("comment", comment);

  let resp;
  try {
    resp = await fetch(url.toString(), { timeout: timeoutMs });
  } catch (err) {
    throw Object.assign(new Error("Invoice generation failed"), {
      code: "INVOICE_GENERATION_FAILED",
      details: err.message,
    });
  }
  if (!resp.ok) {
    throw Object.assign(new Error(`Invoice generation failed: HTTP ${resp.status}`), {
      code: "INVOICE_GENERATION_FAILED",
    });
  }
  const body = await resp.json();
  if (body.status === "ERROR" || !body.pr) {
    throw Object.assign(new Error(`Invoice generation failed: ${body.reason || "unknown"}`), {
      code: "INVOICE_GENERATION_FAILED",
    });
  }
  return { invoice: body.pr, successAction: body.successAction || null }; 
}

