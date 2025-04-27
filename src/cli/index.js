#!/usr/bin/env node
import { generateKeyPair } from '../services/identity.service.js';
import { connect } from '../services/nostr.service.js';
import axios from 'axios';
import readline from 'readline';
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk';
import axios from 'axios';
import { mineEventPow } from '../services/pow.service.js';
import { nip19 } from 'nostr-tools';

async function prompt(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, answer => {
        rl.close();
        resolve(answer);
    }));
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (command === 'generateKey') {
        const keys = generateKeyPair();
        console.log(keys);

    } else if (command === 'updateProfile') {
        const name = await prompt('Enter profile name: ');
        const about = await prompt('Enter profile about: ');
        const pictureInput = await prompt('Enter picture URL (optional): ');
        const profileData = {
            name,
            about,
            ...(pictureInput.trim() ? { picture: pictureInput.trim() } : {})
        };

        const { ndk } = await connect();
        const evt = new NDKEvent(ndk, {
            kind: NDKKind.Metadata,
            content: JSON.stringify(profileData)
        });
        await evt.sign();

        const powBits = Number(process.env.POW_BITS) || 20;
        const timeout = Number(process.env.TIMEOUT_MS) || 10000;
        const minedRaw = await mineEventPow(evt, powBits);
        const minedEvt = new NDKEvent(ndk, minedRaw);
        await minedEvt.sign();
        const okRelays = await minedEvt.publish(undefined, timeout);

        console.log('Profile updated. Event ID:', minedEvt.id);
        console.log('Stored on:', [...okRelays].map(r => r.url));

    } else if (command === 'createPost') {
        const { ndk, signer, npub } = await connect();
        const content = await prompt('Post content: ');
        const powBits = Number(process.env.POW_BITS) || 20;
        const timeoutMs = Number(process.env.TIMEOUT_MS) || 10000;

        const resp = await axios.post(`${API_BASE}/post/note`, {
            npub,
            content,
            powBits,
            timeoutMs
        });
        console.log('Created post:', resp.data);

    } else if (command === 'd') {
        // Publish action via sendAction
        const input = await prompt(
            'Enter JSON payload (default pay command): '
        );
        const defaultPayload = {
            cmd: 'pay',
            target: 'npub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy',
            amount: '21000'
        };
        let payload;
        if (!input.trim()) {
            payload = defaultPayload;
        } else {
            try {
                payload = JSON.parse(input);
            } catch {
                console.error('Invalid JSON. Aborting.');
                return;
            }
        }

        const { ndk, signer, npub } = await connect();
        const powBits2 = Number(process.env.POW_BITS) || 20;
        const timeout2 = Number(process.env.TIMEOUT_MS) || 10000;
        await sendAction({
            ndk,
            signer,
            powBits: powBits2,
            timeoutMs: timeout2,
            dTag: 'avalon:task:10002929',
            payload
        });

        // Fetch last 10 events of kinds [0,1,30078]
        const { data: pubHex } = nip19.decode(npub);
        const filter = {
            authors: [pubHex],
            kinds: [0, 1, 30078],
            limit: 10
        };
        const events = await ndk.fetchEvents(filter, { timeoutSec: 5 });
        console.log(`\n📝 Latest 10 events by ${npub} (kinds 0,1,30078):\n`);
        [...events]
            .sort((a, b) => b.created_at - a.created_at)
            .forEach((e, i) => {
                console.log(
                    `${i + 1}. [${e.kind}] ${e.content} (id: ${e.id}, created_at: ${e.created_at})\n`
                );
            });

    } else {
        console.log('CLI commands: generateKey, updateProfile, createPost, d');
    }
}

main();
