
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { startSession, getSession, stopSession } from '../services/stream.service.js';

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

export const streamEvents = (req, res) => {
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
    const { sub, clients } = session;
    const push = (ev) => res.write(`data:${JSON.stringify(ev)}\n\n`);
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
