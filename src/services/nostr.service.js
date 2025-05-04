import NDK, { NDKPrivateKeySigner, NDKEvent, NDKKind } from "@nostr-dev-kit/ndk";
import { nip19, nip04 } from "nostr-tools";
import { getAllKeys } from "./identity.service.js";
import { mineEventPow } from "./pow.service.js";

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

    const ndk = new NDK({
        explicitRelayUrls: [
            "wss://nostr.wine",
            "wss://relayable.org",
            "wss://relay.primal.net",
            "wss://nostr.bitcoiner.social",
            "wss://relay.damus.io",
            "wss://nos.lol",
            "wss://relay.snort.social",
            "wss://purplepag.es",
            "wss://relay.nostr.band"
        ],
        initialValidationRatio: 0.2
    });
    ndk.signer = signer;
    await ndk.connect();
    await new Promise((resolve) => {
        const onReady = () => {
            ndk.pool.off("relay:ready", onReady);
            resolve();
        };
        ndk.pool.on("relay:ready", onReady);
    });
    ndk.on("publish:result", ({ relay, ok, reason }) =>
        console.log(relay.url, ok ? "OK" : `failed: ${reason}`)
    );
    console.log("✅ NDK connected");

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
    const rawEvent = powBits > 0
        ? await mineEventPow(event, powBits)
        : event.rawEvent();
    const finalEvent = powBits > 0
        ? new NDKEvent(ndk, rawEvent)
        : event;
    if (powBits > 0) {
        await finalEvent.sign(signer);
    }
    // Publish and return result
    const okRelays = await finalEvent.publish(undefined, timeoutMs);
    return { id: finalEvent.id, relays: [...okRelays].map(r => r.url) };
}
