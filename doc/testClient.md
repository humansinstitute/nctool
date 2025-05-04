# Test Client Documentation

This document describes the workings of the `index.js` test client, which provides a CLI for interacting with the Nostr API layer (see `doc/apiLayer.md`). It covers flows for identity selection, profile updates, posting, viewing posts, publishing encrypted actions, real-time streaming, and error handling.

## Prerequisites

- Node.js (v14+)
- Dependencies:
  - axios
  - readline
  - eventsource
  - nostr-tools
- Install dependencies:

```bash
npm install axios readline eventsource nostr-tools
```

## Environment Variables

- `API_URL` (optional): Base URL for the API server (default: `http://localhost:3000`)
- `POW_BITS` (optional): Default proof-of-work difficulty (default: `20`)
- `TIMEOUT_MS` (optional): Default timeout for publishing events in milliseconds (default: `10000`)
- `IGNORE_OLD` (optional): Milliseconds threshold for ignoring old messages (default: `no limit`)

## Running the Client

```bash
node index.js
```

## Core Workflow

Upon execution, the client performs:

1. **Identity Selection**  
2. **Main Menu Loop**  

### 1. Identity Selection (`chooseKey`)

- Retrieves existing keypairs via `getAllKeys()`.
- If keys exist:
  - Lists keys and prompts:
    - Select by number (`1`, `2`, …)
    - Or type `n` to create a new user.
- If no keys found:
  - Prompts for a new user name and calls `generateKeyPair(name)`.
- Returns a `sessionKey` object:
  ```js
  {
    name,    // user-provided name
    privkey, // hex private key
    pubkey,  // hex public key
    nsec,    // nsec format
    npub     // npub format
  }
  ```

### 2. Main Menu

Displays:

```
Hello <name>, what would you like to do?
a) Update profile
b) Create a post
c) View last 10 posts
d) Publish encrypted action
f) Sign event remotely
5) Subscribe for Data Input
e) Exit
```

Prompts: `Enter a, b, c, d, f, 5 or e:`

#### Option a) Update Profile

1. Prompts for:
   - `Name`
   - `About`
   - `Picture URL` (optional)
2. Calls `POST /profile/update` with:
   ```json
   { npub, name, about, picture? }
   ```
3. Logs:
   ```
   Updated profile: <response data>
   ```
4. Fetches latest posts:
   ```
   GET /post/view10?npub=<npub>
   ```
5. Prints the latest 10 events.

#### Option b) Create a Post

1. Prompts: `Post content`
2. Connects to Nostr via `connect(sessionKey)`
3. Determines:
   - `powBits` (from `process.env.POW_BITS` or default `20`)
   - `timeoutMs` (from `process.env.TIMEOUT_MS` or default `10000`)
4. Calls `POST /post/note` with:
   ```json
   { npub, content, powBits, timeoutMs }
   ```
5. Logs:
   ```
   Created note: <response data>
   ```
6. Retrieves and prints latest 10 events again:
   ```
   GET /post/view10?npub=<npub>
   ```

#### Option c) View Last 10 Posts

1. Prompts: `Kind filter (default 1)`
2. Parses integer `kind` or defaults to `1`.
3. Calls:
   ```
   GET /post/view10?kind=<kind>&npub=<npub>
   ```
4. Prints each event:
   ```
   [<created_at>] <content> (id: <id>)
   ```
5. **Action Trigger**  
   If an event has `kind === 30078`:
   ```js
   const payload = JSON.parse(event.content);
   axios.post('/action/take', payload);
   ```

#### Option d) Publish encrypted action

1. Prompts:
   - `Call NPub (target):`
   - `Response NPub (default <sessionKey.npub>):`
   - `Enter JSON payload or leave blank for default`
2. Default payload:
   ```json
   {
     "cmd": "pay",
     "target": "<callNpub>",
     "amount": "21000"
   }
   ```
3. Parses input JSON, aborts on invalid JSON.
4. Calls:
   ```
   POST /action/encrypted
   ```
   with body:
   ```json
   {
     "senderNpub": "<sessionKey.npub>",
     "callNpub": "<callNpub>",
     "responseNpub": "<responseNpub>",
     "payload": { ... },
     "powBits": <powBits>,
     "timeoutMs": <timeoutMs>
   }
   ```
5. Logs:
   ```
   Encrypted action published: <response data>
   ```

#### Option f) Sign event remotely
1. Prompts:
   - `Call NPub (target, default npub1z54lfwx2v7vek7z79mkurm8nyrgjpmeanngx9m2fnc7qf53kv3sqjw8ex5):`
   - `Response NPub (default <sessionKey.npub>):`
   - `Signer NPub (default npub1py2a9kmpqjj45wapuw4gpwjjkt83ymr05grjh0xuwkgdtyrjzxdq8lpcdp):`
   - `Enter note content`
- `Client 2 signs the note using the private key corresponding to the specified signerNpub`
2. Calls:
   ```
   POST /post/note_remote
   ```
   with body:
   ```json
   {
     "senderNpub": "<sessionKey.npub>",
     "callNpub": "<callNpub>",
     "responseNpub": "<responseNpub>",
     "signerNpub": "<signerNpub>",
     "noteContent": "<noteContent>"
   }
   ```
3. Logs:
   ```
   Remote sign request sent: <response data>
   ```

#### Option 5) Subscribe for Data Input (`tailEvents`)

1. Retrieves all `npub` keys.
2. Calls `POST /stream/start` with `npubs` array (backend filters and decrypts for these npubs).
3. Receives `sessionId`.
4. Opens SSE:
   ```
   GET /stream/events/<sessionId>
   ```
5. On each `message`:
   - Parses the JSON message.
   - If `msg.type === 'decryptedAction'`:
     ```
     🆕 Decrypted payload from <senderNpub>: <payload>
         (Respond to: <responseNpub>)
     ```
   - Else logs raw message:
     ```
     🆕 Raw message: <msg>
     ```
6. Waits for keypress:
   - `q` or `Q`: stop and return to menu.
   - `Ctrl+C` / `Ctrl+D`: stop and exit.
7. Cleanup:
   - Close SSE connection
   - `DELETE /stream/stop/<sessionId>`
   - Restore terminal state

#### Option e) Exit

- Calls `process.exit(0)`

## Error Handling

- API calls wrapped in `try/catch`.
- On error:
  - If `err.response`: logs `err.response.data`
  - Else logs `err.message`
- Stream errors:
  - `EventSource.onerror`
  - Input errors on `stdin`
  - Cleanup failures log and exit.

## Helper Functions

- **`prompt(question)`**: wraps `readline` for async user input.
- **`chooseKey()`**: user/key selection logic.
- **`tailEvents()`**: SSE-based event subscription and keypress handling.
