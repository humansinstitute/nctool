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
      this.subscription = receive({
        relays: this.relays,
        onMessage: async (payload, sender, rawEvent) => {
          try {
            await this.handleMessage(payload, sender, rawEvent);
          } catch (e) {
            logger.error({ msg: 'Error in onMessage handler', error: e.message });
          }
        },
      });

      // Console output: clearly formatted, with line breaks
      console.log('NostrMQ Listening');
      console.log(`NPUB: ${this.npub}`);
      console.log(`HEX: ${this.pubkeyHex}`);
      console.log(`RELAYS: ${this.relays.join(', ')}`);

      logger.info({ msg: 'NostrMQ listener started', relays: this.relays, npub: this.npub, pubkeyHex: this.pubkeyHex });
    } catch (err) {
      logger.error({ msg: 'Failed to start NostrMQ receive', error: err.message });
      throw err;
    }
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
    logger.info({ msg: 'NostrMQ message received', payload, senderHex });
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
      logger.error({ msg: 'Error processing NostrMQ message', error: err.message });
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
      if (this.subscription && typeof this.subscription.close === 'function') {
        this.subscription.close();
      }
    } catch {
      // ignore
    } finally {
      this.subscription = null;
      this.isInitialized = false;
    }
  }
}

export default NostrMQService;