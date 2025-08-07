# Nostr Command Tool (nctool)

This project provides a backend API layer and a command-line interface (CLI) test client for interacting with the Nostr protocol. It allows users to manage Nostr identities, update profiles, create posts, view posts, publish custom actions, stream events in real-time, and manage Cashu eCash wallets.

## Features

- **Identity Management**: Generate and manage Nostr keypairs.
- **Profile Updates**: Set user profile metadata (name, about, picture).
- **Posting**: Create and publish text notes (kind 1) with optional Proof-of-Work (PoW).
- **Viewing Posts**: Fetch the latest posts for a user, filterable by kind.
- **Custom Actions**: Publish arbitrary Nostr events (e.g., kind 30078) with custom payloads and `dTag`.
- **Real-time Streaming**: Subscribe to Nostr events for specified authors via Server-Sent Events (SSE).
- **Proof-of-Work Mining**: API endpoint to calculate PoW nonces for Nostr events.
- **Cashu eCash Wallet**: Complete Cashu wallet implementation with mint, send, receive, and melt operations.
- **CLI Test Client**: Interactive command-line tool to test API functionality.

## Prerequisites

- Node.js (v18+)
- MongoDB (local or remote)
- Dependencies: `axios`, `readline`, `eventsource`, `nostr-tools`, `@cashu/cashu-ts`

## Installation

Install the necessary dependencies:

```bash
npm install
```

## Running the Application

### Start the Server

```bash
npm start
```

The server will start on `http://localhost:3000` by default.

### Run the Test Client

The test client (`index.js` in the root directory) provides an interactive way to use the API:

```bash
node index.js
```

Follow the on-screen prompts to select an identity, update your profile, post notes, view posts, publish actions, or subscribe to events.

## Cashu Wallet API

The application includes a complete Cashu eCash wallet implementation with the following endpoints:

### Wallet Management

#### Create Wallet
```bash
POST /api/wallet/create
Content-Type: application/json

{
  "npub": "npub1..."
}
```

#### Get Wallet Info
```bash
GET /api/wallet/:npub/info
```

#### Get Balance
```bash
GET /api/wallet/:npub/balance
```

### Token Operations

#### Mint Tokens
```bash
POST /api/wallet/:npub/mint
Content-Type: application/json

{
  "amount": 1000
}
```

#### Send Tokens
```bash
POST /api/wallet/:npub/send
Content-Type: application/json

{
  "amount": 500,
  "recipientPubkey": "02abcd..." // optional for P2PK
}
```

#### Receive Tokens
```bash
POST /api/wallet/:npub/receive
Content-Type: application/json

{
  "encodedToken": "cashuAey...",
  "privateKey": "hex_private_key" // optional for P2PK tokens
}
```

#### Melt Tokens (Pay Lightning Invoice)
```bash
POST /api/wallet/:npub/melt
Content-Type: application/json

{
  "invoice": "lnbc1..."
}
```

### Transaction History

#### Get Transaction History
```bash
GET /api/wallet/:npub/transactions?limit=50&skip=0&transaction_type=sent
```

#### Check Proof States
```bash
GET /api/wallet/:npub/proofs/status?proofs=[{"id":"...","amount":100,"secret":"...","C":"..."}]
```

## Environment Variables

### Core Application
- `MONGO_URI` / `MONGODB_URI`: MongoDB connection string
- `PORT`: Server port (default: `3000`)

### Nostr Configuration
- `NOSTR_RELAY_MODE`: Relay connection mode - `local` or `remote` (default: `local`)
- `NOSTR_LOCAL_RELAYS`: Comma-separated local relay URLs (default: `ws://127.0.0.1:8021`)
- `NOSTR_REMOTE_RELAYS`: Comma-separated remote relay URLs
- `RELAYS`: Comma-separated relay URLs for wallet events

### Cashu Configuration
- `MINT_URL`: Cashu mint URL (default: `https://mint.minibits.cash/Bitcoin`)

### Test Client
- `API_URL`: Base URL for the API server (default: `http://localhost:3000`)
- `POW_BITS`: Default proof-of-work difficulty (default: `20`)
- `TIMEOUT_MS`: Default timeout for publishing events in milliseconds (default: `10000`)
- `IGNORE_OLD`: Milliseconds threshold for ignoring old messages (default: no limit)
+
+### NostrMQ Remote API (Phase 1: /post/note)
+- `NOSTR_MQ_CALL`: npub that this service will listen for via NostrMQ and use to decrypt messages
+- `NOSTRMQ_RELAYS`: Comma-separated relays used by NostrMQ receive/send (default: `wss://relay.damus.io,wss://relay.snort.social`)
- `NOSTRMQ_ENABLE_DEDUP`: Enable duplicate message prevention (default: `true`)
- `NOSTRMQ_SINCE_HOURS`: Only process messages from last N hours (default: `24`)
- `NOSTRMQ_MAX_CACHE_SIZE`: Maximum number of event IDs to cache for duplicate detection (default: `10000`)
+- `NOSTRMQ_POW_DIFFICULTY`: Optional PoW difficulty for outbound messages (reserved for future use)
+- `NOSTRMQ_POW_THREADS`: Optional PoW threads (reserved for future use)
+
+Example:
+```
+NOSTR_MQ_CALL="npub1xxxxx..."
+NOSTRMQ_RELAYS="wss://relay.damus.io,wss://relay.snort.social"
NOSTRMQ_ENABLE_DEDUP="true"
NOSTRMQ_SINCE_HOURS="24"
NOSTRMQ_MAX_CACHE_SIZE="10000"
+```
+
+The private key corresponding to `NOSTR_MQ_CALL` must exist in the identities database (managed by identity.service).
+
+## NostrMQ Usage
+
+This server can be triggered via NostrMQ using encrypted messages instead of HTTP calls. Phase 1 supports the `/post/note` action:
+
+Incoming message payload:
+```json
+{
+  "action": "/post/note",
+  "data": {
+    "npub": "npub1...",
+    "content": "Hello Nostr!",
+    "powBits": 20,
+    "timeoutMs": 10000
+  }
+}
+```
+
+Success response payload:
+```json
+{
+  "success": true,
+  "action": "/post/note",
+  "data": {
+    "relays": ["wss://relay.damus.io"],
+    "latestEvents": [{ "id": "event_id", "kind": 1, "content": "Hello Nostr!", "created_at": 1714110000 }]
+  }
+}
+```
+
+Error response payload:
+```json
+{
+  "success": false,
+  "action": "/post/note",
+  "error": { "code": "ValidationError", "message": "Invalid npub format provided" }
+}
+```
+
+Implementation details:
+- NostrMQ listener initializes at startup and degrades gracefully if misconfigured
### Duplicate Message Prevention

NostrMQ includes built-in duplicate prevention to avoid processing the same message multiple times:

- **Library-level deduplication**: Uses NostrMQ's native `since` and `deduplication` options
- **Application-level tracking**: Maintains an in-memory cache of processed event IDs
- **Automatic cleanup**: Periodically removes old entries from the cache
- **Error recovery**: Removes failed events from cache to allow retry

Configuration:
- Set `NOSTRMQ_ENABLE_DEDUP=false` to disable duplicate prevention
- Adjust `NOSTRMQ_SINCE_HOURS` to change the time window for processing messages
- Modify `NOSTRMQ_MAX_CACHE_SIZE` to control memory usage for event ID caching

When duplicate prevention is enabled, you'll see console output showing:
```
DEDUPLICATION: enabled
SINCE: 24 hours ago
```

Duplicate events are logged and skipped:
```
Skipping duplicate NostrMQ event: <event_id>
```
+- Messages are validated and routed to the existing post note logic
+- The HTTP API remains fully functional
+
+See also: [NostrMQ Documentation](./doc/nostrMQ.md)
 
 ## Documentation
 
 For more detailed information, please refer to:
 
 - [API Layer Documentation](./doc/apiLayer.md)
 - [Test Client Documentation](./doc/testClient.md)
 - [Cashu Wallet API Documentation](./doc/cashu-wallet-api.md)
