#!/usr/bin/env node
import axios from 'axios';
import readline from 'readline';
import { EventSource } from 'eventsource';
import { connect } from './src/services/nostr.service.js';
import { getAllKeys, generateKeyPair } from './src/services/identity.service.js';
import { nip19 } from 'nostr-tools';

const API_BASE = process.env.API_URL || 'http://localhost:3000';

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

async function tailEvents() { // Removed sessionKey as direct param, we get all keys now
  // 1. Get all known npubs
  const allKeys = getAllKeys();
  const allNpubs = allKeys.map(key => key.npub);

  // 2. tell API to spin up (or reuse) the SSE session, providing all npubs
  let sessionId;
  try {
    // Send the array of all npubs to the backend
    const resp = await axios.post(`${API_BASE}/stream/start`, {
      npubs: allNpubs
    });
    sessionId = resp.data.sessionId;
  } catch (err) {
    console.error('Failed to start stream:', err.message);
    return;
  }

  console.log('\n🕑 Waiting for data from authors:', allNpubs.join(', '), '– press Q to quit\n');

  // 3. open the stream
  const es = new EventSource(`${API_BASE}/stream/events/${sessionId}`);
  es.onmessage = ev => {
    try {
      const eventData = JSON.parse(ev.data);
      // Optionally format the output to show who sent the event
      const authorNpub = nip19.npubEncode(eventData.pubkey);
      console.log(`🆕 [from: ${authorNpub}]`, eventData.content);
    } catch (parseError) {
      console.log('🆕 Raw:', ev.data); // Fallback for non-JSON data
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
        const input = await prompt('Enter JSON payload or leave blank for default: ');
        const defaultPayload = {
          cmd: 'pay',
          target: 'npub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy',
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
        const { ndk, signer, npub } = await connect(sessionKey);
        const powBits = Number(process.env.POW_BITS) || 20;
        const timeoutMs = Number(process.env.TIMEOUT_MS) || 10000;
        const actionResp = await axios.post(`${API_BASE}/action`, {
          dTag: 'avalon:task:10002929',
          payload,
          powBits,
          timeoutMs
        });
        console.log('Action published:', actionResp.data);
        const { data: pubHex } = nip19.decode(npub);
        const filter = { authors: [pubHex], kinds: [0, 1, 30078], limit: 10 };
        const events = await ndk.fetchEvents(filter, { timeoutSec: 5 });
        console.log(`\n📝 Latest 10 events by ${npub} (kinds 0,1,30078):\n`);
        [...events]
          .sort((a, b) => b.created_at - a.created_at)
          .forEach((e, i) => {
            console.log(
              `${i + 1}. [${e.kind}] ${e.content} (id: ${e.id}, created_at: ${e.created_at})`
            );
          });
      } else if (choice === '5') {
        // No longer need to pass sessionKey, tailEvents gets all keys itself
        await tailEvents();
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
