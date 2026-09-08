/**
 * Unit tests for RBAC Permission Evaluation Module.
 *
 * Tests cover:
 * - Role-permission model with area hierarchy scoping
 * - evaluatePermission checking role assignments and area scope
 * - Users can only access resources in their assigned area or descendant areas
 * - Edge cases: no roles, wildcard permissions, institution scoping
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  evaluatePermission,
  hasPermission,
  RbacPermissionRegistry,
  InMemoryAreaHierarchyResolver,
  DEFAULT_ROLES,
} from './rbac.js';
import type { AuthUser, RoleAssignment } from './types.js';
import type { AreaNode, ResourceContext } from './rbac.js';

/**
 * Test area hierarchy:
 *
 *   country (level 0)
 *   ├── region-north (level 1)
 *   │   ├── district-a (level 2)
 *   │   │   └── zone-a1 (level 3)
 *   │   └── district-b (level 2)
 *   └── region-south (level 1)
 *       └── district-c (level 2)
 */
const TEST_AREAS: AreaNode[] = [
  { id: 'country', parentId: null, level: 0, path: '/country' },
  { id: 'region-north', parentId: 'country', level: 1, path: '/country/region-north' },
  { id: 'region-south', parentId: 'country', level: 1, path: '/country/region-south' },
  {
    id: 'district-a',
    parentId: 'region-north',
    level: 2,
    path: '/country/region-north/district-a',
  },
  {
    id: 'district-b',
    parentId: 'region-north',
    level: 2,
    path: '/country/region-north/district-b',
  },
  {
    id: 'zone-a1',
    parentId: 'district-a',
    level: 3,
    path: '/country/region-north/district-a/zone-a1',
  },
  {
    id: 'district-c',
    parentId: 'region-south',
    level: 2,
    path: '/country/region-south/district-c',
  },
];

function createTestUser(roles: RoleAssignment[]): AuthUser {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    email: 'test@example.com',
    displayName: 'Test User',
    roles,
    areas: roles.map((r) => ({ areaId: r.areaId, level: 0 })),
    institutions: [],
  };
}

describe('RbacPermissionRegistry', () => {
  let registry: RbacPermissionRegistry;

  beforeEach(() => {
    registry = new RbacPermissionRegistry(DEFAULT_ROLES);
  });

  it('should register and retrieve role definitions', () => {
    const role = registry.getRole('admin');
    expect(role).toBeDefined();
    expect(role!.roleName).toBe('Administrator');
  });

  it('should return undefined for unknown roles', () => {
    expect(registry.getRole('nonexistent')).toBeUndefined();
  });

  it('should check if a role has a specific permission', () => {
    expect(registry.roleHasPermission('admin', 'institution', 'create')).toBe(true);
    expect(registry.roleHasPermission('admin', 'institution', 'read')).toBe(true);
    expect(registry.roleHasPermission('teacher', 'institution', 'create')).toBe(false);
    expect(registry.roleHasPermission('teacher', 'institution', 'read')).toBe(true);
  });

  it('should treat "manage" action as granting all actions', () => {
    // Admin has 'manage' on institution
    expect(registry.roleHasPermission('admin', 'institution', 'create')).toBe(true);
    expect(registry.roleHasPermission('admin', 'institution', 'read')).toBe(true);
    expect(registry.roleHasPermission('admin', 'institution', 'update')).toBe(true);
    expect(registry.roleHasPermission('admin', 'institution', 'delete')).toBe(true);
    expect(registry.roleHasPermission('admin', 'institution', 'list')).toBe(true);
  });

  it('should treat wildcard resource as granting all resources', () => {
    // Super admin has '*' resource with 'manage' action
    expect(registry.roleHasPermission('super-admin', 'institution', 'create')).toBe(true);
    expect(registry.roleHasPermission('super-admin', 'student', 'delete')).toBe(true);
    expect(registry.roleHasPermission('super-admin', 'anything', 'read')).toBe(true);
  });

  it('should return false for roles without the requested permission', () => {
    expect(registry.roleHasPermission('guardian', 'institution', 'create')).toBe(false);
    expect(registry.roleHasPermission('guardian', 'student', 'delete')).toBe(false);
    expect(registry.roleHasPermission('teacher', 'student', 'delete')).toBe(false);
  });

  it('should register custom roles', () => {
    registry.registerRole({
      roleId: 'custom-role',
      roleName: 'Custom Role',
      permissions: [{ resource: 'report', action: 'read' }],
    });

    expect(registry.roleHasPermission('custom-role', 'report', 'read')).toBe(true);
    expect(registry.roleHasPermission('custom-role', 'report', 'create')).toBe(false);
  });

  it('should remove roles', () => {
    registry.removeRole('guardian');
    expect(registry.getRole('guardian')).toBeUndefined();
  });

  it('should list all registered roles', () => {
    const roles = registry.getAllRoles();
    expect(roles.length).toBe(DEFAULT_ROLES.length);
  });
});

describe('InMemoryAreaHierarchyResolver', () => {
  let resolver: InMemoryAreaHierarchyResolver;

  beforeEach(() => {
    resolver = new InMemoryAreaHierarchyResolver(TEST_AREAS);
  });

  it('should return true for same area (self)', async () => {
    expect(await resolver.isDescendantOrSelf('district-a', 'district-a')).toBe(true);
  });

  it('should return true for direct child', async () => {
    expect(await resolver.isDescendantOrSelf('district-a', 'region-north')).toBe(true);
  });

  it('should return true for deep descendant', async () => {
    expect(await resolver.isDescendantOrSelf('zone-a1', 'country')).toBe(true);
    expect(await resolver.isDescendantOrSelf('zone-a1', 'region-north')).toBe(true);
    expect(await resolver.isDescendantOrSelf('zone-a1', 'district-a')).toBe(true);
  });

  it('should return false for sibling areas', async () => {
    expect(await resolver.isDescendantOrSelf('district-a', 'district-b')).toBe(false);
    expect(await resolver.isDescendantOrSelf('region-north', 'region-south')).toBe(false);
  });

  it('should return false for ancestor (wrong direction)', async () => {
    expect(await resolver.isDescendantOrSelf('country', 'district-a')).toBe(false);
    expect(await resolver.isDescendantOrSelf('region-north', 'district-a')).toBe(false);
  });

  it('should return false for areas in different branches', async () => {
    expect(await resolver.isDescendantOrSelf('district-c', 'region-north')).toBe(false);
    expect(await resolver.isDescendantOrSelf('zone-a1', 'region-south')).toBe(false);
  });

  it('should return false for unknown areas', async () => {
    expect(await resolver.isDescendantOrSelf('unknown', 'country')).toBe(false);
  });

  it('should get ancestors from root to node', async () => {
    const ancestors = await resolver.getAncestors('zone-a1');
    expect(ancestors).toEqual(['country', 'region-north', 'district-a', 'zone-a1']);
  });

  it('should return just the root for root area', async () => {
    const ancestors = await resolver.getAncestors('country');
    expect(ancestors).toEqual(['country']);
  });
});

describe('evaluatePermission', () => {
  let registry: RbacPermissionRegistry;
  let resolver: InMemoryAreaHierarchyResolver;

  beforeEach(() => {
    registry = new RbacPermissionRegistry(DEFAULT_ROLES);
    resolver = new InMemoryAreaHierarchyResolver(TEST_AREAS);
  });

  it('should deny access when user has no roles', async () => {
    const user = createTestUser([]);
    const result = await evaluatePermission(user, 'institution', 'read', registry, resolver);
    expect(result.granted).toBe(false);
    expect(result.reason).toContain('no role assignments');
  });

  it('should grant access when user has matching role and area scope', async () => {
    const user = createTestUser([
      { roleId: 'admin', roleName: 'Administrator', areaId: 'region-north' },
    ]);

    const result = await evaluatePermission(user, 'institution', 'read', registry, resolver, {
      areaId: 'district-a',
    });

    expect(result.granted).toBe(true);
    expect(result.grantedByRole).toBe('Administrator');
    expect(result.matchedAreaId).toBe('region-north');
  });

  it('should grant access for resource in same area as role assignment', async () => {
    const user = createTestUser([
      { roleId: 'admin', roleName: 'Administrator', areaId: 'district-a' },
    ]);

    const result = await evaluatePermission(user, 'student', 'create', registry, resolver, {
      areaId: 'district-a',
    });

    expect(result.granted).toBe(true);
  });

  it('should grant access for resource in descendant area', async () => {
    const user = createTestUser([
      { roleId: 'admin', roleName: 'Administrator', areaId: 'region-north' },
    ]);

    // zone-a1 is a descendant of region-north
    const result = await evaluatePermission(user, 'student', 'read', registry, resolver, {
      areaId: 'zone-a1',
    });

    expect(result.granted).toBe(true);
  });

  it('should deny access for resource in ancestor area (user scoped lower)', async () => {
    const user = createTestUser([
      { roleId: 'admin', roleName: 'Administrator', areaId: 'district-a' },
    ]);

    // region-north is an ancestor of district-a — user cannot access resources above their scope
    const result = await evaluatePermission(user, 'institution', 'read', registry, resolver, {
      areaId: 'region-north',
    });

    expect(result.granted).toBe(false);
  });

  it('should deny access for resource in a different branch', async () => {
    const user = createTestUser([
      { roleId: 'admin', roleName: 'Administrator', areaId: 'region-north' },
    ]);

    // district-c is under region-south, not region-north
    const result = await evaluatePermission(user, 'institution', 'read', registry, resolver, {
      areaId: 'district-c',
    });

    expect(result.granted).toBe(false);
  });

  it('should deny access when role does not have the requested permission', async () => {
    const user = createTestUser([{ roleId: 'teacher', roleName: 'Teacher', areaId: 'country' }]);

    // Teacher cannot create institutions
    const result = await evaluatePermission(user, 'institution', 'create', registry, resolver, {
      areaId: 'district-a',
    });

    expect(result.granted).toBe(false);
  });

  it('should grant access without area check when no resourceContext.areaId', async () => {
    const user = createTestUser([{ roleId: 'teacher', roleName: 'Teacher', areaId: 'district-a' }]);

    // No area context — only permission check
    const result = await evaluatePermission(user, 'institution', 'read', registry, resolver);

    expect(result.granted).toBe(true);
  });

  it('should check multiple role assignments and grant if any matches', async () => {
    const user = createTestUser([
      { roleId: 'teacher', roleName: 'Teacher', areaId: 'district-a' },
      { roleId: 'admin', roleName: 'Administrator', areaId: 'region-south' },
    ]);

    // Teacher can't create institutions, but admin can — and admin is scoped to region-south
    const result = await evaluatePermission(user, 'institution', 'create', registry, resolver, {
      areaId: 'district-c',
    });

    expect(result.granted).toBe(true);
    expect(result.grantedByRole).toBe('Administrator');
  });

  it('should deny when permission exists but area scope does not match any role', async () => {
    const user = createTestUser([
      { roleId: 'admin', roleName: 'Administrator', areaId: 'region-south' },
    ]);

    // Admin has permission, but resource is in region-north branch
    const result = await evaluatePermission(user, 'institution', 'create', registry, resolver, {
      areaId: 'district-a',
    });

    expect(result.granted).toBe(false);
  });

  it('should handle institution-scoped role assignments', async () => {
    const user = createTestUser([
      {
        roleId: 'principal',
        roleName: 'Principal',
        areaId: 'district-a',
        institutionId: 'inst-1',
      },
    ]);

    // Matching institution
    const result1 = await evaluatePermission(user, 'student', 'create', registry, resolver, {
      areaId: 'district-a',
      institutionId: 'inst-1',
    });
    expect(result1.granted).toBe(true);

    // Different institution
    const result2 = await evaluatePermission(user, 'student', 'create', registry, resolver, {
      areaId: 'district-a',
      institutionId: 'inst-2',
    });
    expect(result2.granted).toBe(false);
  });

  it('should grant super-admin access to any resource in any area', async () => {
    const user = createTestUser([
      { roleId: 'super-admin', roleName: 'Super Administrator', areaId: 'country' },
    ]);

    const result = await evaluatePermission(user, 'anything', 'delete', registry, resolver, {
      areaId: 'zone-a1',
    });

    expect(result.granted).toBe(true);
  });
});

describe('hasPermission (synchronous, no area check)', () => {
  let registry: RbacPermissionRegistry;

  beforeEach(() => {
    registry = new RbacPermissionRegistry(DEFAULT_ROLES);
  });

  it('should return true when user has the permission', () => {
    const user = createTestUser([
      { roleId: 'admin', roleName: 'Administrator', areaId: 'country' },
    ]);
    expect(hasPermission(user, 'institution', 'create', registry)).toBe(true);
  });

  it('should return false when user does not have the permission', () => {
    const user = createTestUser([{ roleId: 'teacher', roleName: 'Teacher', areaId: 'country' }]);
    expect(hasPermission(user, 'institution', 'create', registry)).toBe(false);
  });

  it('should return false for user with no roles', () => {
    const user = createTestUser([]);
    expect(hasPermission(user, 'institution', 'read', registry)).toBe(false);
  });
});
