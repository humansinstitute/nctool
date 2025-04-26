import { NDKEvent, NDKKind } from "@nostr-dev-kit/ndk";
import { nip19 } from "nostr-tools";
import readline from "readline";
import { mineEventPow } from "./pow.js";

async function prompt(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, answer => {
        rl.close();
        resolve(answer);
    }));
}

export async function sendNote({ ndk, signer, npub, powBits, timeoutMs }) {
    const content = await prompt("Enter note content: ");
    const noteEvent = new NDKEvent(ndk, { kind: NDKKind.Text, content });
    await noteEvent.sign();

    const minedRaw = await mineEventPow(noteEvent, powBits);
    const minedEv = new NDKEvent(ndk, minedRaw);
    await minedEv.sign();

    try {
        const okRelays = await minedEv.publish(undefined, timeoutMs);
        console.log("✅ stored on:", [...okRelays].map(r => r.url));
    } catch (e) {
        console.error("Publish error:", e);
    }

    const { data: pubHex } = nip19.decode(npub);
    const filter = {
        authors: [pubHex],
        kinds: [1],
        limit: 10
    };
    const events = await ndk.fetchEvents(filter, { timeoutSec: 5 });
    console.log(`\n📝 Latest 10 notes by ${npub}:\n`);
    [...events]
        .sort((a, b) => b.created_at - a.created_at)
        .forEach((e, i) => {
            console.log(`${i + 1}. ${e.content}\n`);
        });
}
