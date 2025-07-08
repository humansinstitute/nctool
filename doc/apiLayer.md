# API Layer Documentation

This document describes the HTTP API endpoints exposed by the nctool server. Each section includes:
- Endpoint path and HTTP method  
- Description  
- Path, query, and body parameters  
- Request/response schemas  
- Example requests and responses  

---

## Base URL
```
http://localhost:3000
```

---

## Identity

### POST /id/generateKey
Generates and persists a new Nostr keypair to `~/.nctool/keys.json` and logs the created identity object to the server console.

**Request**  
- No parameters or body

```bash
curl -X POST http://localhost:3000/id/generateKey
```

**Response 200**
```json
{
  "privkey": "e3f8...a1b2",
  "pubkey": "026f...9cde",
  "nsec": "nsec1...",
  "npub": "npub1..."
}
```

---

### GET /id/getKeys
Retrieves an existing keypair if already generated.

**Request**  
- No parameters or body

```bash
curl http://localhost:3000/id/getKeys
```

**Response 200**
```json
{
  "privkey": "e3f8...a1b2",
  "pubkey": "026f...9cde",
  "nsec": "nsec1...",
  "npub": "npub1..."
}
```

**Response 404**
```json
{
  "error": "NotFound",
  "message": "Keys not generated"
}
```

### GET /id/gate/:wa_gate_id

Retrieves a persisted identity by its WhatsApp Gate ID, returning only public information.

**Path Parameters**  
| Name       | Type   | Required | Description                     |
|------------|--------|----------|---------------------------------|
| wa_gate_id | string | Yes      | The WhatsApp Gate identifier    |

**Request**  
```bash
curl http://localhost:3000/id/gate/{wa_gate_id}
```

**Response 200**  
```json
{
  "pubkey": "026f...9cde",
  "npub": "npub1...",
  "name": "Alice",
  "wa_gate_id": "alice123"
}
```

**Response 400**  
```json
{
  "error": "BadRequest",
  "message": "wa_gate_id parameter is required"
}
```

**Response 404**  
```json
{
  "error": "NotFound",
  "message": "Identity not found for wa_gate_id alice123"
}
```

---

## Proof-of-Work

### POST /pow
Mines proof-of-work on a raw Nostr event.

**Body Parameters**  
| Name       | Type    | Required | Description                                           |
|------------|---------|----------|-------------------------------------------------------|
| rawEvent   | object  | Yes      | Raw Nostr event object to mine (JSON)                 |
| difficulty | number  | No       | Bits of difficulty (default: `process.env.POW_BITS`)  |

```bash
curl -X POST http://localhost:3000/pow \
  -H "Content-Type: application/json" \
  -d '{
    "rawEvent": { "kind": 1, "content": "Hello" },
    "difficulty": 20
  }'
```

**Response 200**
```json
{
  "mined": {
    "kind": 1,
    "content": "Hello",
    "nonce": 12345678,
    "...": "..."
  }
}
```

---

## Stream

### POST /stream/start
Initiates a new Nostr event streaming session. Accepts an optional array of author public keys.

**Body Parameters**  
| Name  | Type     | Required | Description                                  |
|-------|----------|----------|----------------------------------------------|
| npubs | string[] | No       | Array of Nostr public keys in `npub` format. |

*Note:* The server uses these NPub keys to subscribe to relays with a `#p` tag filter on kind `30078` events, ensuring only messages addressed to these recipients are streamed.

```bash
curl -X POST http://localhost:3000/stream/start \
  -H "Content-Type: application/json" \
  -d '{
    "npubs": ["npub1...", "npub2..."]
  }'
```

**Response 200**
```json
{ "sessionId": "session1234" }
```

**Response 400**
```json
{ "error": "npubs must be an array of strings" }
```

---

### GET /stream/events/:id
Connects to an active stream session and receives events via Server-Sent Events (SSE).

**Path Parameters**  
| Name | Type   | Required | Description                                |
|------|--------|----------|--------------------------------------------|
| id   | string | Yes      | Session ID returned by `/stream/start`.    |

```bash
curl http://localhost:3000/stream/events/session1234
```

**Response 200**

- Headers: `Content-Type: text/event-stream`, `Connection: keep-alive`, `Cache-Control: no-cache`  
- Body: Server-Sent Events where each message is JSON. Decrypted kind `30078` actions arrive as:

  ```json
  data:{"type":"decryptedAction","data":{"payload":{...},"senderNpub":"npub1...","responseNpub":"npub1...","timestamp":1714110000}}
  ```

  Other events are streamed in raw form.

**Response 404**
```json
{ "error": "Session not found" }
```

---

### DELETE /stream/stop/:id
Stops an active stream session.

**Path Parameters**  
| Name | Type   | Required | Description                                |
|------|--------|----------|--------------------------------------------|
| id   | string | Yes      | Session ID returned by `/stream/start`.    |

```bash
curl -X DELETE http://localhost:3000/stream/stop/session1234
```

**Response 200**
```json
{ "stopped": true }
```

---

## Posts

### POST /post
Creates and publishes a new post.

**Body Parameters**  
| Name    | Type   | Required | Description                         |
|---------|--------|----------|-------------------------------------|
| content | string | Yes      | Text content of the post            |
| kind    | number | No       | Nostr event kind (default: `1`)     |

```bash
curl -X POST http://localhost:3000/post \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello world",
    "kind": 1
  }'
```

**Response 200**
```json
{
  "id": "abcdef123456...",
  "relays": ["wss://relay.example.com"]
}
```

---

### POST /post/note
Sends a Nostr Text note and returns the latest events for the author.

**Body Parameters**  
| Name       | Type   | Required | Description                                  |
|------------|--------|----------|----------------------------------------------|
| npub       | string | Yes      | Public key in Nostr `npub` format            |
| content    | string | Yes      | Note text content                            |
| powBits    | number | No       | POW bits (default: `process.env.POW_BITS`)   |
| timeoutMs  | number | No       | Publish timeout in ms (default: `process.env.TIMEOUT_MS`) |

```bash
curl -X POST http://localhost:3000/post/note \
  -H "Content-Type: application/json" \
  -d '{
    "npub": "npub1...",
    "content": "This is a note",
    "powBits": 20,
    "timeoutMs": 10000
  }'
```

**Response 200**
```json
{
  "relays": ["wss://relay.example.com"],
  "latestEvents": [
    {
      "id": "eventid123",
      "kind": 1,
      "content": "This is a note",
      "created_at": 1714110000
    },
    {
      "id": "eventid122",
      "kind": 0,
      "content": "...profile metadata..."
    }
  ]
}
```

### POST /post/note_remote
Sends a remote sign request via Nostr MQ Kind 4 encrypted DM.

**Body Parameters**  
| Name         | Type   | Required | Description                                                                                                               |
|--------------|--------|----------|---------------------------------------------------------------------------------------------------------------------------|
| senderNpub   | string | Yes      | `npub` of the sender initiating the sign request.                                                                         |
| callNpub     | string | Yes      | `npub` of the remote signer (recipient of the encrypted request).                                                         |
| responseNpub | string | Yes      | `npub` where the remote signer will send the signed event back.                                                           |
| signerNpub   | string | Yes      | `npub` of the key that the remote signer should use to sign the event.                                                    |
| noteContent  | string | Yes      | Text content of the note; the API constructs a standard Kind 1 event internally.                                           |
| threadID     | string | No       | `callID` of the parent request, used for threading. If omitted, a new `threadID` is generated equal to the new `callID`. |
| powBits      | number | No       | POW difficulty bits (default: `process.env.POW_BITS`).                                                                     |
| timeoutMs    | number | No       | Publish timeout in ms (default: `process.env.TIMEOUT_MS`).                                                                 |

**Response 200**  
```json
{
  "callID": "generated-uuid-v4",
  "id": "abcdef123456...",
  "relays": ["wss://relay.example.com"]
}
```

**Example**  
```bash
curl -X POST http://localhost:3000/post/note_remote \
  -H "Content-Type: application/json" \
  -d '{
    "senderNpub": "npub1...sender",
    "callNpub": "npub2...signer",
    "responseNpub": "npub3...response",
    "signerNpub": "npub4...signer",
    "noteContent": "Hello",
    "powBits": 20,
    "timeoutMs": 10000
  }'
```

---

### POST /post/broadcast

**Description:** Accepts a fully signed Nostr event object and publishes it to configured relays.

**Body Parameters**  
| Name  | Type   | Required | Description                |
|-------|--------|----------|----------------------------|
| event | object | Yes      | Complete signed event JSON |

```bash
curl -X POST http://localhost:3000/post/broadcast \
  -H "Content-Type: application/json" \
  -d '{
    "event": { "id": "...", "pubkey": "...", "sig": "...", ... }
  }'
```

**Response 200**  
```json
{
  "id": "eventid123",
  "relays": ["wss://relay.example.com"]
}
```

### GET /post/view10
Retrieves the latest 10 posts by the current keypair.

**Query Parameters**  
| Name | Type   | Required | Description                          |
|------|--------|----------|--------------------------------------|
| kind | number | No       | Filter by event kind (`0` or `1`)   |
| npub | string | No       | Filter by author public key (`npub` format) |

```bash
curl http://localhost:3000/post/view10?kind=1
```

**Response 200**
```json
[
  {
    "id": "abcdef123",
    "kind": 1,
    "content": "Hello world",
    "created_at": 1714109990
  },
  ...
]
```

---

## Actions

### POST /action/take
Executes a simple action based on a command payload.

**Body Parameters**  
| Name   | Type   | Required | Description                        |
|--------|--------|----------|------------------------------------|
| cmd    | string | Yes      | Command name (e.g. `"pay"`)        |
| target | string | No       | Nostr `npub` target for payment    |
| amount | number | No       | Amount in sats                     |

```bash
curl -X POST http://localhost:3000/action/take \
  -H "Content-Type: application/json" \
  -d '{
    "cmd": "pay",
    "target": "npub1...",
    "amount": 1000
  }'
```

**Response 200**
```json
{
  "name": "Alice",
  "amount": 1000
}
```
If `cmd !== "pay"`:
```json
{ "message": "No action" }
```

---

### POST /action
Publishes an arbitrary action event.

**Body Parameters**  
| Name      | Type    | Required | Description                                     |
|-----------|---------|----------|-------------------------------------------------|
| dTag      | string  | Yes      | Action tag identifier                           |
| payload   | object  | Yes      | Arbitrary payload to include in the event       |
| powBits   | number  | No       | POW bits (default: `process.env.POW_BITS`)      |
| timeoutMs | number  | No       | Publish timeout in ms (default: `process.env.TIMEOUT_MS`) |

```bash
curl -X POST http://localhost:3000/action \
  -H "Content-Type: application/json" \
  -d '{
    "dTag": "order123",
    "payload": { "item": "book", "qty": 2 },
    "powBits": 0,
    "timeoutMs": 5000
  }'
```

**Response 200**
```json
{
  "id": "eventid456",
  "relays": ["wss://relay.example.com"]
}
```

---

### POST /action/encrypted

**POST** /action/encrypted  
Publishes a NIP-04 encrypted kind 30078 event.

**Body Parameters**  
| Name         | Type       | Required | Description                                                    |
|--------------|------------|----------|----------------------------------------------------------------|
| senderNpub   | string     | Yes      | Nostr `npub` of the sender                                     |
| callNpub     | string     | Yes      | Nostr `npub` of the message recipient                          |
| responseNpub | string     | Yes      | Nostr `npub` of where to send the response                     |
| payload      | object     | Yes      | Payload object to encrypt                                       |
| powBits      | number     | No       | POW bits (default: `process.env.POW_BITS`)                     |
| timeoutMs    | number     | No       | Publish timeout in ms (default: `process.env.TIMEOUT_MS`)      |

```bash
curl -X POST http://localhost:3000/action/encrypted \
  -H "Content-Type: application/json" \
  -d '{
    "senderNpub": "npub1...",
    "callNpub": "npub2...",
    "responseNpub": "npub3...",
    "payload": { "cmd": "pay", "target": "npub2...", "amount": "21000" },
    "powBits": 0,
    "timeoutMs": 5000
  }'
```

**Response 200**
```json
{
  "id": "abcdef123456...",
  "relays": ["wss://relay.example.com"]
}
```

---

## Profile

### POST /profile/update
Updates metadata for the current keypair (kind=0).

**Body Parameters**  
| Name    | Type   | Required | Description                     |
|---------|--------|----------|---------------------------------|
| name    | string | Yes      | Display name                    |
| about   | string | Yes      | About or bio text               |
| npub    | string | Yes      | Public key in Nostr `npub` format identifying which profile to update |
| picture | string | No       | URL of profile picture          |

```bash
curl -X POST http://localhost:3000/profile/update \
  -H "Content-Type: application/json" \
  -d '{
    "npub": "npub1...",
    "name": "Bob",
    "about": "Developer",
    "picture": "https://example.com/avatar.png"
  }'
```

**Response 200**
```json
{
  "id": "eventid789",
  "relays": ["wss://relay.example.com"]
}
