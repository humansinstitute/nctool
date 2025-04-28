# Nostr as a Public Message Queue (NostrMQ) using Kind 30078

This document describes how Nostr’s decentralized relay network can be leveraged as a secure, encrypted “public message queue” (NostrMQ) using kind `30078` events. Multiple independent services around the world can subscribe to their own message queue, decrypt incoming commands, perform actions, and optionally send responses back—enabling a composable, permissioned, serverless function model on Nostr.

---

## 1. Introduction

- **Goal:** Use Nostr relays as a global, pub/sub message transport layer.  
- **Approach:**  
  1. Sender publishes an encrypted `30078` event addressed to a recipient’s public key.  
  2. Recipient services subscribe to events tagged for them, decrypt the payload, and execute commands.  
  3. Responses can be routed back to a specified `response` public key.

---

## 2. Core Mechanism

1. **Event Kind:** `30078` (application-specific data).  
2. **Addressing (Tag Filter):**  
   - Each event includes a Nostr tag `['p', <recipientHexPubkey>]`.  
   - Relays support subscription filters like `{ kinds: [30078], '#p': [recipientHex] }` to deliver only messages intended for that service.  
3. **Encryption (NIP-04):**  
   - Payloads are encrypted with the sender’s private key and the recipient’s public key.  
   - Only the intended recipient can decrypt the content.  
4. **Standard Payload Envelope:**  
   ```json
   {
     "call":     "npub1…",         // Recipient NPub (also used in the p-tag)
     "response": "npub1…",         // Where to send any response
     "payload":  "<encrypted_str>" // NIP-04 encrypted JSON string
   }
   ```

---

## 3. Workflow

### 3.1 Sender Service

1. Construct a JSON command object:  
   ```json
   { "cmd": "doSomething", "params": {…} }
   ```  
2. Identify:
   - **callNpub:** Recipient’s NPub  
   - **responseNpub:** NPub for responses/ack  
3. Encrypt the payload using NIP-04.  
4. Wrap in the envelope and publish a kind `30078` event with:
   - **content:** JSON envelope  
   - **tags:** `[['p', recipientHexPubkey]]`  
5. Relay delivers to subscribers matching the tag filter.

### 3.2 Recipient Service

1. Subscribe on Nostr relays with filter:  
   ```js
   { kinds: [30078], '#p': [myHexPubkey] }
   ```  
2. On each incoming event:
   - Parse the outer JSON envelope.  
   - Verify `call` matches own NPub.  
   - Decrypt `payload` with NIP-04 using own private key and `event.pubkey`.  
   - Parse the decrypted JSON command.  
   - Execute the requested action.  
   - (Optional) Publish a response back to `response` NPub using the same mechanism.

---

## 4. Implementation in `nctool`

- **Sending (API):** `POST /action/encrypted`  
  - Controller `publishEncryptedActionController` handles:
    - validating `senderNpub`, `callNpub`, `responseNpub`, `payload`  
    - calling service `publishEncryptedEvent()` to encrypt, tag, and publish via NDK.  
- **Receiving (Stream):** SSE endpoints `/stream/start` and `/stream/events/:id`  
  - `startSession(npubs)` subscribes with a `#p` tag filter for those NPub recipients.  
  - `streamEvents` decrypts each event server-side and pushes SSE messages of type `decryptedAction` with clear payloads.  
- **Identity:** `identity.service.js` manages key storage (`nsec`/`npub`) for encryption and decryption.

---

## 5. Extensions & Considerations

- **Authorization/Gating:** Require an upstream Zap or payment before a service processes a command.  
- **Response Patterns:** Services can publish encrypted replies back to `responseNpub`.  
- **Error Handling:** Define conventions for invalid payloads or failed decryption (e.g., SSE error messages).  
- **Composability:** Chain multiple services by wiring responses of one service as `call` for another, enabling complex, decentralized workflows.

---

By standardizing on encrypted kind 30078 events and relay‐level `p`-tag filtering, NostrMQ offers a resilient, globally distributed message queue for building modular, permissioned services on top of the Nostr network.
