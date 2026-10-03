/**
 * PRC-H078: dedicated privacy worker runtime (workers/privacy) + PRIVACY_WORKERS=external.
 * The gateway-side plugin only publishes; the runtime consumes and reports health.
 */
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
} from '@proctira/queue-abstraction';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readPrivacyWorkersMode,
  startPrivacyWorkerHealthServer,
  type PrivacyWorkerRuntime,
} from './privacy-worker-runtime.js';
import {
  buildSplit,
  executeErasure,
  waitForTerminalJob,
} from './privacy-worker-runtime.test-helpers.js';

describe('PRC-H078 dedicated privacy worker runtime', () => {
  let app: FastifyInstance | undefined;
  let runtime: PrivacyWorkerRuntime | undefined;
  afterEach(async () => {
    await runtime?.stop();
    await app?.close();
    app = undefined;
    runtime = undefined;
  });

  it('PRIVACY_WORKERS defaults to in-process; only "external" switches', () => {
    expect(readPrivacyWorkersMode({})).toBe('in-process');
    expect(readPrivacyWorkersMode({ PRIVACY_WORKERS: 'External ' })).toBe('external');
    expect(readPrivacyWorkersMode({ PRIVACY_WORKERS: 'yes' })).toBe('in-process');
  });

  it('gateway publishes only; the dedicated runtime drives the job to completed', async () => {
    const store = new InMemoryDurableQueueStore();
    const mk = () => new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    const built = await buildSplit({ publisher: mk(), anonymization: mk(), offboard: mk() });
    app = built.app;
    runtime = built.runtime;
    expect(app.privacyWorkers).toBeUndefined();
    const started = await executeErasure(app);
    expect(started.status).toBe('in_progress');
    expect(store.pendingCount).toBe(1); // no gateway consumer took it
    expect(runtime.health().ok).toBe(false);
    await runtime.start();
    expect(runtime.health().ok).toBe(true);
    expect((await waitForTerminalJob(app))?.status).toBe('completed');
  });

  it('health endpoint answers 200 when consumers run and 503 after stop', async () => {
    const store = new InMemoryDurableQueueStore();
    const mk = () => new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    const built = await buildSplit({ publisher: mk(), anonymization: mk(), offboard: mk() });
    app = built.app;
    runtime = built.runtime;
    await runtime.start();
    const server = await startPrivacyWorkerHealthServer(runtime, 0, '127.0.0.1');
    try {
      const { port } = server.address() as { port: number };
      const ok = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(ok.status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404);
      await runtime.stop();
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(503);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
