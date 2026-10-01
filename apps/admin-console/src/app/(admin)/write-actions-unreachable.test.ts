import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PRC-H002: every privileged server action must fail — not revalidate as if it succeeded — when
 * the gateway is unreachable (gatewayFetch status 0). Only the transport and Next.js runtime are
 * mocked; the real action and lib/api helper code runs.
 */
const gatewayFetch = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/lib/api/gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
  GATEWAY_UNREACHABLE_WRITE_ERROR: 'Gateway unreachable (test)',
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('@/lib/auth/server', () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { email: 'approver@example.org', sub: 'u-2' } }),
}));

import { breakGlassDecisionAction } from './break-glass/actions';
import { updateEntitlementsAction } from './plans/actions';
import { pluginDecisionAction } from './plugins/actions';
import { themeDecisionAction } from './themes/actions';

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

describe('privileged server actions with an unreachable gateway (PRC-H002)', () => {
  beforeEach(() => {
    gatewayFetch.mockReset().mockResolvedValue({ status: 0, ok: false, data: null });
    revalidatePath.mockReset();
  });

  it('plan entitlements update throws and does not revalidate', async () => {
    await expect(
      updateEntitlementsAction(form({ planId: 'plan_pilot', 'entitlement.core': 'on' })),
    ).rejects.toThrow('Gateway unreachable (test)');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('theme decision throws and does not revalidate', async () => {
    await expect(
      themeDecisionAction(form({ id: 'thm_001', action: 'approve', reason: 'ok' })),
    ).rejects.toThrow('Gateway unreachable (test)');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('break-glass deny throws and does not revalidate', async () => {
    await expect(
      breakGlassDecisionAction(form({ id: 'bg_001', decision: 'deny', reason: 'no' })),
    ).rejects.toThrow('Gateway unreachable (test)');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('plugin decision returns an error state and does not revalidate', async () => {
    const state = await pluginDecisionAction(
      {},
      form({ id: 'plg_001', action: 'revoke', reason: 'security review' }),
    );
    expect(state).toMatchObject({ error: 'Gateway unreachable (test)' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
