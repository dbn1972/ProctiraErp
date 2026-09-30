import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PRC-H003: the gateway enforces break-glass dual control; the console must report its verdict
 * (403 self-approval, 409 wrong state) instead of silently revalidating.
 */
const gatewayFetch = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock('@/lib/api/gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
  GATEWAY_UNREACHABLE_WRITE_ERROR: 'Gateway unreachable (test)',
}));
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { sub: 'sub-op', email: 'op@proctira.org' } }),
}));

import { breakGlassDecisionAction } from './actions';

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

describe('breakGlassDecisionAction (PRC-H003)', () => {
  beforeEach(() => {
    gatewayFetch.mockReset();
    redirect.mockClear();
  });

  it('does not pre-fetch the request; the gateway decides', async () => {
    gatewayFetch.mockResolvedValue({ status: 200, ok: true, data: {} });
    await breakGlassDecisionAction(form({ id: 'bg_1', decision: 'approve', reason: 'ok' }));
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expect(gatewayFetch.mock.calls[0]?.[0]).toBe('/break-glass/bg_1/approve');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('surfaces a gateway self-approval rejection', async () => {
    gatewayFetch.mockResolvedValue({
      status: 403,
      ok: false,
      data: null,
      error: { code: 'SELF_APPROVAL_FORBIDDEN', message: 'no' },
    });
    await expect(
      breakGlassDecisionAction(form({ id: 'bg_1', decision: 'approve', reason: 'ok' })),
    ).rejects.toThrow('REDIRECT:/break-glass/requests?blocked=own-request');
  });

  it('surfaces a gateway invalid-state rejection', async () => {
    gatewayFetch.mockResolvedValue({
      status: 409,
      ok: false,
      data: null,
      error: { code: 'INVALID_STATE', message: 'denied' },
    });
    await expect(
      breakGlassDecisionAction(form({ id: 'bg_1', decision: 'approve', reason: 'ok' })),
    ).rejects.toThrow('REDIRECT:/break-glass/requests?blocked=invalid-state');
  });
});
