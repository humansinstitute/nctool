import { connect } from '../services/nostr.service.js';
import { nip19 } from 'nostr-tools';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { mineEventPow } from '../services/pow.service.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { publishEncryptedEvent } from '../services/nostr.service.js';

const DEFAULT_POW = Number(process.env.POW_BITS) || 0;
const DEFAULT_TIMEOUT = Number(process.env.TIMEOUT_MS) || 5000;

/**
 * HTTP handler to take action based on payload.
 */
export async function takeActionController(req, res) {
    const payload = req.body;
    if (payload.cmd !== 'pay') {
        console.log('No Action!');
        return res.status(200).json({ message: 'No action' });
    }

    const { target, amount } = payload;
    const { data: pubHex } = nip19.decode(target);

    const { ndk } = await connect();
    // Fetch the latest metadata event (kind 0) for this pubkey
    const filter = { authors: [pubHex], kinds: [0], limit: 1 };
    const events = await ndk.fetchEvents(filter, { timeoutSec: 5 });
    const sorted = [...events].sort((a, b) => b.created_at - a.created_at);
    const evt = sorted[0];

    let profileName = 'Unknown';
    if (evt && evt.content) {
        try {
            const data = JSON.parse(evt.content);
            if (data.name) {
                profileName = data.name;
            }
        } catch {
            // ignore parse errors
        }
    }

    console.log(`Paying ${profileName} - ${amount} sats`);
    return res.json({ name: profileName, amount });
}

/**
 * HTTP handler to publish encrypted action event (kind 30078).
 */
export const publishEncryptedActionController = asyncHandler(async (req, res) => {
    const {
        senderNpub,
        callNpub,
        responseNpub,
        payload,
        powBits = DEFAULT_POW,
        timeoutMs = DEFAULT_TIMEOUT
    } = req.body;

    if (!senderNpub || !callNpub || !responseNpub || !payload) {
        return res
            .status(400)
            .json({ error: 'senderNpub, callNpub, responseNpub and payload are required' });
    }

    const result = await publishEncryptedEvent(
        senderNpub,
        callNpub,
        responseNpub,
        payload,
        powBits,
        timeoutMs
    );
    return res.json(result);
});

/**
 * HTTP handler to publish action event (kind 30078).
 */
export const publishActionController = asyncHandler(async (req, res) => {
    const { dTag, payload, powBits = DEFAULT_POW, timeoutMs = DEFAULT_TIMEOUT } = req.body;
    if (!dTag || !payload) {
        return res.status(400).json({ error: 'dTag and payload are required' });
    }

    const { ndk, signer } = await connect();
    const baseEvent = new NDKEvent(ndk, {
        kind: 30078,
        tags: [['d', dTag]],
        content: JSON.stringify(payload)
    });
    await baseEvent.sign(signer);

    const minedRaw =
        powBits > 0 ? await mineEventPow(baseEvent, powBits) : baseEvent.rawEvent();
    const finalEv = powBits > 0 ? new NDKEvent(ndk, minedRaw) : baseEvent;

    if (powBits > 0) {
        await finalEv.sign(signer);
    }

    const okRelays = await finalEv.publish(undefined, timeoutMs);
    return res.json({ id: finalEv.id, relays: [...okRelays].map(r => r.url) });
});
