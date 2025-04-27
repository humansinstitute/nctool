#!/usr/bin/env node
import { generateKeyPair } from '../services/identity.service.js';
import { connect } from '../services/nostr.service.js';
import { mineEventPow } from '../services/pow.service.js';
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk';
import { sendNote } from '../../sendNote.js';
import readline from 'readline';

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
        const profileData = { name, about, ...(pictureInput.trim() ? { picture: pictureInput.trim() } : {}) };

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
        const powBits = Number(process.env.POW_BITS) || 20;
        const timeout = Number(process.env.TIMEOUT_MS) || 10000;

        await sendNote({ ndk, signer, npub, powBits, timeoutMs: timeout });

    } else {
        console.log('CLI commands: generateKey, updateProfile, createPost');
    }
}

main();
