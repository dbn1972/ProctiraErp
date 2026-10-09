/**
 * apps/web/src/lib/api/insights-source.test.ts
 *
 * PRC-L267 / NEW-g1b_web-001: a reached-but-failed gateway response must never
 * be labelled live ('gateway'). Denials (401/403) and other upstream errors
 * (4xx/5xx) classify as 'denied' / 'unavailable' so an empty list is never
 * presented as "no records exist".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { scaffoldSourceFromResponse, isLiveSource } from './insights-source';

vi.mock('./gateway', () => ({ gatewayFetch: vi.fn() }));
import { gatewayFetch } from './gateway';
import { listNotificationRules, listNotificationTemplates } from './notifications-rules.server';

const mockFetch = vi.mocked(gatewayFetch);

describe('scaffoldSourceFromResponse', () => {
  it('classifies a 2xx response as live gateway', () => {
    expect(scaffoldSourceFromResponse(true, 200)).toBe('gateway');
    expect(isLiveSource('gateway')).toBe(true);
  });
  it('classifies an unreachable gateway (status 0) as scaffold', () => {
    expect(scaffoldSourceFromResponse(false, 0)).toBe('scaffold');
  });
  it('classifies 401/403 as denied (not live)', () => {
    expect(scaffoldSourceFromResponse(false, 401)).toBe('denied');
    expect(scaffoldSourceFromResponse(false, 403)).toBe('denied');
    expect(isLiveSource('denied')).toBe(false);
  });
  it('classifies other upstream errors as unavailable (not live)', () => {
    expect(scaffoldSourceFromResponse(false, 404)).toBe('unavailable');
    expect(scaffoldSourceFromResponse(false, 500)).toBe('unavailable');
    expect(scaffoldSourceFromResponse(false, 502)).toBe('unavailable');
    expect(isLiveSource('unavailable')).toBe(false);
  });
});

describe('notification-rules provenance (NEW-g1b_web-001)', () => {
  beforeEach(() => mockFetch.mockReset());

  it('does not label a 403 denial as live gateway', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, data: null } as never);
    const rules = await listNotificationRules();
    expect(rules.rules).toEqual([]);
    expect(rules.source).toBe('denied');
    const templates = await listNotificationTemplates();
    expect(templates.source).toBe('denied');
  });

  it('does not label a 500 outage as live gateway', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, data: null } as never);
    const rules = await listNotificationRules();
    expect(rules.source).toBe('unavailable');
  });

  it('labels a 2xx response as live gateway', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, data: { data: [] } } as never);
    const rules = await listNotificationRules();
    expect(rules.source).toBe('gateway');
  });
});
