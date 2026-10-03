import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PRC-H002: with the gateway unreachable (gatewayFetch status 0), tenant provisioning must return
 * an error state and must not redirect; lifecycle actions must fail loudly, not revalidate.
 */
const gatewayFetch = vi.fn();
const redirect = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/lib/api/gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
  GATEWAY_UNREACHABLE_WRITE_ERROR: 'Gateway unreachable (test)',
}));
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...a) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('@/lib/auth/server', () => ({ requireRole: vi.fn().mockResolvedValue(undefined) }));

import { createTenantAction, tenantLifecycleAction } from './actions';

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

describe('tenant server actions with an unreachable gateway (PRC-H002)', () => {
  beforeEach(() => {
    gatewayFetch.mockReset().mockResolvedValue({ status: 0, ok: false, data: null });
    redirect.mockReset();
    revalidatePath.mockReset();
  });

  it('createTenantAction returns an error state and does not redirect', async () => {
    const state = await createTenantAction(
      {},
      form({
        name: 'New School',
        slug: 'new-school',
        contactEmail: 'ops@example.org',
        plan: 'pilot',
        region: 'eu-west-1',
      }),
    );
    expect(state.error).toBe('Gateway unreachable (test)');
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('tenantLifecycleAction throws instead of silently revalidating', async () => {
    await expect(
      tenantLifecycleAction(
        form({ id: 'tnt_001', action: 'suspend', reason: 'Customer requested suspension' }),
      ),
    ).rejects.toThrow('Gateway unreachable (test)');
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
