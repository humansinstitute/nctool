#!/usr/bin/env node
import 'dotenv/config';
import axios from 'axios';
import readline from 'readline';
import { EventSource } from 'eventsource';
import { connect } from './src/services/nostr.service.js';
import { getAllKeys, generateKeyPair, getPrivateKeyByNpub } from './src/services/identity.service.js';
import { nip19, finalizeEvent } from 'nostr-tools';
import connectDB from './src/config/db.js';
import { buildTextNote } from './src/services/nostr.service.js';
import { mineEventPow } from './src/services/pow.service.js';
import pkg from 'uuid';
import logUpdate from 'log-update';
const { v4: uuidv4 } = pkg;

const API_BASE = process.env.API_URL || 'http://localhost:3000';
const IGNORE_OLD_MS = Number(process.env.IGNORE_OLD) || Infinity;

// Buffer and renderer for streaming messages
let logBuffer = [];
function output(line) {
  logBuffer.push(line);
  logUpdate(logBuffer.join('\n'));
}

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
  const keys = await getAllKeys();
  if (keys.length) {
    console.log('\nSelect a user:');
    keys.forEach((k, i) => console.log(`${i + 1}) ${k.name}`));
    console.log('n) Create new user');
    const choice = await prompt('Enter number or n: ');
    if (choice.toLowerCase() === 'n') {
      const name = await prompt('Enter a name for the new user: ');
      return generateKeyPair(name, '61487097701@c.us');
    }
    const idx = parseInt(choice, 10) - 1;
    if (idx >= 0 && idx < keys.length) return keys[idx];
    console.log('Invalid selection, try again.');
    return chooseKey();
  }
  console.log('\nNo users found. Creating a new user.');
  const name = await prompt('Enter a name for the new user: ');
  return generateKeyPair(name, '61487097701@c.us');
}

async function tailEvents(sessionKey) {
  const targetNpub = sessionKey.npub;
  logBuffer = [];
  let sessionId;
  try {
    const resp = await axios.post(`${API_BASE}/stream/start`, { npubs: [targetNpub] });
    sessionId = resp.data.sessionId;
  } catch (err) {
    output(`Stream start error: ${err.message}`);
    return;
  }
  output(`🕑 Subscribed for ${targetNpub} – press Ctrl+C to stop`);
  const es = new EventSource(`${API_BASE}/stream/events/${sessionId}`);
  es.onmessage = async ev => {
    let line;
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'decryptedAction') {
        const { payload: out, senderNpub, responseNpub, timestamp, threadID } = msg.data;
        const age = Date.now() - timestamp * 1000;
        if (!timestamp || age > IGNORE_OLD_MS) {
          line = `Ignored old or malformed message from ${senderNpub}`;
        } else {
          const inner = out.payload;
          if (inner.action === 'sign') {
            try {
              const nsec = await getPrivateKeyByNpub(inner.signerNPub);
              const { data: privKeyHex } = nip19.decode(nsec);
              const unsignedEvent = JSON.parse(inner.event);
              const signedEvent = finalizeEvent(unsignedEvent, privKeyHex);
              const newCallID = uuidv4();
              const timestamp2 = Math.floor(Date.now() / 1000);
              const nostrMqResponse = {
                callID: newCallID,
                threadID: threadID,
                timestamp: timestamp2,
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
              line = `✅ Signed event sent back to ${responseNpub}`;
            } catch (signErr) {
              line = `❌ Error signing event: ${signErr.message}`;
              console.error("Error details:", signErr.response?.data || signErr);
            }
          } else if (inner.action === 'signed') {
            try {
              const eventToBroadcast = JSON.parse(inner.signedEvent);
              await axios.post(`${API_BASE}/post/broadcast`, { event: eventToBroadcast });
              line = `✅ Broadcasted signed event: ${eventToBroadcast.id}`;
            } catch (broadcastErr) {
              line = `❌ Error broadcasting signed event: ${broadcastErr.message}`;
              console.error("Broadcast error details:", broadcastErr.response?.data || broadcastErr);
            }
          } else {
            line = `🆕 Payload from ${senderNpub}: ${JSON.stringify(inner)}`;
          }
        }
      } else {
        line = `🆕 Raw: ${JSON.stringify(msg)}`;
      }
    } catch {
      line = `🆕 Raw data: ${ev.data}`;
    }
    output(line);
  };
  es.onerror = err => output(`Stream error: ${err.message}`);
}

async function main() {
  await connectDB();
  const sessionKey = await chooseKey();
  tailEvents(sessionKey);

  while (true) {
    console.log(`\nHello ${sessionKey.name}, choose:`);
    console.log('a) Update profile');
    console.log('b) Create post');
    console.log('c) View last 10 posts');
    console.log('d) Publish action');
    console.log('f) Sign remotely');
    console.log('g) Create eCash wallet');
    console.log('e) Exit');
    const choice = await prompt('Enter a, b, c, d, f, g or e: ');

    try {
      if (choice === 'a') {
        const name = await prompt('Name: ');
        const about = await prompt('About: ');
        const picture = await prompt('Picture (url): ');
        const resp = await axios.post(`${API_BASE}/profile/update`, { name, about, picture, npub: sessionKey.npub });
        console.log('Profile updated:', resp.data);
      } else if (choice === 'b') {
        const content = await prompt('Content: ');
        const { npub } = await connect(sessionKey);
        const resp = await axios.post(`${API_BASE}/post/note`, { npub, content });
        console.log('Note created:', resp.data);
      } else if (choice === 'c') {
        const resp = await axios.get(`${API_BASE}/post/view10`, { params: { npub: sessionKey.npub } });
        resp.data.forEach((p, i) => console.log(`${i + 1}. ${p.content}`));
      } else if (choice === 'd') {
        // Encrypted action publishing via API
        const callNpub = await prompt('Call NPub (target): ');
        const responseNpubInput = await prompt(`Response NPub (default ${sessionKey.npub}): `);
        const responseNpub = responseNpubInput || sessionKey.npub;
        const input = await prompt('Enter JSON payload or leave blank for default: ');
        const defaultPayload = { cmd: 'pay', target: callNpub, amount: '21000' };
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
        const callNpubInput = await prompt('Call NPub (target, default npub17nqywpr8hvssklds0hd7uml8ydkw5vy2fj4dt6x93snh5tt9wl0sy56jrh): ');
        const callNpub = callNpubInput || 'npub17nqywpr8hvssklds0hd7uml8ydkw5vy2fj4dt6x93snh5tt9wl0sy56jrh';
        const responseNpubInput = await prompt(`Response NPub (default ${sessionKey.npub}): `);
        const responseNpub = responseNpubInput || sessionKey.npub;
        const signerNpubInput = await prompt(`Signer NPub (default ${sessionKey.npub}): `);
        const signerNpub = signerNpubInput || sessionKey.npub;
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
          console.error(
            'Error creating eCash wallet:',
            err.response
              ? JSON.stringify(err.response.data, null, 2)
              : err.message || err
          );
        }
      } else if (choice === 'g') {
        try {
          const { data } = await axios.post(`${API_BASE}/wallet/create`, { npub: sessionKey.npub });
          if (data.message === 'Wallet already exists') {
            console.log('\nWallet already exists:');
            console.log(`Mint: ${data.walletDetails.mint}`);
            console.log(`Public Key for receiving: ${data.walletDetails.p2pkPub}`);
          } else {
            console.log('\nWallet created successfully:');
            console.log(`Mint: ${data.walletDetails.mint}`);
            console.log(`Public Key for receiving: ${data.walletDetails.p2pkPub}`);
          }
        } catch (err) {
          const errorMsg = err.response && err.response.data
            ? (err.response.data.message || JSON.stringify(err.response.data))
            : (err.message || String(err));
          console.error('Error creating eCash wallet:', errorMsg);
        }
        continue;
      } else if (choice === 'e') {
        console.log('Exiting.');
        process.exit(0);
      } else {
        console.log('Invalid choice.');
      }
    } catch (err) {
      console.error('Error:', err.message || err);
    }
  }
}

main();
