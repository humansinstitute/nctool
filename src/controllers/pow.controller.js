import { mineEventPow } from '../services/pow.service.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';

/**
 * HTTP handler for mining proof-of-work on a raw Nostr event.
 */
export const minePowController = asyncHandler(async (req, res) => {
    const { rawEvent, difficulty = Number(process.env.POW_BITS) || 20 } = req.body;
    if (!rawEvent) {
        return res.status(400).json({ error: 'rawEvent is required' });
    }
    const mined = await mineEventPow(rawEvent, difficulty);
    res.json({ mined });
});
