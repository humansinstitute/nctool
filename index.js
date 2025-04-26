import NDK, { NDKEvent, NDKPrivateKeySigner, NDKKind } from "@nostr-dev-kit/ndk";
import { nip19 } from "nostr-tools";
import { mineEventPow } from "./pow.js";
import { loadKeys } from "./identityManager.js";
import readline from 'readline';
import { sendNote } from "./sendNote.js";

async function prompt(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, answer => {
        rl.close();
        resolve(answer);
    }));
}

async function initNDK({ powBits, timeoutMs }) {
    const { nsec, npub } = loadKeys();
    const { data: privhex } = nip19.decode(nsec);
    const signer = new NDKPrivateKeySigner(privhex);
    console.log({ nsec, npub });

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
    await new Promise(resolve => {
        const onReady = () => {
            ndk.pool.off("relay:ready", onReady);
            resolve();
        };
        ndk.pool.on("relay:ready", onReady);
    });
    ndk.on("publish:result", ({ relay, ok, reason }) =>
        console.log(relay.url, ok ? "OK" : `failed: ${reason}`)
    );
    console.log("✅ connected");

    // Relay-specific PoW adjustments
    let relayPowTargets = [];
    for (const relay of ndk.pool.relays) {
        try {
            const infoUrl = relay.url.replace(/^wss:\/\//, 'https://') + '/.well-known/nostr.json';
            const res = await fetch(infoUrl);
            if (!res.ok) continue;
            const info = await res.json();
            if (info.pow && typeof info.pow.difficulty === 'number') {
                relayPowTargets.push(info.pow.difficulty);
            }
        } catch { }
    }
    if (relayPowTargets.length) {
        const maxTarget = Math.max(...relayPowTargets);
        powBits = Math.max(powBits, maxTarget);
        console.log(`Using PoW difficulty ${powBits}`);
    }

    return { ndk, signer, npub };
}

async function main() {
    // Parse CLI args
    let powBits = 20;
    let timeoutMs = 10000;
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--pow" && args[i + 1]) {
            powBits = parseInt(args[++i], 10);
        } else if (args[i] === "--timeout" && args[i + 1]) {
            timeoutMs = parseInt(args[++i], 10);
        }
    }

    const { ndk, signer, npub } = await initNDK({ powBits, timeoutMs });

    while (true) {
        const choice = await prompt(
            "\nChoose an option:\n" +
            "a) Update my profile\n" +
            "b) Publish a kind 1 note\n" +
            "e) Exit\n" +
            "Enter a, b or e: "
        );
        const sel = choice.trim();
        if (sel === "a") {
            // Profile update
            const nameInput = await prompt("Enter profile name: ");
            const aboutInput = await prompt("Enter profile about: ");
            const profileUpdate = {
                name: nameInput,
                about: aboutInput,
                picture: "https://example.com/avatar.png"
            };
            const ev = new NDKEvent(ndk, {
                kind: NDKKind.Metadata,
                content: JSON.stringify(profileUpdate)
            });
            await ev.sign();
            const minedRaw = await mineEventPow(ev, powBits);
            const minedEv = new NDKEvent(ndk, minedRaw);
            await minedEv.sign();
            try {
                const okRelays = await minedEv.publish(undefined, timeoutMs);
                console.log("✅ stored on:", [...okRelays].map(r => r.url));
                console.log(`Verify on explorer: https://nostr.band/tx/${minedEv.id}`);
            } catch (e) {
                console.error("Publish error:", e);
            }
        } else if (sel === "b") {
            // Kind-1 note
            await sendNote({ ndk, signer, npub, powBits, timeoutMs });
        } else if (sel === "e") {
            console.log("Exiting.");
            process.exit(0);
        } else {
            console.log("Invalid selection.");
        }
    }
}

main();
