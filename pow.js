import { getEventHash } from "nostr-tools";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { NDKEvent } from "@nostr-dev-kit/ndk";

/**
 * Mine a Nostr event for NIP-13 proof-of-work.
 * @param {NDKEvent} evt - The event to mine (signed).
 * @param {number} difficulty - Required leading zero bits.
 * @returns {Promise<NDKEvent>} - The mined event.
 */
export function mineEventPow(evt, difficulty = 20) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./pow.js", import.meta.url), {
            workerData: { serialised: evt.rawEvent(), difficulty }
        });
        worker.once("message", (mined) => {
            resolve(mined);
        });
        worker.once("error", reject);
    });
}

if (!isMainThread && parentPort) {
    const { serialised, difficulty } = workerData;
    let nonce = 0;
    let mined = { ...serialised };

    function hashMatchesDifficulty(id, bits) {
        const requiredHexZeros = Math.floor(bits / 4);
        if (!id.startsWith("0".repeat(requiredHexZeros))) return false;
        if (bits % 4 === 0) return true;
        const nibble = parseInt(id[requiredHexZeros], 16);
        const remainingBits = bits % 4;
        return (nibble >> (4 - remainingBits)) === 0;
    }

    while (true) {
        mined.tags = [
            ...(serialised.tags || []),
            ["nonce", nonce.toString(), difficulty.toString()]
        ];
        mined.id = getEventHash(mined);
        if (hashMatchesDifficulty(mined.id, difficulty)) break;
        nonce++;
    }

    parentPort.postMessage(mined);
}
