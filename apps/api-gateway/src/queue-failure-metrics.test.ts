/**
 * PRC-H086: queue consumer failures are exported as a Prometheus counter on the gateway
 * metrics registry (labels: job type + disposition; never tenant or message ids).
 */
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  QUEUE_CONSUMER_FAILURES_METRIC,
} from '@proctira/queue-abstraction';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

function config(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 1000 },
    cors: { origins: ['http://localhost:3000'], methods: ['GET'], credentials: true },
    jwt: {
      secret: 'test-secret-key-for-testing-only',
      issuer: 'proctira-test',
      audience: 'proctira-test-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: { baseDomain: 'proctira.org', headerName: 'x-tenant-id' },
    services: {
      auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
    },
  };
}

async function waitFor(pred: () => Promise<boolean>, timeoutMs = 3000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return pred();
}

describe('PRC-H086 queue consumer failure metric', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ config: config() });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('counts retried and dead-lettered deliveries by type and disposition', async () => {
    const store = new InMemoryDurableQueueStore();
    const queue = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await queue.connect();
    try {
      await queue.subscribe({ topic: 'tenant.*.metric.test', groupId: 'g' }, async () => {
        throw new Error('handler boom');
      });
      await queue.dispatch({
        id: 'm-1',
        tenantId: 't-metric',
        type: 'metric.test',
        payload: {},
        timestamp: new Date().toISOString(),
        metadata: { maxRetries: 1 },
      });
      const metrics = (app as unknown as { metrics: { metrics(): Promise<string> } }).metrics;
      const seen = await waitFor(async () => {
        const text = await metrics.metrics();
        return text.includes('disposition="dead-letter"');
      });
      expect(seen).toBe(true);
      const text = await metrics.metrics();
      expect(text).toContain(QUEUE_CONSUMER_FAILURES_METRIC);
      expect(text).toMatch(/type="metric\.test"/);
      expect(text).toMatch(/disposition="retry"/);
      expect(text).not.toContain('t-metric');
    } finally {
      await queue.disconnect();
    }
  });
});
