import NDK, { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { nip19 } from "nostr-tools";
import { getKeys } from "./identity.service.js";

let connection = null;

/**
 * Connects to Nostr relays with a singleton NDK instance.
 * @returns {Promise<{ ndk: NDK, signer: NDKPrivateKeySigner, npub: string }>}
 */
export async function connect() {
    if (connection) {
        return connection;
    }

    const keys = getKeys();
    if (!keys) {
        throw new Error("Keys not found; generate keys first via /id/generateKey");
    }

    const { nsec, npub } = keys;
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

    connection = { ndk, signer, npub };
    return connection;
}
