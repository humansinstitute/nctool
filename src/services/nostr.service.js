import NDK, { NDKPrivateKeySigner, NDKEvent, NDKKind } from "@nostr-dev-kit/ndk";
import { nip19, nip04 } from "nostr-tools";
import { getAllKeys } from "./identity.service.js";
import { mineEventPow } from "./pow.service.js";

// Read and parse relay configurations from environment variables
const nostrRelayMode = process.env.NOSTR_RELAY_MODE || 'local'; // Default to 'local'

// Define default relay lists in case .env variables are not set
const defaultLocalRelaysString = "ws://127.0.0.1:8021";
const defaultRemoteRelaysString = [
    "wss://nostr.wine", "wss://relayable.org", "wss://relay.primal.net",
    "wss://nostr.bitcoiner.social", "wss://relay.damus.io", "wss://nos.lol",
    "wss://relay.snort.social", "wss://purplepag.es", "wss://relay.nostr.band"
].join(',');

const localRelaysEnv = process.env.NOSTR_LOCAL_RELAYS || defaultLocalRelaysString;
const remoteRelaysEnv = process.env.NOSTR_REMOTE_RELAYS || defaultRemoteRelaysString;

// Helper function to parse comma-separated strings into an array of URLs
const parseRelayUrls = (urlsString) => {
    if (!urlsString) return [];
    return urlsString.split(',')
        .map(url => url.trim())
        .filter(url => url); // Remove any empty strings
}

const localRelayUrls = parseRelayUrls(localRelaysEnv);
const remoteRelayUrls = parseRelayUrls(remoteRelaysEnv);

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
        created_at: timestamp
    };
}

const DEFAULT_POW = Number(process.env.POW_BITS) || 0;
const DEFAULT_TIMEOUT = Number(process.env.TIMEOUT_MS) || 5000;


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
    if (nostrRelayMode === 'remote') {
        selectedRelays = remoteRelayUrls;
        console.log("Nostr Service: Using REMOTE relays:", selectedRelays);
    } else { // Default to local if mode is not 'remote' or is explicitly 'local'
        selectedRelays = localRelayUrls;
        console.log("Nostr Service: Using LOCAL relays:", selectedRelays);
    }

    if (!selectedRelays || selectedRelays.length === 0) {
        console.warn(`Warning: No relays configured for mode '${nostrRelayMode}'. Please check your .env settings (NOSTR_LOCAL_RELAYS, NOSTR_REMOTE_RELAYS).`);
        // Fallback to a minimal default or throw an error if no relays are absolutely critical
        selectedRelays = [];
    }

    const ndk = new NDK({
        explicitRelayUrls: selectedRelays,
        initialValidationRatio: 0.2 // Or your preferred setting
    });
    ndk.signer = signer;

    console.log(`Nostr Service: Attempting to connect to ${selectedRelays.length} relays...`);
    try {
        await ndk.connect(DEFAULT_TIMEOUT); // Using DEFAULT_TIMEOUT

        const connectedRelays = Array.from(ndk.pool.relays.values()).filter(r => r.status === r.constructor.OPEN);
        if (connectedRelays.length > 0) {
            console.log(`Nostr Service: Successfully connected to ${connectedRelays.length} relay(s):`, connectedRelays.map(r => r.url));
        } else {
            console.warn("Nostr Service: Failed to connect to any relays. Check relay URLs, network connectivity, and .env settings.");
        }
    } catch (error) {
        console.error("Nostr Service: Error during NDK connect:", error);
        throw new Error(`Failed to connect to Nostr relays: ${error.message}`);
    }

    ndk.on("publish:result", ({ relay, ok, reason }) =>
        console.log(`Nostr Service: Publish to ${relay.url} ${ok ? "OK" : `failed: ${reason}`}`)
    );
    console.log("✅ NDK instance configured and signer set.");

    return { ndk, signer, npub };
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
    const senderKeyObj = keys.find(k => k.npub === senderNpub);
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
        payload: encryptedPayload
    });
    // Establish connection and signer
    const { ndk, signer } = await connect(senderKeyObj);
    // Prepare tags for relay filtering
    const tags = [['p', recipientPubHex]];
    // Create and sign the event
    const event = new NDKEvent(ndk, { kind: 30078, tags, content });
    await event.sign(signer);
    // Apply proof-of-work if required
    const shouldApplyPow = powBits > 0 && nostrRelayMode !== 'local';
    const rawEvent = shouldApplyPow
        ? await mineEventPow(event, powBits)
        : event.rawEvent();
    const finalEvent = shouldApplyPow
        ? new NDKEvent(ndk, rawEvent)
        : event;
    if (shouldApplyPow) {
        await finalEvent.sign(signer); // Re-sign if POW was applied and event changed
    }
    // Publish and return result
    const okRelays = await finalEvent.publish(undefined, timeoutMs);
    return { id: finalEvent.id, relays: [...okRelays].map(r => r.url) };
}
