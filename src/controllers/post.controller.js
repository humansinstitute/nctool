import { connect } from '../services/nostr.service.js';
import { mineEventPow } from '../services/pow.service.js';
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { getAllKeys } from '../services/identity.service.js';

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
    if (!npub || !content) {
        return res.status(400).json({ error: 'npub and content are required' });
    }
    const keys = getAllKeys();
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
