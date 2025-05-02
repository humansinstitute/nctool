Below is a **trimmed-down, endpoint-centric design** that fits the workflow you described:

---

## 1. Folder layout

```
/nctool
├── src
│   ├── server.js              # Existing Express app + routes - build endpoints from here. 
│   ├── controllers            # Existing folder build in new controllers as required. 
│   │   └── wallet.controller.js
│   ├── services               # Existing folder build in new controllers as required. 
│   │   ├── nostr.service.js  # relay pool + helpers
│   │   └── cashu.service.js  # thin wrapper around cashu-ts
│   └── .env                  # RELAYS, MINT_URL, etc.
└── index.js                # readline CLI menu in root folder that hits the endpoints for testing using differnt user key sets.
```

All logic lives in the **service layer**; the **CLI** is just a lightweight HTTP client that calls each endpoint.

---

## 2. Key event kinds we must handle

| Purpose | Nostr kind | Notes |
|---------|-----------|-------|
| Wallet metadata (mint + P2PK privkey, encrypted) | **17375** | Replaceable; defined by NIP-60  ([NIP60 - NIP-60 - Cashu Wallets](https://nips.nostr.com/60?utm_source=chatgpt.com)) |
| Unspent proofs | **7375** | Encrypted list of tokens (Cashu proofs)  ([NIP60 - NIP-60 - Cashu Wallets](https://nips.nostr.com/60?utm_source=chatgpt.com)) |
| Optional spend / receive history | **7376** | For UI only (optional)  ([NIP60 - NIP-60 - Cashu Wallets](https://nips.nostr.com/60?utm_source=chatgpt.com)) |
| “How to pay me” card | **10019** | Lists relay(s), accepted mint(s), **P2PK pubkey**  ([NIP61 - NIP-61 - Nutzaps](https://nips.nostr.com/61?utm_source=chatgpt.com)) |
| Nutzap payment event | **9321** | Contains `proof` tag with P2PK-locked token  ([NIP61 - NIP-61 - Nutzaps](https://nips.nostr.com/61?utm_source=chatgpt.com)) |

---

## 3. Backend – Express routes

```js
// src/server.js EXAMPLE
import express from 'express';
import wallet from './controllers/wallet.controller.js';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

app.post('/wallet/create',   wallet.create);
app.get ('/wallet/balance',  wallet.balance);
app.post('/wallet/receive',  wallet.receive);   // pull new 9321 events & redeem
app.post('/wallet/spend',    wallet.spend);     // send a nutzap

app.listen(3000, () => console.log('API listening on :3000'));
```

### controller outline (wallet.controller.js)

```js
import { nostrPool, signAndPublish, fetchEvents } from '../services/nostr.service.js';
import { CashuWallet } from '../services/cashu.service.js';
import { nip04, getPublicKey } from 'nostr-tools';

export async function create(req, res) {
  const userNsec = req.body.nsec;                                // caller supplies
  const npub     = getPublicKey(userNsec);

  // 1. generate P2PK keypair for wallet
  const { privkey: p2pkPriv, pubkey: p2pkPub } = CashuWallet.genP2PK();

  // 2. build kind 17375 (wallet meta) – encrypt with user key
  const content = JSON.stringify({ mint: process.env.MINT_URL, p2pkPriv });
  const enc     = nip04.encrypt(userNsec, npub, content);

  await signAndPublish({
    kind: 17375,
    content: enc,
    pubkey: npub,
    tags: [['mint', process.env.MINT_URL]],
  }, userNsec);

  // 3. build kind 10019 so others know how to pay
  await signAndPublish({
    kind : 10019,
    content: '',
    pubkey: npub,
    tags : [
      ['relay', process.env.RELAYS.split(',')[0]],
      ['mint' , process.env.MINT_URL],
      ['pubkey', '02' + p2pkPub],               // NIP-61 requirement  ([NIP61 - NIP-61 - Nutzaps](https://nips.nostr.com/61?utm_source=chatgpt.com))
    ]
  }, userNsec);

  res.json({ ok: true, p2pkPub });
}

export async function balance(req, res) {
  const { nsec } = req.query;
  const npub     = getPublicKey(nsec);
  const tokens   = await fetchEvents(npub, 7375);
  const sum      = CashuWallet.sum(tokens, nsec); // decrypt each, add amounts
  res.json({ balance: sum });
}

export async function receive(req, res) {
  const { nsec } = req.body;
  const npub     = getPublicKey(nsec);

  // 1. look for new nutzap events addressed to me
  const events = await fetchEvents(npub, 9321, [['p', npub]]);
  let received = 0;

  for (const ev of events) {
    const proofTag = ev.tags.find(t => t[0] === 'proof');
    if (!proofTag) continue;

    const token = JSON.parse(proofTag[1]);
    // 2. redeem P2PK-locked token at mint
    const newProof = await CashuWallet.redeemP2PK(token);

    // 3. store new proof in a fresh 7375 event
    await CashuWallet.appendProof(nsec, newProof);  // publishes 7375

    received += newProof.amount;
  }
  res.json({ received });
}

export async function spend(req, res) {
  const { nsec, recipientNpub, amount, noteId } = req.body;
  const npub = getPublicKey(nsec);

  // 1. get recipient’s 10019 info
  const [info] = await fetchEvents(recipientNpub, 10019);
  const p2pk   = info.tags.find(t => t[0] === 'pubkey')[1];
  const mint   = info.tags.find(t => t[0] === 'mint')[1];

  // 2. build P2PK-locked proof
  const { proof, change } = await CashuWallet.createP2PKPayment(amount, p2pk);

  // 3. publish nutzap event
  await signAndPublish({
    kind : 9321,
    pubkey: npub,
    content: `Zap ${amount} sats`,
    tags : [
      ['p', recipientNpub],
      ['u', mint],
      ['proof', JSON.stringify(proof)],
      ...(noteId ? [['e', noteId]] : [])
    ]
  }, nsec);

  // 4. update sender wallet (delete old proofs, add change)
  await CashuWallet.applySpend(nsec, proof.inputsSpent, change);

  res.json({ sent: amount, event: proof });
}
```

> **Implementation details** ( services folders)  
> * `cashu.service.js` – wraps `cashu-ts` library for mint calls (Split, Melt, P2PK helpers, sum(), etc.)  ([Cashu wallets - Cashu.space](https://docs.cashu.space/wallets?utm_source=chatgpt.com))  
> * `nostr.service.js` – one relay pool using `nostr-tools` (or Nostr NDK) that offers:  
>    `fetchEvents(pubkey, kind, filterTags)` and `signAndPublish(evt, nsec)`.

---

## 4. CLI menu (/index.js) 

This example shows a standalone menu, this would need to be integrated into the existing options defined in /doc/testClient.md

```js
#!/usr/bin/env node
import axios from 'axios';
import readline from 'readline';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const api = axios.create({ baseURL: 'http://localhost:3000' });

async function prompt(q) { return new Promise(r => rl.question(q, r)); }

async function main() {
  const nsec = await prompt('Paste your nsec (keep secret!): ');
  while (true) {
    console.log('\n1) Create wallet\n2) Balance\n3) Receive (check zaps)\n4) Send\n5) Quit');
    const ch = await prompt('Choose: ');
    if (ch === '1') await api.post('/wallet/create', { nsec });
    if (ch === '2') {
      const { data } = await api.get('/wallet/balance', { params: { nsec } });
      console.log('Balance:', data.balance);
    }
    if (ch === '3') await api.post('/wallet/receive', { nsec });
    if (ch === '4') {
      const recipient = await prompt('Recipient npub: ');
      const amt       = Number(await prompt('Amount (sats): '));
      await api.post('/wallet/spend', { nsec, recipientNpub: recipient, amount: amt });
    }
    if (ch === '5') { rl.close(); process.exit(0); }
  }
}
main();
```

Run it with:

```bash
cd cli && node cli.js
```

The CLI simply **delegates** every heavy-lifting step to the corresponding `/wallet/*` endpoint, keeping your command-line UX minimal.

---

## 5. Flow summary

1. **Create wallet** → `/wallet/create`  
   *Generates P2PK keys, posts kind 17375 + 10019.*

2. **Receive funds** → `/wallet/receive`  
   *Scans relays for kind 9321 → redeems with mint → appends kind 7375.*

3. **Spend funds** → `/wallet/spend`  
   *Looks up recipient’s kind 10019 → splits/locks token with mint → posts kind 9321 → updates local proofs.*

4. **Balance** → `/wallet/balance`  
   *Summation of decrypted proofs in current kind 7375 events.*

Because **all state lives on Nostr (encrypted)**, the backend can be restarted or redeployed without losing wallet data; the CLI only needs the user’s `nsec` to restore everything.

---

### Why this still matches NIP-60 & NIP-61

* **Wallet metadata** and **proof lists** are stored exactly where the specs prescribe  ([NIP60 - NIP-60 - Cashu Wallets](https://nips.nostr.com/60?utm_source=chatgpt.com)).  
* **Tokens sent to others** are P2PK-locked and carried inside kind 9321 events, following the prefix rule `"02"`  ([NIP61 - NIP-61 - Nutzaps](https://nips.nostr.com/61?utm_source=chatgpt.com)).  
* We restrict ourselves to a **single mint** (configured in `.env`), but the structure is compatible with multi-mint later by adding more `mint` tags and wallet fields.

---

### Next steps / improvements (once you’re comfortable)

* **Lightning–internal exchange** – use the mint’s built-in LN gateway to allow “withdraw to invoice” via `/wallet/spend`.
* **Lightning–Address Support** – use the mint’s built-in LN gateway to allow “withdraw to invoice” via `/wallet/spend`.
* **Multi-mint support** – extend the wallet meta event to track multiple mints.  
* **Web-socket sub (push)** – instead of polling `/wallet/receive`, open a background WS to relays and auto-trigger redemption.  


With this stripped-down approach, each endpoint is a single, testable unit—and the CLI stays tiny while still exercising the full Nutstash / Nutzap flow.