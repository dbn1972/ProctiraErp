/**
 * PRC-L237 — the shared campus role table consumed by the gateway and web.
 */
import { describe, expect, it } from 'vitest';
import { createCampusRbacRegistry, createCampusRoleDefinitions } from './campus-rbac.js';
import { DEFAULT_ROLES, hasPermission } from './rbac.js';
import type { AuthUser } from './types.js';

function user(roleId: string): AuthUser {
  return {
    userId: 'u1',
    tenantId: 't1',
    email: 'u@example.test',
    displayName: 'U',
    roles: [{ roleId, roleName: roleId, areaId: 'area-1' }],
    areas: [],
    institutions: [],
  } as unknown as AuthUser;
}

describe('createCampusRoleDefinitions', () => {
  it('returns fresh objects each call and never mutates DEFAULT_ROLES', () => {
    const before = JSON.stringify(DEFAULT_ROLES);
    const a = createCampusRoleDefinitions();
    const b = createCampusRoleDefinitions();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a[0]!.permissions.push({ resource: 'x', action: 'manage' });
    expect(createCampusRoleDefinitions()).toEqual(b);
    expect(JSON.stringify(DEFAULT_ROLES)).toBe(before);
  });

  it('keeps examinations read-only for students/teachers/staff (L237 gate basis)', () => {
    const registry = createCampusRbacRegistry();
    for (const roleId of ['student', 'teacher', 'staff']) {
      expect(hasPermission(user(roleId), 'examination', 'read', registry), roleId).toBe(true);
      expect(hasPermission(user(roleId), 'examination', 'create', registry), roleId).toBe(false);
    }
  });

  it('adds the portal, nurse, HR and platform roles', () => {
    const ids = createCampusRoleDefinitions().map((role) => role.roleId);
    for (const id of ['parent', 'student', 'nurse', 'hr_officer', 'registrar', 'platform_admin']) {
      expect(ids).toContain(id);
    }
  });
});
