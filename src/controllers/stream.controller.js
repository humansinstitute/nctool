
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { startSession, getSession, stopSession } from '../services/stream.service.js';
import { nip19, nip04 } from 'nostr-tools';
import { getAllKeys } from '../services/identity.service.js';

export const startStream = asyncHandler(async (req, res) => {
    // Expect an array of npubs in the request body
    const { npubs } = req.body ?? {};

    // Validate that npubs is an array if provided
    if (npubs && !Array.isArray(npubs)) {
        return res.status(400).json({ error: 'npubs must be an array of strings' });
    }

    // Pass the array (or undefined if not provided) to the service
    const sessionId = await startSession(npubs);
    res.json({ sessionId });
});

export const streamEvents = async (req, res) => {
    const { id } = req.params;
    const session = getSession(id);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    res.set({
        'Cache-Control': 'no-cache',
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive'
    }).flushHeaders();

    const { sub, clients, npubs } = session;
    const keys = await getAllKeys();

    const push = async (ev) => {
        try {
            // Parse event content
            const parsed = JSON.parse(ev.content);
            const { call, response, payload: encrypted } = parsed;
            // Only process if this event is addressed to one of the session npubs
            if (!npubs.includes(call)) return;
            // Find key object for this call NPub
            const keyObj = keys.find(k => k.npub === call);
            if (!keyObj) {
                console.error(`No key found for npub ${call}`);
                return;
            }
            // Decrypt payload
            const { data: privHex } = nip19.decode(keyObj.nsec);
            const decrypted = await nip04.decrypt(privHex, ev.pubkey, encrypted);
            let payloadObj;
            try {
                payloadObj = JSON.parse(decrypted);
            } catch {
                payloadObj = decrypted;
            }
            // Prepare SSE message
            const senderNpub = nip19.npubEncode(ev.pubkey);
            const message = {
                type: 'decryptedAction',
                data: {
                    payload: payloadObj,
                    senderNpub,
                    responseNpub: response,
                    timestamp: ev.created_at
                }
            };
            res.write(`data:${JSON.stringify(message)}\n\n`);
        } catch (err) {
            console.error('Error decrypting event:', err);
        }
    };

    sub.on('event', push);
    clients.push({ res, push });

    req.on('close', () => {
        sub.off('event', push);
        const idx = clients.findIndex(c => c.push === push);
        if (idx !== -1) clients.splice(idx, 1);
    });
};

export const stopStream = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const stopped = stopSession(id);
    res.json({ stopped });
});
