#!/usr/bin/env node
import 'dotenv/config';
import axios from 'axios';
import readline from 'readline';
import { EventSource } from 'eventsource';
import { connect } from './src/services/nostr.service.js';
import { getAllKeys, generateKeyPair, getPrivateKeyByNpub } from './src/services/identity.service.js';
import { nip19, finalizeEvent } from 'nostr-tools';
import { buildTextNote } from './src/services/nostr.service.js';
import { mineEventPow } from './src/services/pow.service.js';
import pkg from 'uuid';
const { v4: uuidv4 } = pkg;

const API_BASE = process.env.API_URL || 'http://localhost:3000';
const IGNORE_OLD_MS = Number(process.env.IGNORE_OLD) || Infinity;

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve =>
    rl.question(question, ans => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function chooseKey() {
  const keys = getAllKeys();
  if (keys.length) {
    console.log('\nSelect a user:');
    keys.forEach((k, i) => {
      console.log(`${i + 1}) ${k.name}`);
    });
    console.log('n) Create new user');
    const choice = await prompt('Enter number or n: ');
    if (choice.toLowerCase() === 'n') {
      const name = await prompt('Enter a name for the new user: ');
      return generateKeyPair(name);
    }
    const idx = parseInt(choice, 10) - 1;
    if (idx >= 0 && idx < keys.length) {
      return keys[idx];
    }
    console.log('Invalid selection, try again.');
    return chooseKey();
  } else {
    console.log('\nNo users found. Creating a new user.');
    const name = await prompt('Enter a name for the new user: ');
    return generateKeyPair(name);
  }
}

async function tailEvents(targetNpub) { // Removed sessionKey as direct param, we get all keys now
  // 1. Get all known npubs
  const npubs = [targetNpub];

  // 2. tell API to spin up (or reuse) the SSE session, providing all npubs
  let sessionId;
  try {
    // Send the array of all npubs to the backend
    const resp = await axios.post(`${API_BASE}/stream/start`, {
      npubs
    });
    sessionId = resp.data.sessionId;
  } catch (err) {
    console.error('Failed to start stream:', err.message);
    return;
  }

  console.log(`\n🕑 Waiting for data from author: ${targetNpub} – press Q to quit\n`);

  // 3. open the stream
  const es = new EventSource(`${API_BASE}/stream/events/${sessionId}`);
  es.onmessage = async ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'decryptedAction') {
        const { payload: outer, senderNpub, responseNpub, timestamp } = msg.data;
        if (timestamp === undefined) {
          console.log('Message is ignored - no timestamp');
          return;
        }
        const ageMs = Date.now() - timestamp * 1000;
        if (ageMs > IGNORE_OLD_MS) {
          console.log('Message not signed as it is out of date');
          return;
        }
        const inner = outer.payload;
        if (inner.action === 'sign') {
          console.log(`🆕 Sign request from ${senderNpub}:`, inner);
          try {
            const nsec = getPrivateKeyByNpub(inner.signerNPub);
            const { data: privKeyHex } = nip19.decode(nsec);
            const unsignedEvent = JSON.parse(inner.event);
            const signedEvent = finalizeEvent(unsignedEvent, privKeyHex);
            const newCallID = uuidv4();
            const timestamp = Math.floor(Date.now() / 1000);
            const nostrMqResponse = {
              callID: newCallID,
              threadID: outer.threadID,
              timestamp,
              payload: {
                action: 'signed',
                signerNPub: inner.signerNPub,
                signedEvent: JSON.stringify(signedEvent)
              }
            };
            await axios.post(`${API_BASE}/action/encrypted`, {
              senderNpub: inner.signerNPub,
              callNpub: responseNpub,
              responseNpub: inner.signerNPub,
              payload: nostrMqResponse,
              powBits: Number(process.env.POW_BITS) || 20,
              timeoutMs: Number(process.env.TIMEOUT_MS) || 10000
            });
            console.log('Signed event sent back to', responseNpub);
          } catch (signErr) {
            console.error('Error signing event:', signErr.message);
          }
        } else if (inner.action === 'signed') {
          console.log(`🆕 Signed event received from ${senderNpub}:`, inner);
          try {
            const eventToBroadcast = JSON.parse(inner.signedEvent);
            await axios.post(`${API_BASE}/post/broadcast`, { event: eventToBroadcast });
            console.log('Broadcasted signed event');
          } catch (broadcastErr) {
            console.error('Error broadcasting signed event:', broadcastErr.message);
          }
        } else {
          console.log(`🆕 Decrypted payload from ${senderNpub}:`, inner);
        }
      } else {
        console.log('🆕 Raw message:', msg);
      }
    } catch (parseError) {
      console.log('🆕 Raw:', ev.data);
    }
  };
  es.onerror = err => console.error('Stream error:', err);

  // 4. capture a single keypress
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume(); // Resume stdin so keypress events are emitted

  await new Promise((resolve, reject) => { // Added reject for potential errors
    const cleanupAndExit = (exitCode = 0, message = '\n⏹  Subscription stopped.\n') => {
      try {
        es.close(); // Close EventSource connection
        axios.delete(`${API_BASE}/stream/stop/${sessionId}`).catch(err => console.error("Error stopping backend stream:", err.message)); // Tell backend to stop
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false); // Turn off raw mode IMPORTANT: Check if TTY first
          process.stdin.pause(); // Pause stdin to restore normal mode
        }
        process.stdin.off('keypress', onKey); // Remove the listener
        console.log(message);
        if (exitCode !== null) { // Allow resolving without exiting if needed
          process.exit(exitCode); // Exit the process for Ctrl+C
        } else {
          resolve(); // Resolve promise for 'q'
        }
      } catch (cleanupError) {
        console.error("Error during cleanup:", cleanupError);
        process.exit(1); // Exit with error if cleanup fails
      }
    };

    const onKey = (_, key) => {
      // Handle 'q' or 'Q'
      if (key && (key.name === 'q' || key.name === 'Q')) {
        cleanupAndExit(null); // Resolve promise, don't force exit code
      }
      // Handle Ctrl+C
      else if (key && key.ctrl && key.name === 'c') {
        cleanupAndExit(0, '\n⏹  Subscription stopped (Ctrl+C).\n'); // Exit with code 0
      }
      // Handle Ctrl+D (often EOF)
      else if (key && key.ctrl && key.name === 'd') {
        cleanupAndExit(0, '\n⏹  Subscription stopped (Ctrl+D).\n'); // Exit with code 0
      }
    };

    process.stdin.on('keypress', onKey);

    // Also handle potential errors on stdin
    process.stdin.on('error', (err) => {
      console.error("Stdin error:", err);
      cleanupAndExit(1, '\n⏹  Subscription stopped due to input error.\n');
    });

    // Handle case where stdin closes unexpectedly
    process.stdin.on('close', () => {
      // Check if EventSource is still open before trying to close
      if (es && es.readyState !== EventSource.CLOSED) {
        cleanupAndExit(0, '\n⏹  Subscription stopped (input closed).\n');
      } else {
        resolve(); // Already closing/closed
      }
    });
  });
}

async function main() {
  const sessionKey = await chooseKey();

  while (true) {
    console.log(`\nHello ${sessionKey.name}, what would you like to do?`);
    console.log('a) Update profile');
    console.log('b) Create a post');
    console.log('c) View last 10 posts');
    console.log('d) Publish action');
    console.log('5) Subscribe for Data Input');
    console.log('f) Sign event remotely');
    console.log('e) Exit');

    const choice = await prompt('Enter a, b, c, d, 5 or e: ');

    try {
      if (choice === 'a') {
        const name = await prompt('Name: ');
        const about = await prompt('About: ');
        const picture = await prompt('Picture URL (optional): ');
        const body = { name, about };
        if (picture) body.picture = picture;
        const resp = await axios.post(`${API_BASE}/profile/update`, { ...body, npub: sessionKey.npub });
        console.log('Updated profile:', resp.data);
        const viewResp = await axios.get(`${API_BASE}/post/view10`, { params: { npub: sessionKey.npub } });
        console.log('\nLatest 10 events:');
        viewResp.data.forEach((p, i) => {
          console.log(`${i + 1}. [${p.kind}] ${p.content} (id: ${p.id}, created_at: ${p.created_at})`);
        });
      } else if (choice === 'b') {
        const content = await prompt('Post content: ');
        const { ndk, signer, npub } = await connect(sessionKey);
        const powBits = Number(process.env.POW_BITS) || 20;
        const timeoutMs = Number(process.env.TIMEOUT_MS) || 10000;
        const resp = await axios.post(`${API_BASE}/post/note`, {
          npub,
          content,
          powBits,
          timeoutMs
        });
        console.log('Created note:', resp.data);
        const viewResp = await axios.get(`${API_BASE}/post/view10`, { params: { npub: sessionKey.npub } });
        console.log('\nLatest 10 events:');
        viewResp.data.forEach((p, i) => {
          console.log(`${i + 1}. [${p.kind}] ${p.content} (id: ${p.id}, created_at: ${p.created_at})`);
        });
      } else if (choice === 'c') {
        const kindInput = await prompt('Kind filter (default 1): ');
        let kind = 1;
        if (kindInput !== '') {
          const parsedKind = parseInt(kindInput, 10);
          if (!isNaN(parsedKind)) {
            kind = parsedKind;
          }
        }
        const resp = await axios.get(`${API_BASE}/post/view10`, { params: { kind, npub: sessionKey.npub } });
        console.log(`\nLatest 10 posts (kind=${kind}):`);
        resp.data.forEach(async (p, i) => {
          console.log(`${i + 1}. [${p.created_at}] ${p.content} (id: ${p.id})`);
          if (p.kind === 30078) {
            try {
              const payload = JSON.parse(p.content);
              await axios.post(`${API_BASE}/action/take`, payload);
            } catch (err) {
              console.error('Action endpoint error:', err.message);
            }
          }
        });
      } else if (choice === 'd') {
        // Encrypted action publishing via API
        const callNpub = await prompt('Call NPub (target): ');
        const responseNpubInput = await prompt(`Response NPub (default ${sessionKey.npub}): `);
        const responseNpub = responseNpubInput || sessionKey.npub;
        const input = await prompt('Enter JSON payload or leave blank for default: ');
        const defaultPayload = {
          cmd: 'pay',
          target: callNpub,
          amount: '21000'
        };
        let payload;
        if (!input) {
          payload = defaultPayload;
        } else {
          try {
            payload = JSON.parse(input);
          } catch {
            console.error('Invalid JSON. Aborting.');
            continue;
          }
        }
        const powBits = Number(process.env.POW_BITS) || 20;
        const timeoutMs = Number(process.env.TIMEOUT_MS) || 10000;
        const actionResp = await axios.post(`${API_BASE}/action/encrypted`, {
          senderNpub: sessionKey.npub,
          callNpub,
          responseNpub,
          payload,
          powBits,
          timeoutMs
        });
        console.log('Encrypted action published:', actionResp.data);
      } else if (choice === 'f') {
        // Remote sign request via API
        const callNpubInput = await prompt('Call NPub (target, default npub1z54lfwx2v7vek7z79mkurm8nyrgjpmeanngx9m2fnc7qf53kv3sqjw8ex5): ');
        const callNpub = callNpubInput || 'npub1z54lfwx2v7vek7z79mkurm8nyrgjpmeanngx9m2fnc7qf53kv3sqjw8ex5';
        const responseNpubInput = await prompt(`Response NPub (default ${sessionKey.npub}): `);
        const responseNpub = responseNpubInput || sessionKey.npub;
        const signerNpubInput = await prompt('Signer NPub (default npub1py2a9kmpqjj45wapuw4gpwjjkt83ymr05grjh0xuwkgdtyrjzxdq8lpcdp): ');
        const signerNpub = signerNpubInput || 'npub1py2a9kmpqjj45wapuw4gpwjjkt83ymr05grjh0xuwkgdtyrjzxdq8lpcdp';
        const noteContent = await prompt('Enter note content: ');
        try {
          const remoteResp = await axios.post(`${API_BASE}/post/note_remote`, {
            senderNpub: sessionKey.npub,
            callNpub,
            responseNpub,
            signerNpub,
            noteContent
          });
          console.log('Remote sign request sent:', remoteResp.data);
        } catch (err) {
          if (err.response) {
            console.error('API error:', err.response.data);
          } else {
            console.error('Error:', err.message);
          }
        }
      } else if (choice === '5') {
        // Subscribe only to events for this user's npub
        await tailEvents(sessionKey.npub);
        continue;
      } else if (choice === 'e') {
        console.log('Exiting.');
        process.exit(0);
      } else {
        console.log('Invalid selection.');
      }
    } catch (err) {
      if (err.response) {
        console.error('API error:', err.response.data);
      } else {
        console.error('Error:', err.message);
      }
    }
  }
}

main();
