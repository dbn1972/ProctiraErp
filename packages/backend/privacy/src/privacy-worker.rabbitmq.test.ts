/**
 * PRC-H078: broker-backed privacy erasure E2E. Runs only when RABBITMQ_URL is set (CI
 * integration-test job, via tools/scripts/run-broker-suites.sh): the gateway-side plugin
 * publishes to RabbitMQ and the dedicated worker runtime consumes until the job is terminal.
 */
import { randomUUID } from 'node:crypto';
import { RabbitMQAdapter } from '@proctira/queue-abstraction';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrivacyWorkerRuntime } from './privacy-worker-runtime.js';
import { buildSplit, executeErasure, waitForTerminalJob } from './privacy-worker-runtime.test-helpers.js';

const RABBITMQ_URL = process.env['RABBITMQ_URL'];

describe.skipIf(!RABBITMQ_URL)('PRC-H078 privacy erasure over RabbitMQ', () => {
  let app: FastifyInstance | undefined;
  let runtime: PrivacyWorkerRuntime | undefined;
  const adapters: RabbitMQAdapter[] = [];
  afterEach(async () => {
    await runtime?.stop();
    await app?.close();
    for (const a of adapters.splice(0)) await a.disconnect();
  });

  it('execute erasure -> worker consumes from the broker -> job completed', async () => {
    const exchange = `proctira.test.h078.${randomUUID().slice(0, 8)}`;
    const mk = () => {
      const a = new RabbitMQAdapter(
        // Worker queue names are fixed (groupId), so the DLX argument must be stable across runs.
        { url: RABBITMQ_URL!, exchange, deadLetterExchange: 'proctira.test.h078.dlx', durable: false },
        { depthSampleIntervalMs: 0 },
      );
      adapters.push(a);
      return a;
    };
    const built = await buildSplit({ publisher: mk(), anonymization: mk(), offboard: mk() });
    app = built.app;
    runtime = built.runtime;
    // Consumers bind first so the mandatory dispatch is routable.
    await runtime.start();
    expect(runtime.health().ok).toBe(true);
    const started = await executeErasure(app);
    expect(started.status).toBe('in_progress');
    expect((await waitForTerminalJob(app, 10_000))?.status).toBe('completed');
  });
});
