/**
 * PRC-H051: readiness must fail when the broker is disconnected or the worker
 * is not running, and succeed only when both are healthy.
 */
import { describe, it, expect } from 'vitest';

import { computeReadiness, startHealthServer } from './health-server.js';

describe('exam-document worker health probe (PRC-H051)', () => {
  it('is not ready when the worker is not running', () => {
    const r = computeReadiness({ running: false, isConnected: () => true });
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('worker-not-running');
  });

  it('is not ready when the broker is disconnected', () => {
    const r = computeReadiness({ running: true, isConnected: () => false });
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('broker-disconnected');
  });

  it('is ready when running and broker connected', () => {
    const r = computeReadiness({ running: true, isConnected: () => true });
    expect(r.ready).toBe(true);
    expect(r.reason).toBe('ok');
  });

  it('serves 200 on /health/ready when healthy and 503 when broker down', async () => {
    let connected = true;
    const handle = await startHealthServer({
      worker: { running: true, isConnected: () => connected },
      port: 0, // ephemeral
      host: '127.0.0.1',
    });
    try {
      const addr = handle.server.address();
      if (typeof addr !== 'object' || addr === null) throw new Error('no address');
      const base = `http://127.0.0.1:${addr.port}`;

      const live = await fetch(`${base}/health/live`);
      expect(live.status).toBe(200);

      const okReady = await fetch(`${base}/health/ready`);
      expect(okReady.status).toBe(200);

      connected = false;
      const downReady = await fetch(`${base}/health/ready`);
      expect(downReady.status).toBe(503);
      const body = (await downReady.json()) as { reason: string };
      expect(body.reason).toBe('broker-disconnected');
    } finally {
      await handle.close();
    }
  });
});
