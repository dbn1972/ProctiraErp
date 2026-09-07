import { describe, expect, it, vi } from 'vitest';

import {
  hasConfiguredProbes,
  loadStatusSnapshot,
  probeUrl,
  readStatusProbeUrlsFromEnv,
} from './status-probes.js';

describe('status probes', () => {
  it('treats missing STATUS_PROBE_* as prelaunch (honest)', async () => {
    const urls = readStatusProbeUrlsFromEnv({});
    expect(hasConfiguredProbes(urls)).toBe(false);
    const snapshot = await loadStatusSnapshot(urls);
    expect(snapshot.mode).toBe('prelaunch');
    expect(snapshot.probedAt).toBeNull();
    expect(snapshot.probes).toEqual({});
  });

  it('probes configured URLs and records ok/degraded/unreachable', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('web')) return new Response('ok', { status: 200 });
      if (url.includes('api')) return new Response('bad', { status: 503 });
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const snapshot = await loadStatusSnapshot(
      {
        web: 'http://web.example/api/health',
        api: 'http://api.example/health',
        auth: 'http://auth.example/health',
      },
      { fetchImpl, now: () => new Date('2026-09-07T18:00:00.000Z') },
    );

    expect(snapshot.mode).toBe('probed');
    expect(snapshot.probedAt).toBe('2026-09-07T18:00:00.000Z');
    expect(snapshot.probes).toEqual({
      web: 'ok',
      api: 'degraded',
      auth: 'unreachable',
    });
  });

  it('maps non-500 failure responses to degraded (not invented ok)', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    await expect(probeUrl('http://auth.example/login', fetchImpl)).resolves.toBe('degraded');
  });
});
