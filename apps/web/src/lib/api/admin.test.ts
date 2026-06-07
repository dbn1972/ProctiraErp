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

import {
  ADMIN_API_ENDPOINTS,
  assignRolesToUser,
  createRole,
  deleteRole,
  permissionKey,
  recordHighRiskAuditEvent,
  roleHasPermission,
  togglePermission,
  updateRolePermissions,
  type RolePermission,
  type TenantRole,
  type TenantUser,
} from './admin';

// ─── Test helpers ────────────────────────────────────────────────────────

type FetchSpy = ReturnType<typeof vi.fn<unknown[], unknown>>;

function makeFetchSpy(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): FetchSpy {
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

// ─── Audit-event dispatch ────────────────────────────────────────────────

describe('admin client → audit event dispatch', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('recordHighRiskAuditEvent posts riskLevel=high to the audit endpoint', async () => {
    const fetcher = makeFetchSpy(() => emptyResponse(201));
    await recordHighRiskAuditEvent(
      {
        entityType: 'role',
        entityId: 'role-1',
        operation: 'UPDATE',
        beforeValues: { permissions: [] },
        afterValues: { permissions: [{ resource: 'student', action: 'read' }] },
        summary: 'Test summary',
      },
      { fetcher: asFetch(fetcher) },
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(ADMIN_API_ENDPOINTS.AUDIT_EVENTS);
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.metadata.riskLevel).toBe('high');
    expect(body.metadata.summary).toBe('Test summary');
    expect(body.entityType).toBe('role');
    expect(body.operation).toBe('UPDATE');
  });

  it('createRole emits a CREATE audit event with the new role snapshot', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = makeFetchSpy((url, init) => {
      calls.push({ url, init: init ?? {} });
      if (url === ADMIN_API_ENDPOINTS.ROLES) return jsonResponse(FIXTURE_ROLE, 201);
      return emptyResponse(201);
    });

    const role = await createRole(
      {
        name: 'Curriculum Lead',
        permissions: [{ resource: 'assessment', action: 'manage' }],
      },
      { fetcher: asFetch(fetcher) },
    );

    expect(role).toEqual(FIXTURE_ROLE);

    // Two calls: the role create + the audit event.
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(ADMIN_API_ENDPOINTS.ROLES);
    expect(calls[0]!.init.method).toBe('POST');

    const auditCall = calls[1]!;
    expect(auditCall.url).toBe(ADMIN_API_ENDPOINTS.AUDIT_EVENTS);
    const auditBody = JSON.parse(String(auditCall.init.body));
    expect(auditBody).toMatchObject({
      entityType: 'role',
      entityId: FIXTURE_ROLE.id,
      operation: 'CREATE',
      beforeValues: null,
      afterValues: { name: FIXTURE_ROLE.name, permissions: FIXTURE_ROLE.permissions },
      metadata: { riskLevel: 'high' },
    });
    expect(auditBody.metadata.summary).toContain('Curriculum Lead');
  });

  it('updateRolePermissions emits an UPDATE audit event with before/after diff', async () => {
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
    expect(calls).toHaveLength(2);
    const auditCall = calls[1]!;
    const auditBody = JSON.parse(String(auditCall.init.body));
    expect(auditBody.operation).toBe('UPDATE');
    expect(auditBody.beforeValues).toEqual({ permissions: FIXTURE_ROLE.permissions });
    expect(auditBody.afterValues).toEqual({ permissions: updated.permissions });
    expect(auditBody.metadata.riskLevel).toBe('high');
  });

  it('deleteRole emits a DELETE audit event with the deleted snapshot', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = makeFetchSpy((url, init) => {
      calls.push({ url, init: init ?? {} });
      if (url.startsWith(`${ADMIN_API_ENDPOINTS.ROLES}/`) && init?.method === 'DELETE') {
        return emptyResponse(204);
      }
      return emptyResponse(201);
    });

    await deleteRole(FIXTURE_ROLE.id, { roleName: FIXTURE_ROLE.name }, { fetcher: asFetch(fetcher) });

    expect(calls).toHaveLength(2);
    const auditBody = JSON.parse(String(calls[1]!.init.body));
    expect(auditBody.operation).toBe('DELETE');
    expect(auditBody.afterValues).toBeNull();
    expect(auditBody.metadata.riskLevel).toBe('high');
  });

  it('assignRolesToUser emits an UPDATE audit event for the role-to-user grid', async () => {
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

    const auditBody = JSON.parse(String(calls[1]!.init.body));
    expect(auditBody.entityType).toBe('user');
    expect(auditBody.beforeValues).toEqual({ roleIds: FIXTURE_USER.roleIds });
    expect(auditBody.afterValues).toEqual({ roleIds: updated.roleIds });
    expect(auditBody.metadata.riskLevel).toBe('high');
  });

  it('throws an AdminApiError when the audit endpoint rejects the event', async () => {
    const fetcher = makeFetchSpy(() =>
      jsonResponse({ code: 'INTERNAL_ERROR', message: 'audit pipeline down' }, 500),
    );

    await expect(
      recordHighRiskAuditEvent(
        {
          entityType: 'role',
          entityId: 'role-1',
          operation: 'CREATE',
          summary: 'noop',
        },
        { fetcher: asFetch(fetcher) },
      ),
    ).rejects.toMatchObject({
      name: 'AdminApiError',
      status: 500,
      code: 'INTERNAL_ERROR',
    });
  });
});
