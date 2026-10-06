/**
 * PRC-M001 / PRC-M004 / PRC-M005: server actions validate every form value that becomes a
 * gateway path segment, enforce the role area before any gateway call, and never issue a
 * fetch for traversal payloads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRole = vi.fn();
vi.mock('@/lib/auth/server', () => ({
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { breakGlassDecisionAction } from './break-glass/actions';
import { updateEntitlementsAction } from './plans/actions';
import { pluginDecisionAction } from './plugins/actions';
import { tenantLifecycleAction } from './tenants/actions';
import { themeDecisionAction } from './themes/actions';

const fetchMock = vi.fn();

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const REASON = 'Customer requested suspension in ticket 4411';

beforeEach(() => {
  requireRole.mockReset();
  requireRole.mockResolvedValue({ user: { platformRole: 'platform_owner' } });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

const TRAVERSAL_IDS = ['../../plugins/plg_001', 'tnt_001/../x', 'a/b', '..', '%2e%2e', ''];

describe('tenantLifecycleAction', () => {
  it('rejects a traversal action and issues no fetch', async () => {
    await expect(
      tenantLifecycleAction(
        form({ id: 'tnt_001', action: '../../plugins/plg_001/approve', reason: REASON }),
      ),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(TRAVERSAL_IDS)('rejects id %j without fetching', async (id) => {
    await expect(
      tenantLifecycleAction(form({ id, action: 'suspend', reason: REASON })),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a reason of at least 10 characters (PRC-M004)', async () => {
    await expect(
      tenantLifecycleAction(form({ id: 'tnt_001', action: 'suspend', reason: '  short  ' })),
    ).rejects.toThrow(/10 characters/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls the encoded gateway path for a valid request', async () => {
    await tenantLifecycleAction(form({ id: 'tnt_001', action: 'suspend', reason: REASON }));
    expect(requireRole).toHaveBeenCalledWith('tenants');
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/v1\/tenants\/tnt_001\/suspend$/);
  });

  it('stops before any gateway call when the role check denies', async () => {
    requireRole.mockRejectedValueOnce(new Error('NEXT_REDIRECT:/forbidden?area=tenants'));
    await expect(
      tenantLifecycleAction(form({ id: 'tnt_001', action: 'suspend', reason: REASON })),
    ).rejects.toThrow(/forbidden/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('breakGlassDecisionAction', () => {
  it('rejects a traversal decision', async () => {
    await expect(
      breakGlassDecisionAction(
        form({ id: 'bg_001', decision: '../../tenants/x/decommission', reason: '' }),
      ),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(TRAVERSAL_IDS)('rejects id %j', async (id) => {
    await expect(breakGlassDecisionAction(form({ id, decision: 'approve' }))).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks the breakGlassApprove area and posts the decision', async () => {
    await breakGlassDecisionAction(form({ id: 'bg_001', decision: 'deny', reason: 'n/a' }));
    expect(requireRole).toHaveBeenCalledWith('breakGlassApprove');
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/break-glass\/bg_001\/deny$/);
  });
});

describe('themeDecisionAction', () => {
  it('rejects traversal action and ids', async () => {
    await expect(
      themeDecisionAction(form({ id: 'th_1', action: '../../plugins/p/approve' })),
    ).rejects.toThrow();
    for (const id of TRAVERSAL_IDS) {
      await expect(themeDecisionAction(form({ id, action: 'approve' }))).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(requireRole).toHaveBeenCalledWith('themes');
  });
});

describe('updateEntitlementsAction', () => {
  it('rejects traversal plan ids and entitlement keys', async () => {
    for (const planId of TRAVERSAL_IDS) {
      await expect(updateEntitlementsAction(form({ planId }))).rejects.toThrow();
    }
    await expect(
      updateEntitlementsAction(form({ planId: 'plan_pilot', 'entitlement.../x': 'on' })),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(requireRole).toHaveBeenCalledWith('plans');
  });
});

describe('pluginDecisionAction', () => {
  it.each(TRAVERSAL_IDS)('returns a validation error for id %j', async (id) => {
    const state = await pluginDecisionAction(
      {},
      form({ id, action: 'approve', reason: 'Reviewed manifest and scopes' }),
    );
    expect(state.error).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks the plugins area', async () => {
    await pluginDecisionAction(
      {},
      form({ id: 'plg_001', action: 'reject', reason: 'Manifest requests excessive scopes' }),
    );
    expect(requireRole).toHaveBeenCalledWith('plugins');
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/plugins\/plg_001\/reject$/);
  });
});
