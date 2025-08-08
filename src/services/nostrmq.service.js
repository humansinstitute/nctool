import { send, receive } from 'nostrmq';
import { nip19 } from 'nostr-tools';
import { logger } from '../utils/logger.js';
import { getAllKeys } from './identity.service.js';
import { postNoteService } from '../controllers/post.controller.js';

const DEFAULT_RELAYS = ['wss://relay.damus.io'];

export class NostrMQService {
  constructor() {
    this.subscription = null;
    this.isInitialized = false;
    this.pubkeyHex = null;
    this.relays = process.env.NOSTRMQ_RELAYS
      ? process.env.NOSTRMQ_RELAYS.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_RELAYS;

    // Enforce allowlist from env to avoid accidental connections to removed relays
    const allowset = new Set(this.relays);
    this.relays = Array.from(allowset); // dedupe defensively

    // Duplicate tracking configuration
    this.enableDeduplication = process.env.NOSTRMQ_ENABLE_DEDUP !== 'false'; // Default: enabled
    this.sinceHours = parseInt(process.env.NOSTRMQ_SINCE_HOURS || '24', 10); // Default: 24 hours
    this.maxCacheSize = parseInt(process.env.NOSTRMQ_MAX_CACHE_SIZE || '10000', 10); // Default: 10k events

    // In-memory cache for processed event IDs
    this.processedEvents = new Set();
    this.eventTimestamps = new Map(); // Track when events were processed for cleanup
  }

  async initialize() {
    try {
      const npub = process.env.NOSTR_MQ_CALL;
      if (!npub) {
        throw new Error('NOSTR_MQ_CALL not configured');
      }
      const decoded = nip19.decode(npub);
      if (decoded.type !== 'npub') {
        throw new Error('NOSTR_MQ_CALL must be an npub');
      }
      const pubkeyHex = decoded.data;
      this.pubkeyHex = pubkeyHex;
      this.npub = npub;

      // Verify we have a private key stored for this npub
      const keys = await getAllKeys();
      const keyObj = keys.find((k) => k.npub === npub);
      if (!keyObj) {
        throw new Error('Private key not found for configured NOSTR_MQ_CALL npub');
      }

      this.isInitialized = true;

      // Console output: clearly formatted, with line breaks
      console.log('NostrMQ Ready');
      console.log(`NPUB: ${this.npub}`);
      console.log(`HEX: ${this.pubkeyHex}`);
      console.log(`RELAYS: ${this.relays.join(', ')}`);

      logger.info({
        msg: 'NostrMQ initialized',
        relays: this.relays,
        npub: this.npub,
        pubkeyHex: this.pubkeyHex
      });
    } catch (err) {
      logger.error({ msg: 'NostrMQ initialization failed', error: err.message });
      throw err;
    }
  }

  async start() {
    if (!this.isInitialized) {
      throw new Error('NostrMQ service not initialized');
    }
    try {
      // Configure receive options with duplicate tracking
      const receiveOptions = {
        relays: this.relays,
        onMessage: async (payload, sender, rawEvent) => {
          try {
            await this.handleMessage(payload, sender, rawEvent);
          } catch (e) {
            logger.error({ msg: 'Error in onMessage handler', error: e.message });
          }
        },
      };

      // Add duplicate tracking options if enabled
      if (this.enableDeduplication) {
        receiveOptions.since = this.getSinceTimestamp();
        receiveOptions.deduplication = true;
        receiveOptions.persistState = true;
      }

      this.subscription = receive(receiveOptions);

      // Start cleanup interval for in-memory cache
      this.startCleanupInterval();

      // Console output: clearly formatted, with line breaks
      console.log('NostrMQ Listening');
      console.log(`NPUB: ${this.npub}`);
      console.log(`HEX: ${this.pubkeyHex}`);
      console.log(`RELAYS: ${this.relays.join(', ')}`);
      console.log(`DEDUPLICATION: ${this.enableDeduplication ? 'enabled' : 'disabled'}`);
      if (this.enableDeduplication) {
        console.log(`SINCE: ${this.sinceHours} hours ago`);
      }

      logger.info({
        msg: 'NostrMQ listener started',
        relays: this.relays,
        npub: this.npub,
        pubkeyHex: this.pubkeyHex,
        deduplication: this.enableDeduplication,
        sinceHours: this.sinceHours
      });
    } catch (err) {
      logger.error({ msg: 'Failed to start NostrMQ receive', error: err.message });
      throw err;
    }
  }

  getSinceTimestamp() {
    // Calculate timestamp for "since" parameter (N hours ago)
    const hoursAgo = new Date();
    hoursAgo.setHours(hoursAgo.getHours() - this.sinceHours);
    return Math.floor(hoursAgo.getTime() / 1000);
  }

  startCleanupInterval() {
    // Clean up old entries from in-memory cache every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupProcessedEvents();
    }, 60 * 60 * 1000); // 1 hour
  }

  cleanupProcessedEvents() {
    const cutoffTime = Date.now() - (this.sinceHours * 60 * 60 * 1000);
    let cleanedCount = 0;

    for (const [eventId, timestamp] of this.eventTimestamps.entries()) {
      if (timestamp < cutoffTime) {
        this.processedEvents.delete(eventId);
        this.eventTimestamps.delete(eventId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info({
        msg: 'Cleaned up old processed events',
        cleanedCount,
        remainingCount: this.processedEvents.size
      });
    }
  }

  isEventProcessed(eventId) {
    return this.processedEvents.has(eventId);
  }

  markEventProcessed(eventId) {
    // Prevent cache from growing too large
    if (this.processedEvents.size >= this.maxCacheSize) {
      // Remove oldest 10% of entries
      const entriesToRemove = Math.floor(this.maxCacheSize * 0.1);
      const sortedEntries = Array.from(this.eventTimestamps.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(0, entriesToRemove);

      for (const [eventId] of sortedEntries) {
        this.processedEvents.delete(eventId);
        this.eventTimestamps.delete(eventId);
      }
    }

    this.processedEvents.add(eventId);
    this.eventTimestamps.set(eventId, Date.now());
  }

  removeEventProcessed(eventId) {
    this.processedEvents.delete(eventId);
    this.eventTimestamps.delete(eventId);
  }

  validateMessage(payload) {
    if (!payload || typeof payload !== 'object') {
      return { valid: false, error: 'Invalid payload format' };
    }
    if (!payload.action || typeof payload.action !== 'string') {
      return { valid: false, error: 'Missing or invalid action field' };
    }
    if (!payload.data || typeof payload.data !== 'object') {
      return { valid: false, error: 'Missing or invalid data field' };
    }
    const supportedActions = ['/post/note'];
    if (!supportedActions.includes(payload.action)) {
      return { valid: false, error: `Unsupported action: ${payload.action}` };
    }
    return { valid: true };
  }

  async handleMessage(payload, senderHex, rawEvent) {
    // Check for duplicate events if deduplication is enabled
    if (this.enableDeduplication && rawEvent && rawEvent.id) {
      if (this.isEventProcessed(rawEvent.id)) {
        logger.info({
          msg: 'Skipping duplicate NostrMQ event',
          eventId: rawEvent.id,
          senderHex,
          cacheSize: this.processedEvents.size
        });
        return;
      }

      // Mark event as processed before handling to prevent race conditions
      this.markEventProcessed(rawEvent.id);
    }

    logger.info({
      msg: 'NostrMQ message received',
      payload,
      senderHex,
      eventId: rawEvent?.id,
      isDuplicate: false
    });

    const validation = this.validateMessage(payload);
    if (!validation.valid) {
      await this.sendErrorResponse(senderHex, payload.action || 'unknown', validation.error);
      return;
    }

    const { action, data } = payload;
    try {
      switch (action) {
        case '/post/note': {
          const result = await postNoteService({
            npub: data.npub,
            content: data.content,
            powBits: data.powBits,
            timeoutMs: data.timeoutMs,
          });
          await this.sendSuccessResponse(senderHex, action, result);
          break;
        }
        default:
          await this.sendErrorResponse(senderHex, action, `Unsupported action: ${action}`);
      }
    } catch (err) {
      // Remove from processed set on error to allow retry
      if (this.enableDeduplication && rawEvent && rawEvent.id) {
        this.removeEventProcessed(rawEvent.id);
      }

      logger.error({
        msg: 'Error processing NostrMQ message',
        error: err.message,
        eventId: rawEvent?.id,
        action: payload.action
      });
      
      const statusCode = err.status || 500;
      const code = statusCode === 400 ? 'ValidationError' : 'InternalError';
      await this.sendErrorResponse(senderHex, payload.action, err.message || 'Internal server error', code);
    }
  }

  async sendSuccessResponse(targetHex, action, data) {
    const response = {
      success: true,
      action,
      data,
    };
    try {
      await send({
        target: targetHex,
        payload: response,
        relays: this.relays,
      });
      logger.info({ msg: 'Sent NostrMQ success response', action });
    } catch (err) {
      logger.error({ msg: 'Failed to send NostrMQ success response', error: err.message });
    }
  }

  async sendErrorResponse(targetHex, action, message, code = 'Error') {
    const response = {
      success: false,
      action,
      error: {
        code,
        message,
      },
    };
    try {
      await send({
        target: targetHex,
        payload: response,
        relays: this.relays,
      });
      logger.warn({ msg: 'Sent NostrMQ error response', action, code, message });
    } catch (err) {
      logger.error({ msg: 'Failed to send NostrMQ error response', error: err.message });
    }
  }

  async stop() {
    try {
      // Clear cleanup interval
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }

      // Close subscription
      if (this.subscription && typeof this.subscription.close === 'function') {
        this.subscription.close();
      }

      // Clear in-memory caches
      this.processedEvents.clear();
      this.eventTimestamps.clear();

      logger.info({
        msg: 'NostrMQ service stopped',
        clearedCacheSize: this.processedEvents.size
      });
    } catch (err) {
      logger.error({ msg: 'Error stopping NostrMQ service', error: err.message });
    } finally {
      this.subscription = null;
      this.isInitialized = false;
    }
  }
}

export default NostrMQService;