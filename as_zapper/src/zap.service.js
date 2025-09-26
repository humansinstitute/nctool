import fetch from "node-fetch";
import { nip19, getPublicKey, finalizeEvent, kinds } from "nostr-tools";
import { RelayPool } from "applesauce-relay";
import { EventStore } from "applesauce-core";
import { createAddressLoader } from "applesauce-loaders/loaders";

function parseRelays() {
  const env = (process.env.RELAYS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (env.length) return env;
  // Fallback to main project env if available
  const mode = (process.env.NOSTR_RELAY_MODE || "local").toLowerCase();
  const local = (process.env.NOSTR_LOCAL_RELAYS || "ws://127.0.0.1:8021").split(",").map((s)=>s.trim()).filter(Boolean);
  const remote = (process.env.NOSTR_REMOTE_RELAYS || "").split(",").map((s)=>s.trim()).filter(Boolean);
  return mode === "remote" ? (remote.length ? remote : local) : local;
}

function ensureEnv() {
  const senderNpub = process.env.SENDER_NPUB;
  const skHex = process.env.PRIVKEYHEX;
  if (!senderNpub) throw new Error("SENDER_NPUB missing in env");
  if (!skHex) throw new Error("PRIVKEYHEX missing in env");
  const pubHex = getPublicKey(skHex);
  const encoded = nip19.npubEncode(pubHex);
  if (encoded !== senderNpub) {
    console.warn("Warning: PRIVKEYHEX does not match SENDER_NPUB. Using PRIVKEYHEX for signing.");
  }
  return { skHex, pubHex, senderNpub };
}

export async function discoverLnurl(recipientNpub) {
  const { data: pubHex } = nip19.decode(recipientNpub);
  const timeoutMs = parseInt(process.env.ZAP_PROFILE_TIMEOUT_MS || "5000", 10);

  // Initialize shared applesauce context lazily
  if (!globalThis.__as_ctx) {
    const relays = parseRelays();
    const pool = new RelayPool();
    const eventStore = new EventStore();
    const addressLoader = createAddressLoader(pool, { eventStore, lookupRelays: relays });
    eventStore.addressableLoader = addressLoader;
    eventStore.replaceableLoader = addressLoader;
    globalThis.__as_ctx = { pool, eventStore, relays };
  }
  const { eventStore, relays } = globalThis.__as_ctx;

  // Try to load profile and extract lud16
  const profileObs = eventStore.profile({ pubkey: pubHex });
  let profile = profileObs.getValue?.() || undefined;
  if (!profile) {
    await new Promise((resolve) => {
      const to = setTimeout(() => {
        try { sub?.unsubscribe?.(); } catch {}
        resolve();
      }, timeoutMs);
      const sub = profileObs.subscribe({
        next: () => {
          profile = profileObs.getValue?.() || undefined;
          if (profile) {
            clearTimeout(to);
            try { sub.unsubscribe?.(); } catch {}
            resolve();
          }
        },
        error: () => { clearTimeout(to); try { sub.unsubscribe?.(); } catch {}; resolve(); },
        complete: () => { clearTimeout(to); try { sub.unsubscribe?.(); } catch {}; resolve(); },
      });
    });
  }

  const lud16 = profile?.lud16 && /.+@.+\..+/.test(profile.lud16) ? String(profile.lud16).trim() : null;
  if (!lud16) {
    const e = new Error("Recipient has no Lightning address (lud16)");
    e.code = "NO_LIGHTNING_ADDRESS";
    throw e;
  }

  // Fetch lnurlp metadata
  const { endpoint, meta } = await getLnurlpMeta(lud16);
  return { lud16, endpoint, callback: meta.callback, meta, relays };
}

export async function getLnurlpMeta(lightningAddress) {
  const [name, domain] = String(lightningAddress).trim().split("@");
  if (!name || !domain) throw new Error("Invalid lightning address");
  const endpoint = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`LNURLp fetch failed: ${res.status}`);
  const meta = await res.json();
  if (meta.status === "ERROR") throw new Error(meta.reason || "LNURL error");
  return { endpoint, meta };
}

export function buildZapRequest({ recipientNpub, msats, extraTags = [] }) {
  const { skHex, pubHex } = ensureEnv();
  const { data: recipientPubHex } = nip19.decode(recipientNpub);
  const unsigned = {
    kind: 9734,
    content: "",
    tags: [["p", recipientPubHex], ["amount", String(msats)], ...extraTags],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: pubHex,
  };
  return finalizeEvent(unsigned, skHex);
}

export function buildZapReceipt({ zapRequest, invoice, preimage, relays = [] }) {
  const { skHex, pubHex } = ensureEnv();
  const tags = [
    ["p", zapRequest.pubkey],
    ...zapRequest.tags.filter((t) => t[0] === "e" || t[0] === "a"),
    ["bolt11", invoice],
    ["description", JSON.stringify(zapRequest)],
  ];
  if (preimage) tags.push(["preimage", preimage]);
  if (relays.length) tags.push(["relays", ...relays]);
  const unsigned = {
    kind: kinds.Zap,
    content: "",
    tags,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: pubHex,
  };
  return finalizeEvent(unsigned, skHex);
}

export async function requestInvoice(callback, msats, zapRequest) {
  const url = new URL(callback);
  url.searchParams.set("amount", String(msats));
  if (zapRequest) url.searchParams.set("nostr", JSON.stringify(zapRequest));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Invoice request failed: ${res.status}`);
  const j = await res.json();
  if (j.status === "ERROR" || !j.pr) throw new Error(j.reason || "No invoice returned");
  return j.pr;
}

export async function payInvoice(invoice) {
  const tools = process.env.TOOLS_SERVER_URL || "http://127.0.0.1:3041";
  const sender = process.env.SENDER_NPUB;
  const url = `${tools.replace(/\/$/, "")}/api/wallet/${encodeURIComponent(sender)}/melt`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invoice }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Melt failed: HTTP ${res.status} ${t}`);
  }
  const j = await res.json().catch(() => ({}));
  return j;
}

export async function publish(event, relays) {
  const pool = new RelayPool();
  const list = relays && relays.length ? relays : parseRelays();
  await pool.publish(list, event);
  return list;
}
