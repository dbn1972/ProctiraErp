import { describe, expect, it, vi } from 'vitest';

import {
  createCachedSnapshotLoader,
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
    const fetchImpl = vi.fn(
      async () => new Response('nope', { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(probeUrl('http://auth.example/login', fetchImpl)).resolves.toBe('degraded');
  });
  it('does not follow redirects and reports a 302 as degraded, not ok', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 302, headers: { Location: '/login' } }),
    ) as unknown as typeof fetch;
    await expect(probeUrl('http://web.example/health', fetchImpl)).resolves.toBe('degraded');
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
      RequestInit | undefined;
    expect(init?.redirect).toBe('manual');
  });
  it('runs one probe set for repeated requests within the TTL', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    let t = 1_000;
    const load = createCachedSnapshotLoader(
      () =>
        loadStatusSnapshot(
          { web: 'http://web.example/h', api: 'http://api.example/h' },
          { fetchImpl: fetchImpl as unknown as typeof fetch },
        ),
      { ttlMs: 30_000, nowMs: () => t },
    );
    await load();
    await load();
    t += 29_000;
    await load();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    t += 2_000;
    await load();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
