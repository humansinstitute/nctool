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

## Documentation

For more detailed information, please refer to:

- [API Layer Documentation](./doc/apiLayer.md)
- [Test Client Documentation](./doc/testClient.md)
- [Cashu Wallet API Documentation](./doc/cashu-wallet-api.md)
