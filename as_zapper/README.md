as_zapper
=========

Minimal zap server that:
- Accepts a recipient `npub` and `amount` (sats)
- Creates a NIP-57 zap request (9734) signed with `PRIVKEYHEX`
- Requests a BOLT11 invoice from recipient’s LNURLp callback
- Pays the invoice via the main NC tools server (`/api/wallet/:npub/melt`)
- Publishes a zap receipt (9735) to relays

Setup
-----
- Copy `.env.example` to `.env` and set:
  - `SENDER_NPUB` to your fixed payer npub
  - `PRIVKEYHEX` to the hex secret key for signing
  - `TOOLS_SERVER_URL` to the base URL of the main server (default `http://127.0.0.1:3041`)
  - Optionally `RELAYS` to comma-separated relay URLs

Install and run
---------------
1) From `as_zapper/`, install deps
   `npm i`
2) Start the main project server (must be running for melt)
3) Start this server
   `npm run start`

API
---
POST `/zap`
Body:
```
{
  "recipientNpub": "npub1...",
  "amount": 21,
  "lightningAddress": "name@domain",
  "comment": "optional",
  "targetType": "e" | "a",
  "target": "...",
  "relays": ["wss://relay.damus.io"]
}
```
Response: `{ success, data: { invoice, melt, receiptId, publishedRelays } }`

Notes
-----
- Event signing uses `PRIVKEYHEX` and will warn if it doesn’t match `SENDER_NPUB`.
- Invoice payment relies on the main server’s wallet API; ensure a wallet exists for `SENDER_NPUB` with sufficient balance.
- If you want automatic LNURL profile discovery, we can extend to use the project’s Applesauce helpers; for now pass `lightningAddress`.

