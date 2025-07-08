# Gateway Service Design

## 1. Overview

Gateway services encapsulate protocol‑specific details of external messaging or payment platforms and expose a uniform interface to application code. Gateways are responsible **only** for connection, message translation, sending, and receiving; all business logic (logging, billing, orchestration) is handled by consuming services.

Each inbound message is optionally `console.log()` ’ed (disabled in production) and immediately written to a RabbitMQ queue for parallel downstream processing.

---

## 2. Goals

* **Abstract** platform‑specific communication behind a common interface
* **Separate** protocol handling from application business logic
* **Isolate** third‑party SDKs and dependencies
* **Provide** a consistent lifecycle, error handling, retry, and **idempotency** patterns
* **Allow** application code to perform logging, billing, and routing
* **Enable** adding new gateways without touching core application modules

---

## 3. Core Concepts

### 3.1 Canonical Message

```ts
export interface IGatewayMessage<M = any> {
  id: string;                // Unique message identifier from the platform
  senderId: string;          // Identifier for the message sender
  conversationId: string;    // Chat or thread identifier
  timestamp: Date;           // When the message was received
  body: string;              // Message content
  metadata?: M;              // Raw platform payload (typed per‑gateway)
}
```

### 3.2 Rabbit Envelope

```ts
export interface GatewayEnvelope {
  gateway: 'whatsapp' | 'slack' | 'telegram' | string;
  message: IGatewayMessage;
  replyTo?: string;    // Queue/topic for async replies
  traceId?: string;    // For distributed tracing
}
```

Only `GatewayEnvelope` objects ever enter RabbitMQ.

### 3.3 Gateway Interface

```ts
export interface IGateway {
  initialize(cfg: Record<string, any>): Promise<void>;
  connect(): Promise<void>;
  send(payload: { recipientId: string; message: string }): Promise<void>;
  onMessage(fn: (msg: IGatewayMessage) => void): void;
  disconnect(): Promise<void>;
}
```

### 3.4 BaseGateway

A thin abstract base‑class handles configuration, common error flow, **idempotency cache**, and publishing to Rabbit.

```ts
export abstract class BaseGateway implements IGateway {
  protected config: Record<string, any>;
  private recentIds = new LRUCache<string, true>({ max: 10_000, ttl: 60 * 60 * 1000 }); // 1‑h window
  constructor(cfg: Record<string, any>, private publish: (env: GatewayEnvelope) => void) {
    this.config = cfg;
  }
  /* IGateway methods declared abstract … */
  protected emit(env: GatewayEnvelope) {
    // ***Idempotency check*** — discard already‑seen ids (reconnect safe)
    const key = `${env.gateway}:${env.message.id}`;
    if (this.recentIds.has(key)) return;           // throw away duplicate
    this.recentIds.set(key, true);
    if (process.env.NODE_ENV !== 'production') console.log(env);
    this.publish(env);
  }
  protected handleError(err: unknown) {/* central logging / metrics */}
}
```

> **Why in‑memory?**
> SDK reconnects often replay several seconds of backlog. Keeping a lightweight LRU in each gateway instance guarantees we drop duplicates without a network round‑trip. For clustered deployments swap this for Redis or another shared cache.

---

## 4. Lifecycle

1. **initialize(cfg)** – load credentials & set up SDK/client
2. **connect()** – establish session/handshake
3. **onMessage(handler)** – register inbound callback (calls `emit`)
4. **send(payload)** – deliver outbound message with platform rate‑limiting
5. **disconnect()** – close connections & flush metrics

Reconnections are handled by the SDK; duplicate protection lives in the LRU cache above.

---

## 5. Configuration

Environment‑driven (12‑factor). Example WhatsApp snippet:

```env
WHATSAPP_SESSION_DIR=./sessions
WHATSAPP_PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox
```

Use `convict` to merge env, YAML, and defaults into a typed `AppConfig` object.

---

## 6. Error Handling, Retries & Back‑pressure

* **Retryable transport errors** → exponential backoff with jitter.
* **Rate‑limits** → per‑gateway token‑bucket limiter in `send()`.
* **Errors** bubble via `handleError()` to a central log/sentry queue.

---

## 7. Idempotency & Duplicate Drop‑Logic

| Concern                       | Solution                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| SDK replay / reconnect        | 1‑hour LRU cache of `gateway:id` pairs (in‑memory or Redis).                                                                           |
| Consumer restarts / re‑queues | Message consumer writes `(gateway,id)` to a durable *message‑log* table or Redis set **before** processing; if present → `ack` & skip. |
| Outbound duplicates           | Outbound queues use the same `(gateway,id)` as the *correlationId* so idempotent clients can ignore repeats.                           |

---

## 8. Example — WhatsApp Gateway (excerpt)

```ts
import { BaseGateway } from './BaseGateway';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

export class WhatsAppGateway extends BaseGateway {
  private client!: Client;
  async initialize(cfg: any) {
    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: cfg.WHATSAPP_SESSION_DIR }),
      puppeteer: { args: cfg.WHATSAPP_PUPPETEER_ARGS.split(',') }
    });
    this.client.on('qr', qr => qrcode.generate(qr, { small: true }));
    this.client.on('auth_failure', err => this.handleError(err));
    this.client.on('message_create', waMsg => {
      if (waMsg.fromMe) return;
      this.emit({
        gateway: 'whatsapp',
        message: {
          id: waMsg.id._serialized,
          senderId: waMsg.from,
          conversationId: waMsg.chatId,
          timestamp: new Date(waMsg.timestamp * 1000),
          body: waMsg.body,
          metadata: waMsg._data
        }
      });
    });
  }
  async connect() { await this.client.initialize(); }
  async send(p: { recipientId: string; message: string }) {
    await this.client.sendMessage(p.recipientId, p.message);
  }
  onMessage() {/* no‑op — handled via Rabbit */}
  async disconnect() { await this.client.destroy(); }
}
```

---

## 9. Next Steps

1. Extract LRU cache into a tiny utility (`src/utils/recent‑ids.ts`) so other gateways & consumers re‑use it.
2. Swap to Redis if you deploy multiple instances behind a load balancer.
3. Extend CHANGELOG + README to reflect **Duplicate handling & idempotency**.
4. Add integration tests that simulate SDK reconnect & confirm duplicates are dropped.

---

## 10. Implementation Plan (Junior‑Friendly)

Each step now includes **Unit‑test tasks** using **Vitest** (fast, TS‑native) so the *Done‑when* is verifiable in CI. Install once at the start:

```bash
npm i -D vitest ts-node @types/node
```

Add a `test` script to *package.json*:

```json
"scripts": {
  "test": "vitest run"
}
```

---

### 10.1 Bootstrap the repo

1. `git clone <repo>` & `cd <repo>`
2. `npm install`

**Unit‑test task:** none (scaffold only).

**Done‑when:** `npm test` runs (even if it reports 0 tests) and `ts-node -v` prints a version.

---

### 10.2 Create local environment file

1. `cp env.example .env`
2. Fill in minimal vars:

   ```env
   WHATSAPP_SESSION_DIR=./sessions
   WHATSAPP_PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox
   RABBIT_URL=amqp://localhost
   ```
3. `mkdir -p ./sessions`

**Unit‑test task:** add `tests/env.test.ts`:

```ts
import { config } from 'dotenv';
config({ path: '.env' });
import { describe, it, expect } from 'vitest';

describe('ENV sanity', () => {
  it('loads required variables', () => {
    expect(process.env.WHATSAPP_SESSION_DIR).toBe('./sessions');
    expect(process.env.RABBIT_URL).toMatch(/^amqp:\/\//);
  });
});
```

**Done‑when:** `npm test` passes.

---

### 10.3 Add recent‑ids cache utility

1. `npm i lru-cache --save`
2. Create `src/utils/recent-ids.ts`:

   ```ts
   import LRU from 'lru-cache';
   export const recentIds = new LRU<string, true>({ max: 10_000, ttl: 3_600_000 });
   ```
3. **Unit‑test** `tests/recent-ids.test.ts`:

   ```ts
   import { recentIds } from '../src/utils/recent-ids';
   import { describe, it, expect } from 'vitest';

   describe('recentIds', () => {
     it('stores and retrieves a key', () => {
       recentIds.set('foo', true);
       expect(recentIds.has('foo')).toBe(true);
     });
     it('evicts after TTL', async () => {
       const key = 'bar';
       recentIds.set(key, true, { ttl: 10 }); // 10 ms override
       await new Promise(r => setTimeout(r, 20));
       expect(recentIds.has(key)).toBe(false);
     });
   });
   ```

**Done‑when:** tests pass and cover ≥ 90 % of the `recent-ids.ts` lines (Vitest prints coverage if you add `--coverage`).

---

### 10.4 Wire RabbitMQ publisher

1. `npm i amqplib --save`
2. Add `src/bus/rabbit.ts` (same as before)
3. **Unit‑test** with **testcontainers‑node** so no real Rabbit install needed:

   ```bash
   npm i -D @testcontainers/containers
   ```

   `tests/rabbit.test.ts`:

   ```ts
   import { GenericContainer } from '@testcontainers/containers';
   import { expect, describe, it, beforeAll, afterAll } from 'vitest';
   import { initRabbit, publish } from '../src/bus/rabbit';
   import amqp from 'amqplib';

   let stop: () => Promise<void>;
   beforeAll(async () => {
     const container = await new GenericContainer('rabbitmq:3-alpine')
       .withExposedPorts(5672)
       .start();
     process.env.RABBIT_URL = `amqp://localhost:${container.getMappedPort(5672)}`;
     stop = () => container.stop();
     await initRabbit();
   }, 20_000);

   afterAll(async () => { await stop(); });

   it('publishes a message', async () => {
     const env = { gateway: 'test', message: { id: '1', senderId: 'a', conversationId: 'c', timestamp: new Date(), body: 'hi' } } as any;
     publish(env);
     const conn = await amqp.connect(process.env.RABBIT_URL!);
     const ch = await conn.createChannel();
     const msg = await ch.get('inbound.messages', { noAck: true });
     expect(msg).toBeTruthy();
     const parsed = JSON.parse(msg!.content.toString());
     expect(parsed.message.id).toBe('1');
   });
   ```

**Done‑when:** Rabbit tests pass in CI (may take \~20 s to spin container).

---

### 10.5 Finish **BaseGateway**

Implement as before.

**Unit‑test** `tests/base-gateway.test.ts`:

```ts
import BaseGateway from '../src/gateways/BaseGateway';
import { describe, it, expect, vi } from 'vitest';
import { GatewayEnvelope } from '../src/types';

class Dummy extends BaseGateway {
  constructor(publish: (e: GatewayEnvelope) => void) {
    super({}, publish);
  }
  initialize(): any {}
  connect(): any {}
  send(): any {}
  onMessage(): any {}
  disconnect(): any {}
}

describe('BaseGateway emit()', () => {
  it('filters duplicates', () => {
    const spy = vi.fn();
    const gw  = new Dummy(spy);
    const env = { gateway: 'dummy', message: { id: 'x', senderId: 's', conversationId: 'c', timestamp: new Date(), body: 'b' } } as any;
    gw['emit'](env);
    gw['emit'](env); // duplicate
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

**Done‑when:** duplicate test passes.

---

### 10.6 Implement **WhatsAppGateway**

No unit tests (requires external WhatsApp API). Instead:

* Add **integration stub** under `tests/whatsapp.int.test.ts` wrapped with `describe.skip()` so CI ignores until credentials are provided.

**Done‑when:** `tsc` OK and build artefacts compile.

---

### 10.7 Add start script

Unit‑testing a CLI script is optional. Add `tests/start.test.ts` with a simple import to ensure it doesn’t throw:

```ts
import { expect, it } from 'vitest';

it('start-whatsapp compiles', () => {
  expect(() => require('../src/start-whatsapp')).not.toThrow();
});
```

**Done‑when:** test passes.

---

### 10.8 Create console consumer

Add `tests/consumer.test.ts` with a mocked `amqplib`:

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('amqplib', () => ({
  connect: vi.fn().mockResolvedValue({
    createChannel: async () => ({
      assertQueue: vi.fn(),
      consume: (_q: string, cb: any) => cb({ content: Buffer.from('{"x":1}') }),
    }),
  }),
}));

it('consumer logs a message', async () => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('../src/consumers/log');
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});
```

**Done‑when:** consumer test passes without hitting real Rabbit.

---

### 10.9 Manual test loop

Covered by integration; no automated test here.

---


