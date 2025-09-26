import { nip19, finalizeEvent, kinds, getPublicKey } from "nostr-tools";
import { getAllKeys } from "./identity.service.js";

function parseRelaysFromEnv() {
  const strip = (s) => (typeof s === "string" ? s.replace(/^['"]|['"]$/g, "").split("#")[0].trim() : s);
  const mode = (strip(process.env.NOSTR_RELAY_MODE) || "local").toLowerCase();
  const localRelays = strip(process.env.NOSTR_LOCAL_RELAYS) || "ws://127.0.0.1:8021";
  const remoteRelays =
    strip(process.env.NOSTR_REMOTE_RELAYS) ||
    [
      "wss://nostr.wine",
      "wss://relayable.org",
      "wss://relay.primal.net",
      "wss://nostr.bitcoiner.social",
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://purplepag.es",
      "wss://relay.nostr.band",
    ].join(",");

  const list = (mode === "remote" ? remoteRelays : localRelays)
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  return list;
}

// Applesauce EventFactory signer that uses our local nsec
function getKeysFromNsec(nsec) {
  const { data } = nip19.decode(nsec);
  const skHex = Buffer.from(data).toString("hex");
  const pubHex = getPublicKey(skHex);
  return { skHex, pubHex };
}

async function getSignerForNpub(npub) {
  const keys = await getAllKeys();
  const keyObj = keys.find((k) => k.npub === npub);
  if (!keyObj) throw new Error(`Unknown sender npub: ${npub}`);
  return getKeysFromNsec(keyObj.nsec);
}

export async function buildZapRequest({ senderNpub, recipientPubHex, msats, extraTags = [], relayList = [] }) {
  const { skHex, pubHex } = await getSignerForNpub(senderNpub);
  const tags = [["p", recipientPubHex], ["amount", String(msats)], ...extraTags];
  if (Array.isArray(relayList) && relayList.length) {
    tags.push(["relays", ...relayList]);
  }
  const unsigned = {
    kind: 9734,
    content: "",
    tags,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: pubHex,
  };
  const signed = finalizeEvent(unsigned, skHex);
  return signed;
}

export async function buildZapReceipt({ senderNpub, zapRequest, invoice, preimage, relayList = [], recipientPubHexFallback = null }) {
  const { skHex, pubHex } = await getSignerForNpub(senderNpub);
  // Extract recipient hex from zap request 'p' tag; fall back if needed
  const pFromRequest = zapRequest.tags?.find((t) => t[0] === "p")?.[1];
  const recipientHex = pFromRequest || recipientPubHexFallback || "";
  const targetTags = (zapRequest.tags || []).filter((t) => t[0] === "e" || t[0] === "a");
  const tags = [
    ["p", recipientHex],
    ...targetTags,
    ["bolt11", invoice],
    ["description", JSON.stringify(zapRequest)],
    ["P", zapRequest.pubkey],
  ];
  if (preimage) tags.push(["preimage", preimage]);
  if (relayList.length) tags.push(["relays", ...relayList]);
  const unsigned = {
    kind: kinds.Zap,
    content: "",
    tags,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: pubHex,
  };
  const signed = finalizeEvent(unsigned, skHex);
  return signed;
}

export async function publishToRelays(event, relays) {
  const { RelayPool } = await import("applesauce-relay");
  const pool = new RelayPool();
  const list = relays && relays.length ? relays : parseRelaysFromEnv();
  await pool.publish(list, event);
  return { relays: list };
}

export async function buildTextNoteApplesauce({ senderNpub, content, tags = [] }) {
  const { skHex, pubHex } = await getSignerForNpub(senderNpub);
  const unsigned = {
    kind: 1,
    content: content || "",
    tags: tags || [],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: pubHex,
  };
  const signed = finalizeEvent(unsigned, skHex);
  return signed;
}
