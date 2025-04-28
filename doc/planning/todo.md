# Planning & TODO

## API Abstraction for Client Actions

**Context:** In implementing the remote signing feature (client mode '5'), the client currently uses the generic `POST /action/encrypted` endpoint to send the `signed` response back via NostrMQ.

**Task:** Abstract this interaction behind a more specific API endpoint.

**Plan:**

1.  **Define API Endpoint:** Create a new, dedicated API endpoint, potentially `POST /mq/respond` or similar.
    *   This endpoint should clearly define parameters needed for sending a NostrMQ response, such as:
        *   `senderNpub` (who is sending the response)
        *   `recipientNpub` (original requester, who receives the response)
        *   `threadID` (from the original request)
        *   `responsePayload` (the actual content of the response message, e.g., `{ action: 'signed', ... }`)
    *   The API handler will be responsible for:
        *   Generating a new `callID`.
        *   Getting the current `timestamp`.
        *   Constructing the full NostrMQ message structure.
        *   Encrypting the message payload using NIP-04 for the `recipientNpub`.
        *   Publishing the encrypted Kind 4 event.
2.  **Update Client:** Modify the client (`index.js`, specifically the `tailEvents` function) to call this new endpoint instead of `POST /action/encrypted` when sending the `signed` response.
3.  **Update Documentation:** Update `doc/apiLayer.md` and any other relevant documents.

**Benefits:**
*   Simplifies client logic by removing the need to manually construct the full NostrMQ message structure.
*   Creates a clearer API contract for sending NostrMQ responses.
*   Encapsulates encryption and publishing logic within the API layer.

---

## API Endpoint for Broadcasting Pre-Signed Events

**Context:** The client needs to broadcast events received via NostrMQ that have already been signed (e.g., after receiving an `action: "signed"` message).

**Task:** Create an API endpoint that accepts a complete, signed Nostr event object and publishes it to the configured relays.

**Plan:**

1.  **Define API Endpoint:** Create `POST /post/broadcast`.
    *   Request Body: `{ "event": SignedNostrEventObject }`
    *   The API handler will:
        *   Validate the received event object (optional but recommended).
        *   Connect to Nostr relays (using `nostr.service.js`).
        *   Publish the event object directly.
        *   Return success/failure status and potentially relay publish results.
2.  **Update Client:** Modify the client (`index.js`, `tailEvents`) to call `POST /post/broadcast` when it receives an `action: "signed"` message.
3.  **Update Documentation:** Add the new endpoint to `doc/apiLayer.md`.

**Benefits:**
*   Provides a standard way to publish events that were signed externally or received via other channels.
*   Keeps relay interaction logic within the API layer.
