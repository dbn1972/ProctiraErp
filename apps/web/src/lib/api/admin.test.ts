/**
 * Tests for the admin client (Task 59.3 — Roles & Permissions).
 *
 * Covers:
 *   • matrix helpers (`permissionKey`, `roleHasPermission`, `togglePermission`)
 *     — the canonical guards that gate checkbox toggles in the UI.
 *   • mutation helpers (`createRole`, `updateRolePermissions`, `deleteRole`,
 *     `assignRolesToUser`) — verify each one calls `recordHighRiskAuditEvent`
 *     with the expected before/after diff and `riskLevel: 'high'`
 *     (Requirement 33 AC 4 / Requirement 42 AC 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as adminModule from './admin';
import {
  ADMIN_API_ENDPOINTS,
  assignRolesToUser,
  createRole,
  deleteRole,
  permissionKey,
  roleHasPermission,
  togglePermission,
  updateRolePermissions,
  type RolePermission,
  type TenantRole,
  type TenantUser,
} from './admin';

// ─── Test helpers ────────────────────────────────────────────────────────

type FetchSpy = ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;

function makeFetchSpy(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): FetchSpy {
  return vi.fn(async (...args: unknown[]) =>
    handler(args[0] as string, args[1] as RequestInit | undefined),
  ) as unknown as FetchSpy;
}

function asFetch(spy: FetchSpy): typeof fetch {
  return spy as unknown as typeof fetch;
}

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

const FIXTURE_ROLE: TenantRole = {
  id: 'role-1',
  name: 'Curriculum Lead',
  description: null,
  builtIn: false,
  permissions: [{ resource: 'assessment', action: 'manage' }],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

const FIXTURE_USER: TenantUser = {
  id: 'user-1',
  email: 'alice@example.test',
  displayName: 'Alice Admin',
  status: 'ACTIVE',
  roleIds: ['role-1'],
};

// ─── Matrix toggle behavior ──────────────────────────────────────────────

describe('admin matrix helpers', () => {
  it('permissionKey returns a stable string for a (resource, action) pair', () => {
    expect(permissionKey({ resource: 'student', action: 'read' })).toBe('student::read');
  });

  it('roleHasPermission honors exact, wildcard, and manage grants', () => {
    const exact = { permissions: [{ resource: 'student', action: 'read' as const }] };
    expect(roleHasPermission(exact, { resource: 'student', action: 'read' })).toBe(true);
    expect(roleHasPermission(exact, { resource: 'student', action: 'create' })).toBe(false);

    const manage = { permissions: [{ resource: 'student', action: 'manage' as const }] };
    expect(roleHasPermission(manage, { resource: 'student', action: 'read' })).toBe(true);
    expect(roleHasPermission(manage, { resource: 'student', action: 'delete' })).toBe(true);
    expect(roleHasPermission(manage, { resource: 'institution', action: 'read' })).toBe(false);

    const wildcard = { permissions: [{ resource: '*', action: 'manage' as const }] };
    expect(roleHasPermission(wildcard, { resource: 'student', action: 'read' })).toBe(true);
    expect(roleHasPermission(wildcard, { resource: 'institution', action: 'delete' })).toBe(true);
  });

  describe('togglePermission', () => {
    it('adds a permission when not currently granted', () => {
      const next = togglePermission([], { resource: 'student', action: 'read' });
      expect(next).toEqual([{ resource: 'student', action: 'read' }]);
    });

    it('removes an existing exact grant', () => {
      const next = togglePermission(
        [
          { resource: 'student', action: 'read' },
          { resource: 'student', action: 'create' },
        ],
        { resource: 'student', action: 'read' },
      );
      expect(next).toEqual([{ resource: 'student', action: 'create' }]);
    });

    it('refuses to add a redundant explicit grant when a wildcard already covers it', () => {
      const original: RolePermission[] = [{ resource: '*', action: 'manage' }];
      const next = togglePermission(original, { resource: 'student', action: 'read' });
      expect(next).toBe(original);
    });

    it('refuses to add a redundant explicit grant when manage already covers it', () => {
      const original: RolePermission[] = [{ resource: 'student', action: 'manage' }];
      const next = togglePermission(original, { resource: 'student', action: 'read' });
      expect(next).toBe(original);
    });

    it('does not mutate the original permission list', () => {
      const original: RolePermission[] = [{ resource: 'student', action: 'read' }];
      const snapshot = JSON.stringify(original);
      togglePermission(original, { resource: 'student', action: 'create' });
      togglePermission(original, { resource: 'student', action: 'read' });
      expect(JSON.stringify(original)).toBe(snapshot);
    });

    it('round-trips: toggling twice returns an equivalent list', () => {
      const original: RolePermission[] = [{ resource: 'student', action: 'read' }];
      const after = togglePermission(
        togglePermission(original, { resource: 'student', action: 'create' }),
        { resource: 'student', action: 'create' },
      );
      expect(after).toEqual(original);
    });
  });
});

// ─── PRC-L264: no browser-emitted (client-trusted) audit ──────────────────
//
// The role/user audit trail is now written server-side, inside the same
// database transaction as the mutation (tenant-admin plugin → PgRolesRepository
// txn-audit port). The browser must NOT POST a before/after audit record: that
// path targeted an UNMOUNTED endpoint (`/api/v1/audit/events`; the gateway only
// mounts the audit plugin at `/api/v1/audit-logs`) and was a client-supplied,
// client-trusted audit — an anti-pattern. These tests assert each mutation hits
// ONLY its own endpoint and never the audit endpoint, and that the browser
// audit emitter is gone from the module surface.

describe('admin client → no browser-emitted audit (PRC-L264)', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('does not expose a browser audit emitter or an audit-events endpoint', () => {
    expect('recordHighRiskAuditEvent' in adminModule).toBe(false);
    expect('AUDIT_EVENTS' in ADMIN_API_ENDPOINTS).toBe(false);
  });

  it('createRole calls only the roles endpoint (no audit POST)', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = makeFetchSpy((url, init) => {
      calls.push({ url, init: init ?? {} });
      if (url === ADMIN_API_ENDPOINTS.ROLES) return jsonResponse(FIXTURE_ROLE, 201);
      return emptyResponse(201);
    });

    const role = await createRole(
      { name: 'Curriculum Lead', permissions: [{ resource: 'assessment', action: 'manage' }] },
      { fetcher: asFetch(fetcher) },
    );

    expect(role).toEqual(FIXTURE_ROLE);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(ADMIN_API_ENDPOINTS.ROLES);
    expect(calls.some((c) => c.url.includes('/audit'))).toBe(false);
  });

  it('updateRolePermissions calls only the permissions endpoint (no audit POST)', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const updated: TenantRole = {
      ...FIXTURE_ROLE,
      permissions: [{ resource: 'assessment', action: 'read' }],
    };
    const fetcher = makeFetchSpy((url, init) => {
      calls.push({ url, init: init ?? {} });
      if (url.startsWith(`${ADMIN_API_ENDPOINTS.ROLES}/`)) return jsonResponse(updated);
      return emptyResponse(201);
    });

    const role = await updateRolePermissions(
      FIXTURE_ROLE.id,
      { permissions: updated.permissions },
      { roleName: FIXTURE_ROLE.name, previousPermissions: FIXTURE_ROLE.permissions },
      { fetcher: asFetch(fetcher) },
    );

    expect(role).toEqual(updated);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain(`${ADMIN_API_ENDPOINTS.ROLES}/`);
    expect(calls.some((c) => c.url.includes('/audit'))).toBe(false);
  });

  it('deleteRole calls only the role endpoint (no audit POST)', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = makeFetchSpy((url, init) => {
      calls.push({ url, init: init ?? {} });
      return emptyResponse(204);
    });

    await deleteRole(
      FIXTURE_ROLE.id,
      { roleName: FIXTURE_ROLE.name },
      { fetcher: asFetch(fetcher) },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(calls.some((c) => c.url.includes('/audit'))).toBe(false);
  });

  it('assignRolesToUser calls only the user-roles endpoint (no audit POST)', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const updated: TenantUser = { ...FIXTURE_USER, roleIds: ['role-1', 'role-2'] };
    const fetcher = makeFetchSpy((url, init) => {
      calls.push({ url, init: init ?? {} });
      if (url.startsWith(`${ADMIN_API_ENDPOINTS.USERS}/`)) return jsonResponse(updated);
      return emptyResponse(201);
    });

    const user = await assignRolesToUser(
      FIXTURE_USER.id,
      ['role-1', 'role-2'],
      { userDisplayName: FIXTURE_USER.displayName, previousRoleIds: FIXTURE_USER.roleIds },
      { fetcher: asFetch(fetcher) },
    );

    expect(user.roleIds).toEqual(['role-1', 'role-2']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain(`${ADMIN_API_ENDPOINTS.USERS}/`);
    expect(calls.some((c) => c.url.includes('/audit'))).toBe(false);
  });
});
// ─── PRC-M486: CSRF header on admin mutations ────────────────────────────
describe('adminFetch CSRF (PRC-M486)', () => {
  beforeEach(() => {
    document.cookie = 'csrf_token=tok-486; path=/';
  });
  afterEach(() => {
    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });
  it('every non-GET helper sends x-csrf-token equal to the csrf_token cookie', async () => {
    const role: TenantRole = {
      id: 'role-1',
      name: 'Role',
      description: null,
      builtIn: false,
      permissions: [],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    const fetcher = makeFetchSpy((_url, init) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(role), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
    );
    const opts = { fetcher: asFetch(fetcher) };
    await createRole({ name: 'Role', description: null, permissions: [] } as never, opts);
    await deleteRole('role-1', { roleName: 'Role' }, opts);
    const mutating = fetcher.mock.calls.filter(
      (c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') !== 'GET',
    );
    expect(mutating.length).toBeGreaterThan(0);
    for (const [, init] of mutating) {
      expect(new Headers((init as RequestInit).headers).get('x-csrf-token')).toBe('tok-486');
    }
  });
});

describe('tenant general settings client (PRC-M144)', () => {
  it('exports no PATCH /tenant/settings client (PRC-M144)', async () => {
    // The backend only exposes PUT /tenant/settings; the live save path is
    // `saveTenantSettings` (PUT) in admin.server.ts. A PATCH client must not exist.
    const admin = await import('./admin');
    expect('updateTenantGeneralSettings' in admin).toBe(false);
  });
});
