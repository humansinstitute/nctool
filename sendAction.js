// sendAction.js  – v1.1
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { mineEventPow } from "./pow.js";

/**
 * Publish a kind-30078 “action” event.
 *
 * @param {object} opts
 * @param {NDK}     opts.ndk       – Connected NDK instance
 * @param {Signer}  opts.signer    – NDK signer (private key or extension)
 * @param {number}  opts.powBits   – Optional PoW difficulty (NIP-13)
 * @param {number}  opts.timeoutMs – Publish timeout
 * @param {string}  opts.dTag      – e.g. "avalon:task:10002929"
 * @param {object}  opts.payload   – JS object to be serialized into content
 */
export async function sendAction({
    ndk,
    signer,
    powBits = 0,
    timeoutMs = 5000,
    dTag,
    payload
}) {
    if (!dTag) throw new Error("dTag is required");
    if (!payload) throw new Error("payload is required");

    // 1. Build the unsigned event
    const baseEvent = new NDKEvent(ndk, {
        kind: 30078,
        tags: [["d", dTag]],
        content: JSON.stringify(payload)
    });
    // Sign initial event so PoW can serialize
    await baseEvent.sign(signer);

    // 2. Optional PoW mining – safe after initial sign
    const minedRaw = powBits > 0
        ? await mineEventPow(baseEvent, powBits)
        : baseEvent.rawEvent();
    const finalEv = powBits > 0
        ? new NDKEvent(ndk, minedRaw)
        : baseEvent;

    // 3. Re-sign after PoW so signature matches new id/nonce
    if (powBits > 0) await finalEv.sign(signer);

    // 4. Publish
    try {
        const okRelays = await finalEv.publish(undefined, timeoutMs);
        console.log(`✅ Action ${finalEv.id} stored on ${okRelays.size} relays`);
    } catch (err) {
        console.error("Publish error:", err);
    }
}
