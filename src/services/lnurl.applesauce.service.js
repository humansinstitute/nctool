// Optional Applesauce-based LNURL discovery and invoice request
// This provides a fallback when NDK is not desired.
import fetch from "node-fetch";
import { nip19 } from "nostr-tools";
import { logger } from "../utils/logger.js";
import { getApplesauceContext, initApplesauceContext } from "./applesauceContext.service.js";

export async function discoverWithApplesauce(recipientNpub, { relays } = {}) {
  // Ensure shared Applesauce context is initialized
  let helpers;
  try {
    helpers = await import("applesauce-core/helpers");
  } catch (err) {
    const e = new Error("Applesauce libraries not installed");
    e.code = "LNURL_ERROR";
    e.details = err.message;
    throw e;
  }

  // Resolve relay list similar to the reference.
  // If explicit relays provided, use them exactly (no implicit additions).
  let relayList = Array.isArray(relays) && relays.length ? relays.slice() : null;
  // Initialize or reuse context
  let ctx = getApplesauceContext();
  if (!ctx || (relayList && JSON.stringify(ctx.relays) !== JSON.stringify(relayList))) {
    ctx = await initApplesauceContext(relayList || undefined);
  }
  relayList = ctx.relays;

  const { data: pubHex } = nip19.decode(recipientNpub);
  logger.info("Applesauce profile discovery starting", { recipientNpub, relayList });
  const { eventStore } = ctx;

  // Subscribe and wait up to configured timeout for profile to populate
  const timeoutMs = parseInt(process.env.ZAP_PROFILE_TIMEOUT_MS || "5000", 10);
  const profileObs = eventStore.profile({ pubkey: pubHex });
  let profile = profileObs.getValue?.() || undefined;

  if (!profile) {
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try { sub?.unsubscribe?.(); } catch {}
        resolve();
      }, timeoutMs);
      const sub = profileObs.subscribe({
        next: () => {
          profile = profileObs.getValue?.() || undefined;
          if (profile) {
            clearTimeout(timeout);
            try { sub.unsubscribe?.(); } catch {}
            resolve();
          }
        },
        error: () => {
          clearTimeout(timeout);
          try { sub.unsubscribe?.(); } catch {}
          resolve();
        },
        complete: () => {
          clearTimeout(timeout);
          try { sub.unsubscribe?.(); } catch {}
          resolve();
        },
      });
    });
  }
  const lud16 = profile?.lud16;
  logger.info("Applesauce profile discovery result", { hasProfile: !!profile, lud16 });
  const name = helpers?.getDisplayName?.(profile, pubHex) || null;
  if (!lud16) {
    const e = new Error("Recipient has no Lightning address (lud16)");
    e.code = "NO_LIGHTNING_ADDRESS";
    throw e;
  }
  const m = String(lud16).trim().match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  if (!m) {
    const e = new Error("Invalid lud16 format on profile");
    e.code = "LNURL_ERROR";
    throw e;
  }
  const username = m[1];
  const domain = m[2];
  const endpoint = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(username)}`;

  const resp = await fetch(endpoint);
  if (!resp.ok) {
    const e = new Error(`LNURL service error: HTTP ${resp.status}`);
    e.code = "LNURL_ERROR";
    throw e;
  }
  const meta = await resp.json();
  if (meta.status === "ERROR") {
    const e = new Error(`LNURL error: ${meta.reason || "unknown"}`);
    e.code = "LNURL_ERROR";
    throw e;
  }

  return {
    endpoint,
    callback: meta.callback,
    minSendable: meta.minSendable,
    maxSendable: meta.maxSendable,
    metadata: meta.metadata,
    method: "lud16",
    recipientName: name,
  };
}

export async function requestInvoiceWithZap(callback, msats, zapRequest) {
  const url = new URL(callback);
  url.searchParams.set("amount", String(msats));
  if (zapRequest) url.searchParams.set("nostr", JSON.stringify(zapRequest));
  const res = await fetch(url.toString());
  if (!res.ok) {
    const e = new Error(`Invoice request failed: HTTP ${res.status}`);
    e.code = "INVOICE_GENERATION_FAILED";
    throw e;
  }
  const json = await res.json();
  if (json.status === "ERROR" || !json.pr) {
    const e = new Error(json.reason || "Invoice generation failed");
    e.code = "INVOICE_GENERATION_FAILED";
    throw e;
  }
  return { invoice: json.pr };
}
