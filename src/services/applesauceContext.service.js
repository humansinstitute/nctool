import { logger } from "../utils/logger.js";

let context = null;

export async function initApplesauceContext(relays) {
  const relayList = (Array.isArray(relays) && relays.length)
    ? relays.slice()
    : parseRelaysFromEnv();

  try {
    const { RelayPool } = await import("applesauce-relay");
    const { EventStore } = await import("applesauce-core");
    const { createAddressLoader } = await import("applesauce-loaders/loaders");

    const pool = new RelayPool();
    const eventStore = new EventStore();
    const addressLoader = createAddressLoader(pool, {
      eventStore,
      lookupRelays: relayList,
    });
    eventStore.addressableLoader = addressLoader;
    eventStore.replaceableLoader = addressLoader;

    context = { pool, eventStore, addressLoader, relays: relayList };
    logger.info("Applesauce context initialized", { relays: relayList });
    return context;
  } catch (err) {
    logger.error("Failed to initialize Applesauce context", { error: err.message });
    throw err;
  }
}

export function getApplesauceContext() {
  return context;
}

export function parseRelaysFromEnv() {
  const mode = (process.env.NOSTR_RELAY_MODE || "").toLowerCase() || "local";
  const envStr = (mode === "remote" ? process.env.NOSTR_REMOTE_RELAYS : process.env.NOSTR_LOCAL_RELAYS) || "";
  let list = envStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) {
    // As a safety net, include purplepag.es for lookups when no env provided
    list = ["wss://purplepag.es"];
  } else if (!list.includes("wss://purplepag.es")) {
    list.push("wss://purplepag.es");
  }
  return list;
}

