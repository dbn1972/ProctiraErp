/**
 * RBAC Permission Evaluation Module
 *
 * Implements Role-Based Access Control with area hierarchy scoping.
 * Users can only access resources in their assigned area or descendant areas.
 *
 * Key concepts:
 * - Roles map to a set of permissions (resource + action pairs)
 * - Each role assignment is scoped to an area in the hierarchy
 * - A user with a role at area X can access resources in area X and all descendant areas
 * - Permissions are evaluated against the user's JWT payload (AuthUser)
 */

import type { AuthUser } from './types.js';

/**
 * Supported actions for permission checks.
 *
 * The CRUD actions (`create`, `read`, `update`, `delete`, `list`) cover the
 * common resource lifecycle. `manage` is a wildcard that grants every action
 * on a resource.
 *
 * Domain-specific capability actions (e.g. `preview` for tenant branding
 * draft viewing — Task 58.3) sit alongside the CRUD actions so the registry
 * can grant them to roles via the standard `(resource, action)` pair without
 * forcing CRUD-shaped semantics on capabilities that are not really
 * read/write operations.
 */
export type PermissionAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'list'
  | 'manage'
  | 'preview';

/**
 * A single permission entry mapping a resource and action.
 */
export interface Permission {
  /** The resource being accessed (e.g., 'institution', 'student', 'staff') */
  resource: string;
  /** The action being performed */
  action: PermissionAction;
}

/**
 * Role definition with its associated permissions.
 */
export interface RoleDefinition {
  /** Unique role identifier */
  roleId: string;
  /** Human-readable role name */
  roleName: string;
  /** Permissions granted by this role */
  permissions: Permission[];
}

/**
 * Area node in the hierarchy tree.
 * Used for determining if a target area is a descendant of a user's assigned area.
 */
export interface AreaNode {
  /** Area ID */
  id: string;
  /** Parent area ID (null for root) */
  parentId: string | null;
  /** Nesting level (0 = root) */
  level: number;
  /** Materialized path for fast ancestor lookups (e.g., '/root-id/parent-id/this-id') */
  path: string;
}

/**
 * Context for evaluating permissions against a specific resource.
 */
export interface ResourceContext {
  /** The area ID where the resource resides */
  areaId?: string;
  /** The institution ID (if resource is institution-scoped) */
  institutionId?: string;
}

/**
 * Result of a permission evaluation.
 */
export interface PermissionEvaluationResult {
  /** Whether the permission is granted */
  granted: boolean;
  /** Reason for the decision */
  reason: string;
  /** The role that granted access (if granted) */
  grantedByRole?: string;
  /** The area scope that matched (if granted) */
  matchedAreaId?: string;
}

/**
 * Interface for looking up area hierarchy relationships.
 * Implementations can use database queries, in-memory cache, or materialized paths.
 */
export interface AreaHierarchyResolver {
  /**
   * Check if targetAreaId is the same as or a descendant of ancestorAreaId.
   * Returns true if the target area is within the scope of the ancestor area.
   */
  isDescendantOrSelf(targetAreaId: string, ancestorAreaId: string): Promise<boolean>;

  /**
   * Get all ancestor area IDs for a given area (including itself).
   * Returns IDs from root to the given area.
   */
  getAncestors(areaId: string): Promise<string[]>;
}

/**
 * In-memory area hierarchy resolver using a flat map of area nodes.
 * Suitable for testing and small hierarchies that can be loaded into memory.
 */
export class InMemoryAreaHierarchyResolver implements AreaHierarchyResolver {
  private areas: Map<string, AreaNode>;

  constructor(areas: AreaNode[]) {
    this.areas = new Map(areas.map((a) => [a.id, a]));
  }

  async isDescendantOrSelf(targetAreaId: string, ancestorAreaId: string): Promise<boolean> {
    if (targetAreaId === ancestorAreaId) return true;

    // Walk up from target to root, checking if we encounter the ancestor
    let currentId: string | null = targetAreaId;
    const visited = new Set<string>();

    while (currentId !== null) {
      if (visited.has(currentId)) break; // Prevent infinite loops
      visited.add(currentId);

      if (currentId === ancestorAreaId) return true;

      const node = this.areas.get(currentId);
      if (!node) break;
      currentId = node.parentId;
    }

    return false;
  }

  async getAncestors(areaId: string): Promise<string[]> {
    const ancestors: string[] = [];
    let currentId: string | null = areaId;
    const visited = new Set<string>();

    while (currentId !== null) {
      if (visited.has(currentId)) break;
      visited.add(currentId);

      ancestors.unshift(currentId);
      const node = this.areas.get(currentId);
      if (!node) break;
      currentId = node.parentId;
    }

    return ancestors;
  }
}

/**
 * The RBAC permission registry.
 * Stores role definitions and provides permission evaluation.
 */
export class RbacPermissionRegistry {
  private roleDefinitions: Map<string, RoleDefinition>;

  constructor(roles?: RoleDefinition[]) {
    this.roleDefinitions = new Map();
    if (roles) {
      for (const role of roles) {
        this.roleDefinitions.set(role.roleId, role);
      }
    }
  }

  /**
   * Register a role definition with its permissions.
   */
  registerRole(role: RoleDefinition): void {
    this.roleDefinitions.set(role.roleId, role);
  }

  /**
   * Remove a role definition.
   */
  removeRole(roleId: string): void {
    this.roleDefinitions.delete(roleId);
  }

  /**
   * Get a role definition by ID.
   */
  getRole(roleId: string): RoleDefinition | undefined {
    return this.roleDefinitions.get(roleId);
  }

  /**
   * Get all registered role definitions.
   */
  getAllRoles(): RoleDefinition[] {
    return Array.from(this.roleDefinitions.values());
  }

  /**
   * Check if a role has a specific permission.
   * The 'manage' action grants all actions on a resource.
   */
  roleHasPermission(roleId: string, resource: string, action: PermissionAction): boolean {
    const role = this.roleDefinitions.get(roleId);
    if (!role) return false;

    return role.permissions.some(
      (p) =>
        (p.resource === resource || p.resource === '*') &&
        (p.action === action || p.action === 'manage'),
    );
  }
}

/**
 * Evaluates whether a user has permission to perform an action on a resource,
 * considering role assignments and area hierarchy scoping.
 *
 * Algorithm:
 * 1. For each role assignment on the user:
 *    a. Check if the role grants the requested permission (resource + action)
 *    b. If yes, check if the resource's area is within the role's area scope
 *       (i.e., the resource area is the same as or a descendant of the role's assigned area)
 *    c. If both conditions are met, permission is granted
 * 2. If no role assignment satisfies both conditions, permission is denied
 *
 * Special cases:
 * - If no resourceContext.areaId is provided, only the permission check is performed (no area scoping)
 * - If the role assignment has an institutionId, it also checks institution match
 */
export async function evaluatePermission(
  user: AuthUser,
  resource: string,
  action: PermissionAction,
  registry: RbacPermissionRegistry,
  areaResolver: AreaHierarchyResolver,
  resourceContext?: ResourceContext,
): Promise<PermissionEvaluationResult> {
  if (!user.roles || user.roles.length === 0) {
    return {
      granted: false,
      reason: 'User has no role assignments',
    };
  }

  for (const roleAssignment of user.roles) {
    // Step 1: Check if the role grants the requested permission
    const hasPermission = registry.roleHasPermission(roleAssignment.roleId, resource, action);
    if (!hasPermission) continue;

    // Step 2: Check area scope
    if (resourceContext?.areaId) {
      // The resource has an area — check if it's within the role's area scope
      const isInScope = await areaResolver.isDescendantOrSelf(
        resourceContext.areaId,
        roleAssignment.areaId,
      );

      if (!isInScope) continue;
    }

    // Step 3: Check institution scope (if the role is institution-scoped)
    if (roleAssignment.institutionId && resourceContext?.institutionId) {
      if (roleAssignment.institutionId !== resourceContext.institutionId) continue;
    }

    // All checks passed — permission granted
    return {
      granted: true,
      reason: `Permission granted by role '${roleAssignment.roleName}' scoped to area '${roleAssignment.areaId}'`,
      grantedByRole: roleAssignment.roleName,
      matchedAreaId: roleAssignment.areaId,
    };
  }

  return {
    granted: false,
    reason: `No role assignment grants '${action}' on '${resource}' within the requested area scope`,
  };
}

/**
 * Simplified synchronous permission check that doesn't require area hierarchy resolution.
 * Useful when you only need to check if the user has the permission at all,
 * without verifying area scope (e.g., for UI visibility decisions).
 */
export function hasPermission(
  user: AuthUser,
  resource: string,
  action: PermissionAction,
  registry: RbacPermissionRegistry,
): boolean {
  if (!user.roles || user.roles.length === 0) return false;

  for (const roleAssignment of user.roles) {
    if (registry.roleHasPermission(roleAssignment.roleId, resource, action)) {
      return true;
    }
  }

  return false;
}

/**
 * Default role definitions for the ProctiraERP platform.
 * These can be extended or overridden per tenant.
 */
export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    roleId: 'super-admin',
    roleName: 'Super Administrator',
    permissions: [{ resource: '*', action: 'manage' }],
  },
  {
    roleId: 'admin',
    roleName: 'Administrator',
    permissions: [
      { resource: 'institution', action: 'manage' },
      { resource: 'student', action: 'manage' },
      { resource: 'staff', action: 'manage' },
      { resource: 'assessment', action: 'manage' },
      { resource: 'attendance', action: 'manage' },
      { resource: 'examination', action: 'manage' },
      { resource: 'report', action: 'manage' },
      { resource: 'workflow', action: 'manage' },
      { resource: 'user', action: 'manage' },
    ],
  },
  {
    roleId: 'principal',
    roleName: 'Principal',
    permissions: [
      { resource: 'institution', action: 'read' },
      { resource: 'institution', action: 'update' },
      { resource: 'student', action: 'manage' },
      { resource: 'staff', action: 'manage' },
      { resource: 'assessment', action: 'manage' },
      { resource: 'attendance', action: 'manage' },
      { resource: 'report', action: 'read' },
    ],
  },
  {
    roleId: 'teacher',
    roleName: 'Teacher',
    permissions: [
      { resource: 'institution', action: 'read' },
      { resource: 'student', action: 'read' },
      { resource: 'student', action: 'list' },
      { resource: 'assessment', action: 'create' },
      { resource: 'assessment', action: 'read' },
      { resource: 'assessment', action: 'update' },
      { resource: 'attendance', action: 'create' },
      { resource: 'attendance', action: 'read' },
      { resource: 'attendance', action: 'update' },
    ],
  },
  {
    roleId: 'staff',
    roleName: 'Staff',
    permissions: [
      { resource: 'institution', action: 'read' },
      { resource: 'student', action: 'read' },
      { resource: 'student', action: 'list' },
      { resource: 'attendance', action: 'read' },
    ],
  },
  {
    roleId: 'guardian',
    roleName: 'Guardian',
    permissions: [
      { resource: 'student', action: 'read' },
      { resource: 'attendance', action: 'read' },
      { resource: 'assessment', action: 'read' },
      { resource: 'health', action: 'read' },
    ],
  },
];
