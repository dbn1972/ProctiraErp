import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();

vi.mock('./gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
}));

import { listAudit } from './audit';
import {
  createBreakGlassRequest,
  decideBreakGlassRequest,
  getBreakGlassRequest,
  listBreakGlassRequests,
} from './break-glass';
import { getSystemHealth } from './health';
import { getPlan, listPlans, updatePlanEntitlements } from './plans';
import { getPlugin, listPlugins, pluginAction } from './plugins';
import { createTenant, getTenant, listTenants, tenantAction } from './tenants';
import { getTheme, listThemes, themeAction } from './themes';

function offline() {
  return { status: 0, ok: false, data: null };
}

function httpError(message = 'nope') {
  return { status: 503, ok: false, data: null, error: { code: 'DOWN', message } };
}

describe('admin API clients', () => {
  beforeEach(() => {
    gatewayFetch.mockReset();
  });

  it('uses stub catalogues when the gateway is offline', async () => {
    gatewayFetch.mockResolvedValue(offline());

    const tenants = await listTenants({ status: 'active', search: 'ministry' });
    expect(tenants.source).toBe('stub');
    expect(tenants.tenants.map((tenant) => tenant.id)).toEqual(['tnt_001']);

    const missing = await listTenants({ status: 'archived', search: 'nope' });
    expect(missing.tenants).toEqual([]);

    expect((await getTenant('tnt_002')).tenant?.slug).toBe('district-northwest');
    expect((await getTenant('missing')).tenant).toBeNull();

    const created = await createTenant({
      name: 'New',
      slug: 'new',
      contactEmail: 'a@b.c',
      plan: 'pilot',
      region: 'eu-west-1',
    });
    expect(created.ok).toBe(true);
    expect(created.tenant?.status).toBe('provisioning');

    expect((await tenantAction('tnt_001', 'suspend', 'reason')).ok).toBe(true);
    expect((await tenantAction('tnt_001', 'offboard', 'reason')).ok).toBe(true);

    const plugins = await listPlugins();
    expect(plugins.source).toBe('stub');
    expect(plugins.plugins.length).toBeGreaterThan(0);
    expect((await getPlugin('plg_001')).plugin?.name).toBe('Attendance Insights Pro');
    expect((await getPlugin('missing')).plugin).toBeNull();
    expect((await pluginAction('plg_001', 'revoke', 'reason')).ok).toBe(true);

    expect((await listPlans()).plans.length).toBeGreaterThan(0);
    expect((await getPlan('plan_pilot')).plan?.tier).toBe('pilot');
    expect((await getPlan('missing')).plan).toBeNull();
    expect((await updatePlanEntitlements({ planId: 'plan_pilot', entitlements: [] })).ok).toBe(
      true,
    );

    expect((await listThemes()).themes.length).toBeGreaterThan(0);
    expect((await getTheme('thm_001')).theme?.name).toBe('Sunrise Bright');
    expect((await getTheme('missing')).theme).toBeNull();
    expect((await themeAction('thm_001', 'approve', 'notes')).ok).toBe(true);

    const health = await getSystemHealth();
    expect(health.source).toBe('stub');
    expect(health.health.adapters.length).toBeGreaterThan(0);

    const audit = await listAudit({
      search: 'plugin',
      actor: 'security1@proctira.org',
      resourceType: 'plugin',
      tenantId: 'platform',
    });
    expect(audit.source).toBe('stub');
    expect(audit.entries).toHaveLength(1);

    const unrelated = await listAudit({ search: 'does-not-match', resourceType: 'theme' });
    expect(unrelated.entries).toEqual([]);

    const requests = await listBreakGlassRequests();
    expect(requests.source).toBe('stub');
    expect((await getBreakGlassRequest('bg_001'))?.requester).toContain('@');
    expect(await getBreakGlassRequest('missing')).toBeNull();
    const submitted = await createBreakGlassRequest({
      targetTenantId: 'tnt_001',
      scope: 'read',
      justification: 'Need a look at the export job.',
      useCase: 'Production incident triage',
      durationMinutes: 30,
    });
    expect(submitted.ok).toBe(true);
    expect(submitted.request?.status).toBe('pending_approval');
    expect((await decideBreakGlassRequest('bg_001', 'deny', 'not now')).ok).toBe(true);
  });

  it('prefers live gateway payloads', async () => {
    gatewayFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      data: { items: [{ id: 'live-tenant', name: 'Live' }] },
    });
    expect((await listTenants()).tenants[0]?.id).toBe('live-tenant');

    gatewayFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      data: { data: [{ id: 'wrapped' }] },
    });
    expect((await listPlugins()).plugins[0]?.id).toBe('wrapped');

    gatewayFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      data: { id: 'plg_live', permissions: 'nope' },
    });
    expect((await getPlugin('plg_live')).plugin?.permissions).toEqual([]);

    gatewayFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      data: { item: { id: 'plg_item', permissions: ['a'] } },
    });
    expect((await getPlugin('plg_item')).plugin?.permissions).toEqual(['a']);

    gatewayFetch.mockResolvedValueOnce({ status: 200, ok: true, data: { id: 'plan_live' } });
    expect((await getPlan('plan_live')).source).toBe('gateway');

    gatewayFetch.mockResolvedValueOnce({ status: 201, ok: true, data: { id: 'tnt_live' } });
    expect(
      (
        await createTenant({
          name: 'Live',
          slug: 'live',
          contactEmail: 'a@b.c',
          plan: 'standard',
          region: 'us-east-1',
        })
      ).tenant?.id,
    ).toBe('tnt_live');

    gatewayFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      data: { items: [{ id: 'bg_live' }] },
    });
    expect((await listBreakGlassRequests()).requests[0]?.id).toBe('bg_live');

    gatewayFetch.mockResolvedValueOnce({ status: 200, ok: true, data: { adapters: [] } });
    expect((await getSystemHealth()).source).toBe('gateway');

    gatewayFetch.mockResolvedValueOnce({ status: 200, ok: true, data: { data: [{ id: 'aud' }] } });
    expect((await listAudit()).entries[0]?.id).toBe('aud');
  });

  it('returns empty live results when the gateway responds with an error', async () => {
    gatewayFetch.mockResolvedValue(httpError());

    expect((await listTenants()).tenants).toEqual([]);
    expect((await getTenant('tnt_001')).tenant).toBeNull();
    expect(
      (
        await createTenant({
          name: 'X',
          slug: 'x',
          contactEmail: 'a@b.c',
          plan: 'pilot',
          region: 'us-west-2',
        })
      ).ok,
    ).toBe(false);
    expect((await tenantAction('tnt_001', 'reactivate', 'back')).error).toBe('nope');

    expect((await listPlugins()).plugins).toEqual([]);
    expect((await getPlugin('plg_001')).plugin).toBeNull();
    expect((await pluginAction('plg_001', 'disable', 'stop')).ok).toBe(false);

    expect((await updatePlanEntitlements({ planId: 'plan_pilot', entitlements: [] })).ok).toBe(
      false,
    );
    expect((await themeAction('thm_001', 'reject', 'no')).ok).toBe(false);
    expect((await getSystemHealth()).health.adapters).toEqual([]);
    expect((await listAudit()).entries).toEqual([]);
    expect((await listBreakGlassRequests()).requests).toEqual([]);
    expect(
      (
        await createBreakGlassRequest({
          targetTenantId: 'tnt_001',
          scope: 'admin',
          justification: 'long enough justification text',
          useCase: 'Scheduled maintenance',
          durationMinutes: 15,
        })
      ).ok,
    ).toBe(false);
    expect((await decideBreakGlassRequest('bg_001', 'approve', 'ok')).ok).toBe(false);

    gatewayFetch.mockResolvedValueOnce({ status: 500, ok: false, data: null });
    expect((await tenantAction('tnt_001', 'decommission', 'end')).error).toBe('Action failed.');
  });
});
