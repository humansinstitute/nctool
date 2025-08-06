import WebSocket from 'ws';
globalThis.WebSocket = WebSocket;

import 'dotenv/config';
import { app } from './app.js';
import connectDB from './config/db.js';
import NostrMQService from './services/nostrmq.service.js';

// Connect to MongoDB
connectDB();

// Attempt to start NostrMQ Remote API (graceful degradation on failure)
(async () => {
  try {
    const nostrMq = new NostrMQService();
    await nostrMq.initialize();
    await nostrMq.start();
    // Readiness logs are printed within the service (NPUB, HEX, RELAYS)
  } catch (err) {
    console.warn('⚠️  NostrMQ failed to start, continuing without remote API:', err.message || err);
  }
})();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on ${PORT}`));
