import { connect } from '../services/nostr.service.js';
import { mineEventPow } from '../services/pow.service.js';
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk';

const DEFAULT_POW = Number(process.env.POW_BITS) || 20;
const DEFAULT_TIMEOUT = Number(process.env.TIMEOUT_MS) || 10000;

export async function updateProfile(req, res) {
    const { name, about, picture } = req.body;
    const powBits = DEFAULT_POW;
    const timeout = DEFAULT_TIMEOUT;

    const { ndk } = await connect();
    const profileData = { name, about, ...(picture ? { picture } : {}) };
    const evt = new NDKEvent(ndk, {
        kind: NDKKind.Metadata,
        content: JSON.stringify(profileData)
    });
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
