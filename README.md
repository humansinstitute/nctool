# Nostr Command Tool (nctool)

This project provides a backend API layer and a command-line interface (CLI) test client for interacting with the Nostr protocol. It allows users to manage Nostr identities, update profiles, create posts, view posts, publish custom actions, and stream events in real-time.

## Features

- **Identity Management**: Generate and manage Nostr keypairs.  
- **Profile Updates**: Set user profile metadata (name, about, picture).  
- **Posting**: Create and publish text notes (kind 1) with optional Proof-of-Work (PoW).  
- **Viewing Posts**: Fetch the latest posts for a user, filterable by kind.  
- **Custom Actions**: Publish arbitrary Nostr events (e.g., kind 30078) with custom payloads and `dTag`.  
- **Real-time Streaming**: Subscribe to Nostr events for specified authors via Server-Sent Events (SSE).  
- **Proof-of-Work Mining**: API endpoint to calculate PoW nonces for Nostr events.  
- **CLI Test Client**: Interactive command-line tool to test API functionality.  

## Prerequisites (Test Client)

- Node.js (v14+)  
- Dependencies: `axios`, `readline`, `eventsource`, `nostr-tools`  

## Installation (Test Client)

Install the necessary dependencies for the test client:

```bash
npm install axios readline eventsource nostr-tools
```

> **Note:** The main application dependencies are listed in `package.json` and can be installed with `npm install` in the project root.

## Running the Test Client

The test client (`index.js` in the root directory) provides an interactive way to use the API:

```bash
node index.js
```

Follow the on-screen prompts to select an identity, update your profile, post notes, view posts, publish actions, or subscribe to events.

## Environment Variables (Test Client)

- `API_URL`: Base URL for the API server (default: `http://localhost:3000`)  
- `POW_BITS`: Default proof-of-work difficulty (default: `20`)  
- `TIMEOUT_MS`: Default timeout for publishing events in milliseconds (default: `10000`)  
- `IGNORE_OLD`: Milliseconds threshold for ignoring old messages (default: no limit)  
- `NOSTR_RELAY_MODE`: Specifies the mode for Nostr relay connections. Can be `local` or `remote`. (default: `local`)
- `NOSTR_LOCAL_RELAYS`: Comma-separated string of local Nostr relay URLs to use when `NOSTR_RELAY_MODE` is `local`. (default: `ws://127.0.0.1:8021`)
- `NOSTR_REMOTE_RELAYS`: Comma-separated string of remote Nostr relay URLs to use when `NOSTR_RELAY_MODE` is `remote`. (default: `"wss://nostr.wine,wss://relayable.org,wss://relay.primal.net,wss://nostr.bitcoiner.social,wss://relay.damus.io,wss://nos.lol,wss://relay.snort.social,wss://purplepag.es,wss://relay.nostr.band"`)

## Documentation

For more detailed information, please refer to:

- [API Layer Documentation](./doc/apiLayer.md)  
- [Test Client Documentation](./doc/testClient.md)
