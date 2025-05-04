import { connect, publishEncryptedEvent, buildTextNote } from '../services/nostr.service.js';
import { mineEventPow } from '../services/pow.service.js';
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { getAllKeys } from '../services/identity.service.js';
import pkg from 'uuid';
const { v4: uuidv4 } = pkg;

const DEFAULT_POW = Number(process.env.POW_BITS) || 20;
const DEFAULT_TIMEOUT = Number(process.env.TIMEOUT_MS) || 10000;

/**
 * Creates and publishes a new post (kind 1 by default).
 */
export const createPost = asyncHandler(async (req, res) => {
    const { content, kind = 1 } = req.body;
    const powBits = DEFAULT_POW;
    const timeout = DEFAULT_TIMEOUT;

    const { ndk } = await connect();
    const evt = new NDKEvent(ndk, { kind, content });
    await evt.sign();

    const minedRaw = await mineEventPow(evt, powBits);
    const minedEvt = new NDKEvent(ndk, minedRaw);
    await minedEvt.sign();

    const okRelays = await minedEvt.publish(undefined, timeout);
    res.json({ id: minedEvt.id, relays: [...okRelays].map(r => r.url) });
});

/**
 * Retrieves the latest 10 posts by the current keypair.
 */
export const viewPosts = asyncHandler(async (req, res) => {
    const timeoutSec = DEFAULT_TIMEOUT / 1000;
    let kinds;
    if (req.query.kind) {
        kinds = [parseInt(req.query.kind, 10)];
    } else {
        kinds = [0, 1];
    }

    const { ndk, npub: defaultNpub } = await connect();
    let pubHex;
    if (req.query.npub) {
        pubHex = nip19.decode(req.query.npub).data;
    } else {
        pubHex = nip19.decode(defaultNpub).data;
    }

    const filter = { authors: [pubHex], kinds, limit: 10 };
    const events = await ndk.fetchEvents(filter, { timeoutSec });
    const sorted = [...events].sort((a, b) => b.created_at - a.created_at);

    res.json(sorted.map(e => ({
        id: e.id,
        kind: e.kind,
        content: e.content,
        created_at: e.created_at
    })));
});

/**
 * HTTP handler to send a note (kind=Text) via API.
 */
export const sendNoteController = asyncHandler(async (req, res) => {
    const { npub, powBits = DEFAULT_POW, timeoutMs = DEFAULT_TIMEOUT, content } = req.body;
    console.log(`DEBUG sendNoteController: received npub=${npub}, content length=${content?.length}`);
    if (!npub || !content) {
        console.log('DEBUG sendNoteController: missing npub or content');
        return res.status(400).json({ error: 'npub and content are required' });
    }
    const keys = await getAllKeys();
    console.log(`DEBUG sendNoteController: getAllKeys returned ${keys.length} entries`);
    console.log('DEBUG sendNoteController: available npubs:', keys.map(k => k.npub));
    const keyObj = keys.find(k => k.npub === npub);
    if (!keyObj) throw new Error("Unknown npub for note");
    const { ndk } = await connect(keyObj);
    const noteEvent = new NDKEvent(ndk, { kind: NDKKind.Text, content });
    await noteEvent.sign();

    const minedRaw = await mineEventPow(noteEvent, powBits);
    const minedEv = new NDKEvent(ndk, minedRaw);
    await minedEv.sign();

    let okRelays;
    try {
        okRelays = await minedEv.publish(undefined, timeoutMs);
    } catch (err) {
        err.status = err.status || 500;
        throw err;
    }

    const { data: pubHex } = nip19.decode(npub);
    const filter = { authors: [pubHex], kinds: [0, 1], limit: 10 };
    const events = await ndk.fetchEvents(filter, { timeoutSec: DEFAULT_TIMEOUT / 1000 });
    const latestEvents = [...events]
        .sort((a, b) => b.created_at - a.created_at)
        .map(e => ({
            id: e.id,
            kind: e.kind,
            content: e.content,
            created_at: e.created_at
        }));

    res.json({
        relays: [...okRelays].map(r => r.url),
        latestEvents
    });
});

/**
 * HTTP handler to send a remote sign request via Nostr MQ.
 */
export const sendNoteRemoteController = asyncHandler(async (req, res) => {
    const { senderNpub, callNpub, responseNpub, signerNpub, noteContent } = req.body;
    const powBits = DEFAULT_POW;
    const timeoutMs = DEFAULT_TIMEOUT;
    if (!senderNpub || !callNpub || !responseNpub || !signerNpub || !noteContent) {
        return res.status(400).json({ error: 'senderNpub, callNpub, responseNpub, signerNpub and noteContent are required' });
    }
    const callID = uuidv4();
    const threadID = req.body.threadID || callID;
    const timestamp = Math.floor(Date.now() / 1000);
    // Construct a basic Kind 1 event
    const unsignedEvent = buildTextNote(noteContent);
    // Add the signer's pubkey
    try {
        const { type, data: signerPubkeyHex } = nip19.decode(signerNpub);
        if (type !== 'npub') {
            throw new Error('Invalid signerNpub format');
        }
        unsignedEvent.pubkey = signerPubkeyHex;
        console.log("DEBUG → unsignedEvent (with pubkey, before PoW):", unsignedEvent);
    } catch (e) {
        return res.status(400).json({ error: 'Invalid signerNpub provided', message: e.message });
    }
    // Construct and mine a basic Kind 1 event for proof-of-work
    const minedRaw = await mineEventPow(unsignedEvent, powBits);
    const eventPayloadString = JSON.stringify(minedRaw);
    const message = {
        callID,
        threadID,
        timestamp,
        payload: {
            action: 'sign',
            signerNPub: signerNpub,
            event: eventPayloadString
        }
    };
    const result = await publishEncryptedEvent(senderNpub, callNpub, responseNpub, message, powBits, timeoutMs);
    res.json({ callID, id: result.id, relays: result.relays });
});

// Broadcast a fully signed event to relays
export const broadcastEvent = asyncHandler(async (req, res) => {
    const { event } = req.body;
    if (!event) {
        return res.status(400).json({ error: 'event is required' });
    }
    const { ndk } = await connect();
    const ndkEvent = new NDKEvent(ndk, event);
    const okRelays = await ndkEvent.publish(undefined, DEFAULT_TIMEOUT);
    res.json({ id: ndkEvent.id, relays: [...okRelays].map(r => r.url) });
});
