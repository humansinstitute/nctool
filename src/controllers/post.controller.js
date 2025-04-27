import { connect } from '../services/nostr.service.js';
import { mineEventPow } from '../services/pow.service.js';
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';

const DEFAULT_POW = Number(process.env.POW_BITS) || 20;
const DEFAULT_TIMEOUT = Number(process.env.TIMEOUT_MS) || 10000;

/**
 * Creates and publishes a new note (kind 1 by default).
 */
export async function createPost(req, res) {
    const { content, kind = 1 } = req.body;
    const powBits = DEFAULT_POW;
    const timeout = DEFAULT_TIMEOUT;

    const { ndk } = await connect();
    const evt = new NDKEvent(ndk, { kind, content });
    await evt.sign();

    const minedRaw = await mineEventPow(evt, powBits);
    const minedEvt = new NDKEvent(ndk, minedRaw);
    await minedEvt.sign();

    try {
        const okRelays = await minedEvt.publish(undefined, timeout);
        res.json({ id: minedEvt.id, relays: [...okRelays].map(r => r.url) });
    } catch (err) {
        err.status = err.status || 500;
        throw err;
    }
}

/**
 * Retrieves the latest 10 notes by the current keypair.
 */
export async function viewPosts(req, res) {
    const timeoutSec = DEFAULT_TIMEOUT / 1000;
    let kinds;
    if (req.query.kind) {
        kinds = [parseInt(req.query.kind, 10)];
    } else {
        kinds = [0, 1];
    }

    const { ndk, npub } = await connect();
    const { data: pubHex } = nip19.decode(npub);

    const filter = {
        authors: [pubHex],
        kinds,
        limit: 10
    };

    const events = await ndk.fetchEvents(filter, { timeoutSec });
    const sorted = [...events].sort((a, b) => b.created_at - a.created_at);

    res.json(sorted.map(e => ({
        id: e.id,
        kind: e.kind,
        content: e.content,
        created_at: e.created_at
    })));
}
