import NDK, {
  NDKPrivateKeySigner,
  NDKEvent,
  NDKKind,
} from "@nostr-dev-kit/ndk";
// Ensure WebSocket is available in Node for NDK
import WebSocket from "ws";
import dns from "dns";
import { nip19, nip04 } from "nostr-tools";
import { getAllKeys } from "./identity.service.js";
import { mineEventPow } from "./pow.service.js";

// Read and parse relay configurations from environment variables with normalization
const stripQuotes = (s) =>
  typeof s === "string" ? s.replace(/^['"]|['"]$/g, "") : s;
const stripInlineComment = (s) =>
  typeof s === "string" ? s.split("#")[0] : s;
const normalize = (s) => {
  if (typeof s !== "string") return s;
  return stripQuotes(stripInlineComment(s)).trim();
};

const rawMode = process.env.NOSTR_RELAY_MODE;
const nostrRelayMode = (normalize(rawMode) || "local").toLowerCase();

// Define default relay lists in case .env variables are not set
const defaultLocalRelaysString = "ws://127.0.0.1:8021";
const defaultRemoteRelaysString = [
  "wss://nostr.wine",
  "wss://relayable.org",
  "wss://relay.primal.net",
  "wss://nostr.bitcoiner.social",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://purplepag.es",
  "wss://relay.nostr.band",
].join(",");

const localRelaysEnv = normalize(process.env.NOSTR_LOCAL_RELAYS) || defaultLocalRelaysString;
const remoteRelaysEnv = normalize(process.env.NOSTR_REMOTE_RELAYS) || defaultRemoteRelaysString;

// Helper function to parse comma-separated strings into an array of URLs
const parseRelayUrls = (urlsString) => {
  if (!urlsString) return [];
  const deny = new Set([
    "wss://relay.snort.social",
  ]);
  return urlsString
    .split(",")
    .map((url) => normalize(url))
    .filter((url) => url && !deny.has(url)); // Remove any empty strings and denylisted relays
};

const localRelayUrls = parseRelayUrls(localRelaysEnv);
const remoteRelayUrls = parseRelayUrls(remoteRelaysEnv);

// One-time diagnostics to aid debugging env loading issues
console.log("Nostr Service ENV:", {
  rawMode,
  nostrRelayMode,
  localRelaysEnv,
  remoteRelaysEnv,
  localRelayCount: localRelayUrls.length,
  remoteRelayCount: remoteRelayUrls.length,
});

/**
 * Builds a basic Kind 1 Nostr text note event object.
 * @param {string} content - text content of the note
 * @returns {object} Nostr event object
 */
export function buildTextNote(content) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    kind: NDKKind.Text,
    content,
    tags: [],
    created_at: timestamp,
  };
}

const DEFAULT_POW = Number(process.env.POW_BITS) || 0;
const DEFAULT_TIMEOUT = Number(process.env.TIMEOUT_MS) || 5000;

// Connection retry configuration
const RETRY_MAX_ATTEMPTS = parseInt(process.env.RETRY_MAX_ATTEMPTS) || 3;
const RETRY_BASE_DELAY = parseInt(process.env.RETRY_BASE_DELAY) || 1000;
const CONNECTION_WAIT_TIMEOUT = parseInt(process.env.CONNECTION_WAIT_TIMEOUT) || 10000;

// Prefer IPv4 to avoid IPv6 routing issues some networks exhibit
try {
  dns.setDefaultResultOrder && dns.setDefaultResultOrder("ipv4first");
} catch {}

// Attach ws to global if missing to ensure NDK uses it in Node
if (typeof globalThis.WebSocket === "undefined") {
  // ws exports WebSocket as default in ESM; for safety, handle both shapes
  const WS = WebSocket?.WebSocket || WebSocket;
  if (WS) {
    globalThis.WebSocket = WS;
    console.log("Nostr Service: Bound ws.WebSocket to global WebSocket for NDK");
  }
}

/**
 * Connects to Nostr relays with a singleton NDK instance.
 * @returns {Promise<{ ndk: NDK, signer: NDKPrivateKeySigner, npub: string }>}
 */
export async function connect(keyObj) {
  if (!keyObj) {
    const all = await getAllKeys();
    if (!all.length) {
      throw new Error("No keys available; generate keys first");
    }
    keyObj = all[0];
  }
  const { nsec, npub } = keyObj;
  const { data: privhex } = nip19.decode(nsec);
  const signer = new NDKPrivateKeySigner(privhex);

  let selectedRelays;
  if (nostrRelayMode === "remote") {
    selectedRelays = remoteRelayUrls;
    console.log("Nostr Service: Using REMOTE relays:", selectedRelays);
  } else {
    // Default to local if mode is not 'remote' or is explicitly 'local'
    selectedRelays = localRelayUrls;
    console.log("Nostr Service: Using LOCAL relays:", selectedRelays);
  }

  if (!selectedRelays || selectedRelays.length === 0) {
    console.warn(
      `Warning: No relays configured for mode '${nostrRelayMode}'. Please check your .env settings (NOSTR_LOCAL_RELAYS, NOSTR_REMOTE_RELAYS).`
    );
    // Fallback to a minimal default or throw an error if no relays are absolutely critical
    selectedRelays = [];
  }

  const ndk = new NDK({
    explicitRelayUrls: selectedRelays,
    // Lower validation to avoid delays on connect when many relays are slow
    initialValidationRatio: 0.1,
    autoConnectUserRelays: false,
    // Ensure NDK uses Node ws
    websocketImplementation: globalThis.WebSocket,
  });
  ndk.signer = signer;

  console.log(
    `Nostr Service: Attempting to connect to ${selectedRelays.length} relays...`
  );
  try {
    await ndk.connect(Math.max(DEFAULT_TIMEOUT, 8000));

    const relays = Array.from(ndk.pool.relays.values());
    const connectedRelays = relays.filter((r) => r.status === r.constructor.OPEN);
    if (connectedRelays.length > 0) {
      console.log(
        `Nostr Service: Successfully connected to ${connectedRelays.length} relay(s):`,
        connectedRelays.map((r) => r.url)
      );
    } else {
      const statuses = relays.map((r) => ({ url: r.url, status: r.status }));
      console.warn(
        "Nostr Service: No relays are connected after connect(). Statuses:",
        statuses
      );
    }
  } catch (error) {
    console.error("Nostr Service: Error during NDK connect:", error);
    throw new Error(`Failed to connect to Nostr relays: ${error.message}`);
  }

  ndk.on("publish:result", ({ relay, ok, reason }) =>
    console.log(
      `Nostr Service: Publish to ${relay.url} ${
        ok ? "OK" : `failed: ${reason}`
      }`
    )
  );
  console.log("✅ NDK instance configured and signer set.");

  return { ndk, signer, npub };
}

/**
 * Wait for actual WebSocket connections to be established
 * @param {NDK} ndk - NDK instance
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Array>} Array of connected relays
 * @throws {Error} Timeout error if connections not established
 */
export async function waitForConnections(ndk, timeoutMs = CONNECTION_WAIT_TIMEOUT) {
  console.log(`Nostr Service: Waiting for connections with timeout: ${timeoutMs}ms`);
  
  const startTime = Date.now();
  const pollInterval = 100; // Check every 100ms
  
  return new Promise((resolve, reject) => {
    const checkConnections = () => {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= timeoutMs) {
        const errorMsg = `Connection timeout after ${timeoutMs}ms`;
        console.error(`Nostr Service: ${errorMsg}`);
        reject(new Error(errorMsg));
        return;
      }
      
      try {
        const connectedRelays = [];
        
        if (ndk.pool && ndk.pool.relays) {
          for (const [url, relay] of ndk.pool.relays.entries()) {
            // Check if relay is in OPEN state (WebSocket.READY_STATE constants)
            if (relay.status === relay.constructor.OPEN) {
              connectedRelays.push({ url, relay });
            }
          }
        }
        
        console.log(`Nostr Service: Found ${connectedRelays.length} connected relays after ${elapsed}ms`);
        
        if (connectedRelays.length > 0) {
          console.log(`Nostr Service: Successfully verified ${connectedRelays.length} relay connections: ${connectedRelays.map(r => r.url).join(', ')}`);
          resolve(connectedRelays);
        } else {
          // Continue polling
          setTimeout(checkConnections, pollInterval);
        }
      } catch (error) {
        console.error(`Nostr Service: Error checking connections: ${error.message}`);
        reject(error);
      }
    };
    
    // Start checking immediately
    checkConnections();
  });
}

/**
 * Check if NDK has active relay connections
 * @param {NDK} ndk - NDK instance
 * @returns {boolean} True if has active connections
 */
export function isConnected(ndk) {
  if (!ndk || !ndk.pool || !ndk.pool.relays) {
    return false;
  }
  
  for (const [url, relay] of ndk.pool.relays.entries()) {
    if (relay.status === relay.constructor.OPEN) {
      return true;
    }
  }
  
  return false;
}

/**
 * Connect to Nostr network with retry mechanism and connection verification
 * @param {Object} keyObj - Key object with privateKey property
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} retryDelay - Base delay between retries in ms
 * @returns {Promise<Object>} Object containing ndk, signer, and npub
 * @throws {Error} After max retries exhausted
 */
export async function connectWithRetry(keyObj, maxRetries = RETRY_MAX_ATTEMPTS, retryDelay = RETRY_BASE_DELAY) {
  console.log(`Nostr Service: Starting connection with retry - max attempts: ${maxRetries}, base delay: ${retryDelay}ms`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Nostr Service: Connection attempt ${attempt}/${maxRetries}`);
      
      // Use existing connect function
      const result = await connect(keyObj);
      
      // Wait for actual connections to be established
      console.log('Nostr Service: Verifying WebSocket connections are established...');
      const connectedRelays = await waitForConnections(result.ndk, CONNECTION_WAIT_TIMEOUT);
      
      console.log(`Nostr Service: Connection attempt ${attempt} successful with ${connectedRelays.length} active relays`);
      return result;
      
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const currentDelay = retryDelay * (2 ** (attempt - 1)); // Exponential backoff
      
      console.warn(`Nostr Service: Connection attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      
      if (isLastAttempt) {
        const finalError = new Error(`Failed to connect after ${maxRetries} attempts. Last error: ${error.message}`);
        console.error(`Nostr Service: ${finalError.message}`);
        throw finalError;
      }
      
      console.log(`Nostr Service: Retrying in ${currentDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, currentDelay));
    }
  }
}

export async function publishEncryptedEvent(
  senderNpub,
  callNpub,
  responseNpub,
  payloadObject,
  powBits = DEFAULT_POW,
  timeoutMs = DEFAULT_TIMEOUT
) {
  // Find the sender's key object
  const keys = await getAllKeys();
  const senderKeyObj = keys.find((k) => k.npub === senderNpub);
  if (!senderKeyObj) {
    throw new Error(`Unknown sender npub: ${senderNpub}`);
  }
  const { data: senderPrivHex } = nip19.decode(senderKeyObj.nsec);
  // Decode recipient public key hex
  const { data: recipientPubHex } = nip19.decode(callNpub);
  // Encrypt the payload
  const encryptedPayload = await nip04.encrypt(
    senderPrivHex,
    recipientPubHex,
    JSON.stringify(payloadObject)
  );
  // Construct Nostr event content
  const content = JSON.stringify({
    call: callNpub,
    response: responseNpub,
    payload: encryptedPayload,
  });

  // Get retry configuration from environment
  const maxAttempts = parseInt(process.env.RETRY_MAX_ATTEMPTS) || 2;
  const baseDelay = parseInt(process.env.RETRY_BASE_DELAY) || 1000;

  let lastError = null;
  let okRelays = null;
  
  // Retry loop with exponential backoff
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Encrypted event publish attempt ${attempt}/${maxAttempts}`);
      
      // Establish connection with retry logic
      const { ndk, signer } = await connectWithRetry(senderKeyObj);

      // Log relay connection status before publishing
      const connectedRelays = Array.from(ndk.pool.relays.values()).filter(
        (r) => r.status === r.constructor.OPEN
      );
      if (connectedRelays.length === 0) {
        console.warn(
          "Nostr Service: No relays are connected at publish time. Attempting to publish anyway (behavior matches /post/note)."
        );
      }
      console.log(
        `Nostr Service: About to publish encrypted event to ${connectedRelays.length} relay(s):`,
        connectedRelays.map((r) => r.url)
      );
      
      // Prepare tags for relay filtering
      const tags = [["p", recipientPubHex]];
      // Create and sign the event with fresh NDK instance
      const event = new NDKEvent(ndk, { kind: 30078, tags, content });
      await event.sign(signer);
      
      // Apply proof-of-work if required
      const shouldApplyPow = powBits > 0 && nostrRelayMode !== "local";
      const rawEvent = shouldApplyPow
        ? await mineEventPow(event, powBits)
        : event.rawEvent();
      const finalEvent = shouldApplyPow ? new NDKEvent(ndk, rawEvent) : event;
      if (shouldApplyPow) {
        await finalEvent.sign(signer); // Re-sign if POW was applied and event changed
      }
      
      // Publish and return result
      try {
        okRelays = await finalEvent.publish(
          undefined,
          Math.max(timeoutMs, 20000)
        ); // Increase timeout to 20s min
        
        if (!okRelays || okRelays.size === 0) {
          throw new Error("No relays received the encrypted event");
        }
        
        console.log(
          `Nostr Service: Encrypted event published to relays:`,
          [...okRelays].map((r) => r.url)
        );
        return { id: finalEvent.id, relays: [...okRelays].map((r) => r.url) };
        
      } catch (publishError) {
        // If this is the last attempt, throw the error
        if (attempt === maxAttempts) {
          throw publishError;
        }
        
        // Log publish failure and prepare for retry
        console.log(`Encrypted event publish attempt ${attempt} failed: ${publishError.message}`);
        lastError = publishError;
        
        // Wait before retrying with exponential backoff
        const retryDelay = baseDelay * (2 ** (attempt - 1));
        console.log(`Retrying encrypted event publish in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        
        // Continue to next iteration to rebuild event with fresh connection
        continue;
      }
      
    } catch (connectionError) {
      console.log(`Encrypted event publish attempt ${attempt} failed: ${connectionError.message}`);
      lastError = connectionError;
      
      if (attempt === maxAttempts) {
        const finalError = new Error(`Failed to publish encrypted event after ${maxAttempts} attempts. Last error: ${connectionError.message}`);
        console.error(`Nostr Service: ${finalError.message}`);
        throw finalError;
      }
      
      // Wait before retrying with exponential backoff
      const retryDelay = baseDelay * (2 ** (attempt - 1));
      console.log(`Retrying encrypted event publish in ${retryDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  // This should never be reached due to the retry logic, but added as a safety net
  if (!okRelays || okRelays.size === 0) {
    const finalError = new Error(`Failed to publish encrypted event after ${maxAttempts} attempts. Last error: ${lastError?.message || 'Unknown error'}`);
    console.error(`Nostr Service: ${finalError.message}`);
    throw finalError;
  }
}
