/**
 * PRC-M489: dedicated mocked-gateway suite for the tenant admin (RBAC) client.
 *
 * `listTenantRoles` source classification is covered in
 * `domain-clients-2.test.ts`; this file pins the remaining reads' query
 * strings and source mapping plus every write's method, path and body.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();
vi.mock('./gateway', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('./gateway');
  return { ...actual, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});

import {
  createTenantRole,
  deleteTenantRole,
  getTenantSettings,
  inviteTenantUser,
  listTenantUsers,
  saveTenantSettings,
  setTenantUserRoles,
  setTenantUserStatus,
  updateTenantRole,
} from './admin.server';

function ok<T>(data: T) {
  return { ok: true, status: 200, data };
}
function fail(status: number) {
  return { ok: false, status, data: null, error: { code: 'E', message: 'e' } };
}

beforeEach(() => {
  gatewayFetch.mockReset();
});

describe('admin.server — reads (PRC-M489)', () => {
  it('builds the users query from search/status/roleId and always caps pageSize', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ data: [{ id: 'u-1' }] }));
    const result = await listTenantUsers({ search: 'asha rao', status: 'ACTIVE', roleId: 'r/1' });
    expect(gatewayFetch.mock.calls[0]![0]).toBe(
      '/tenant/users?search=asha+rao&status=ACTIVE&roleId=r%2F1&pageSize=100',
    );
    expect(gatewayFetch.mock.calls[0]![1]).toMatchObject({ throwOnError: false });
    expect(result).toEqual({ users: [{ id: 'u-1' }], source: 'gateway' });
  });

  it('omits unset filters', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ data: [] }));
    await listTenantUsers();
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/tenant/users?pageSize=100');
  });

  it.each([
    [403, 'forbidden'],
    [500, 'scaffold'],
    [401, 'scaffold'],
  ])('maps a %i users failure to source %s with no rows', async (status, source) => {
    gatewayFetch.mockResolvedValueOnce(fail(status));
    await expect(listTenantUsers()).resolves.toEqual({ users: [], source });
  });

  it('reads settings and classifies a denial', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ tenantId: 't-1', displayName: 'School' }));
    await expect(getTenantSettings()).resolves.toEqual({
      settings: { tenantId: 't-1', displayName: 'School' },
      source: 'gateway',
    });
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/tenant/settings');

    gatewayFetch.mockResolvedValueOnce(fail(403));
    await expect(getTenantSettings()).resolves.toEqual({ settings: null, source: 'forbidden' });
  });
});

describe('admin.server — writes (PRC-M489)', () => {
  it('saves settings with PUT and throws on an empty response', async () => {
    const input = {
      displayName: 'School',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      timezone: 'Asia/Kolkata',
      academicYearStartMonth: 4,
      branding: { primaryColor: '#000', accentColor: '#fff' },
      contact: {},
    };
    gatewayFetch.mockResolvedValueOnce(ok({ tenantId: 't-1', ...input }));
    await saveTenantSettings(input);
    expect(gatewayFetch).toHaveBeenCalledWith('/tenant/settings', { method: 'PUT', json: input });

    gatewayFetch.mockResolvedValueOnce(ok(null));
    await expect(saveTenantSettings(input)).rejects.toThrow('Empty response from tenant service');
  });

  it('invites a user with POST', async () => {
    const input = { email: 'a@example.test', displayName: 'A', roleIds: ['r-1'] };
    gatewayFetch.mockResolvedValueOnce(ok({ id: 'u-1' }));
    await inviteTenantUser(input);
    expect(gatewayFetch).toHaveBeenCalledWith('/tenant/users', { method: 'POST', json: input });
  });

  it('sets roles and status with PATCH on the encoded user path', async () => {
    gatewayFetch.mockResolvedValue(ok({ id: 'u/1' }));
    await setTenantUserRoles('u/1', ['r-1', 'r-2']);
    expect(gatewayFetch).toHaveBeenLastCalledWith('/tenant/users/u%2F1/roles', {
      method: 'PATCH',
      json: { roleIds: ['r-1', 'r-2'] },
    });
    await setTenantUserStatus('u/1', 'SUSPENDED');
    expect(gatewayFetch).toHaveBeenLastCalledWith('/tenant/users/u%2F1/status', {
      method: 'PATCH',
      json: { status: 'SUSPENDED' },
    });
  });

  it('creates, updates and deletes roles', async () => {
    const role = { name: 'Clerk', permissions: [{ resource: 'fees', action: 'read' as const }] };
    gatewayFetch.mockResolvedValue(ok({ id: 'r-1' }));
    await createTenantRole(role);
    expect(gatewayFetch).toHaveBeenLastCalledWith('/tenant/roles', { method: 'POST', json: role });
    await updateTenantRole('r 1', { name: 'Senior clerk' });
    expect(gatewayFetch).toHaveBeenLastCalledWith('/tenant/roles/r%201', {
      method: 'PATCH',
      json: { name: 'Senior clerk' },
    });
    await deleteTenantRole('r 1');
    expect(gatewayFetch).toHaveBeenLastCalledWith('/tenant/roles/r%201', { method: 'DELETE' });
  });

  it('throws on an empty role write response', async () => {
    gatewayFetch.mockResolvedValueOnce(ok(null));
    await expect(updateTenantRole('r-1', { name: 'x' })).rejects.toThrow(
      'Empty response from tenant service',
    );
  });
});
