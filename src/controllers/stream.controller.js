import { asyncHandler } from '../middlewares/asyncHandler.js';
import { startSession, getSession, stopSession } from '../services/stream.service.js';

export const startStream = asyncHandler(async (req, res) => {
    const { npub } = req.body ?? {};
    const sessionId = await startSession(npub);
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
