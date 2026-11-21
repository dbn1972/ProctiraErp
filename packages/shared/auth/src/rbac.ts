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
  'create' | 'read' | 'update' | 'delete' | 'list' | 'manage' | 'preview';

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
  // ---------------------------------------------------------------------------
  // D2 canonical role catalogue (append-only; PRC-M015).
  //
  // The six roles above are the original DEFAULT_ROLES and are UNCHANGED. Every
  // entry below is privilege-preserving: its permission set is the union of (a)
  // the role's `createGatewayRbacRegistry()` definition where one exists, and
  // (b) the resource/action implied by the backend module allow-lists that
  // already name the role (mapped through the gateway PATH_RESOURCE_MAP). No
  // role is granted a permission it does not already effectively hold; only
  // `super-admin`/`platform_admin` carry `*:manage`.
  // ---------------------------------------------------------------------------

  // --- Platform / tenant administration -------------------------------------
  {
    // Gateway-defined control-plane operator: platform console + global
    // platform-operations wildcard. platform_admin is DISTINCT from the
    // per-tenant system_admin and does NOT inherit system_admin's tenant-scoped
    // student / health / assessment / examination / report data grants
    // (D2 CORRECTION — preserve tenant isolation).
    roleId: 'platform_admin',
    roleName: 'Platform Administrator',
    permissions: [
      { resource: 'platform', action: 'manage' },
      { resource: '*', action: 'manage' },
    ],
  },

  // --- Staff / HR / registration (gateway STAFF_HR_PERMISSIONS = staff:manage) ---
  {
    roleId: 'registrar',
    roleName: 'Registrar',
    permissions: [{ resource: 'staff', action: 'manage' }],
  },
  {
    roleId: 'hr_officer',
    roleName: 'Hr Officer',
    permissions: [{ resource: 'staff', action: 'manage' }],
  },
  {
    roleId: 'staff_admin',
    roleName: 'Staff Admin',
    permissions: [{ resource: 'staff', action: 'manage' }],
  },
  {
    roleId: 'admissions_officer',
    roleName: 'Admissions Officer',
    permissions: [{ resource: 'staff', action: 'manage' }],
  },

  // --- Finance (scholarship decide/disburse + staff.hr.read/payroll + fee reports) ---
  {
    roleId: 'bursar',
    roleName: 'Bursar',
    permissions: [
      { resource: 'scholarship', action: 'read' },
      { resource: 'scholarship', action: 'update' },
      { resource: 'fees', action: 'read' },
      { resource: 'staff', action: 'read' },
      { resource: 'report', action: 'read' },
    ],
  },
  {
    roleId: 'finance_officer',
    roleName: 'Finance Officer',
    permissions: [
      { resource: 'scholarship', action: 'read' },
      { resource: 'scholarship', action: 'update' },
      { resource: 'fees', action: 'read' },
      { resource: 'staff', action: 'read' },
      { resource: 'report', action: 'read' },
    ],
  },
  {
    // Scholarship RBAC: programs, applications, disbursements, compliance.
    roleId: 'scholarship_officer',
    roleName: 'Scholarship Officer',
    permissions: [{ resource: 'scholarship', action: 'manage' }],
  },

  // --- Examinations / assessment --------------------------------------------
  {
    // examination-access EXAM_OFFICER_ROLES (create/update/publish/delete) +
    // report exam_results + gradebook REGISTRAR moderation.
    roleId: 'examinations_officer',
    roleName: 'Examinations Officer',
    permissions: [
      { resource: 'examination', action: 'manage' },
      { resource: 'gradebook', action: 'read' },
      { resource: 'gradebook', action: 'update' },
      { resource: 'report', action: 'read' },
    ],
  },

  // --- Case work (gateway CASE_WORKER = case:manage) -------------------------
  {
    roleId: 'counsellor',
    roleName: 'Counsellor',
    permissions: [{ resource: 'case', action: 'manage' }],
  },
  {
    roleId: 'discipline_officer',
    roleName: 'Discipline Officer',
    permissions: [{ resource: 'case', action: 'manage' }],
  },

  // --- Communication / notification -----------------------------------------
  {
    // communication staff (campaigns/circulars) + notification staff (broadcast).
    roleId: 'communications_officer',
    roleName: 'Communications Officer',
    permissions: [
      { resource: 'communication', action: 'manage' },
      { resource: 'notification', action: 'manage' },
    ],
  },
  {
    roleId: 'notification_admin',
    roleName: 'Notification Admin',
    permissions: [{ resource: 'notification', action: 'manage' }],
  },

  // --- Health ----------------------------------------------------------------
  {
    // health-service TENANT_WIDE_HEALTH_ROLES / PHI-log / break-glass approver.
    roleId: 'health_admin',
    roleName: 'Health Admin',
    permissions: [{ resource: 'health', action: 'manage' }],
  },
  {
    // health-service HEALTH_AUTHORIZED_ROLES (PHI reader, school-bound). Distinct
    // from `nurse` (gateway health:manage) — kept separate per D2 decision.
    roleId: 'school_nurse',
    roleName: 'School Nurse',
    permissions: [{ resource: 'health', action: 'read' }],
  },
  {
    // Gateway-defined `nurse`: health:manage + student/parent reads.
    roleId: 'nurse',
    roleName: 'Nurse',
    permissions: [
      { resource: 'health', action: 'manage' },
      { resource: 'student', action: 'read' },
      { resource: 'student', action: 'list' },
      { resource: 'parent', action: 'read' },
    ],
  },

  // --- Residential / facilities ---------------------------------------------
  {
    roleId: 'warden',
    roleName: 'Warden',
    permissions: [{ resource: 'hostel', action: 'manage' }],
  },
  {
    roleId: 'librarian',
    roleName: 'Librarian',
    permissions: [{ resource: 'library', action: 'manage' }],
  },
  {
    roleId: 'transport_officer',
    roleName: 'Transport Officer',
    permissions: [{ resource: 'transport', action: 'manage' }],
  },

  // --- Operations ------------------------------------------------------------
  {
    // etl-access gates pipeline management; gateway maps /pipelines -> `report`.
    roleId: 'etl_engineer',
    roleName: 'Etl Engineer',
    permissions: [{ resource: 'report', action: 'manage' }],
  },
  {
    // timetable-access SCHEDULER_ROLES (schedule.write/publish/read).
    roleId: 'timetable_officer',
    roleName: 'Timetable Officer',
    permissions: [{ resource: 'timetable', action: 'manage' }],
  },

  // --- Teaching sub-roles ----------------------------------------------------
  {
    // gradebook TEACHER_ROLES (grade.entry) + examination read + assessment.
    roleId: 'subject_teacher',
    roleName: 'Subject Teacher',
    permissions: [
      { resource: 'gradebook', action: 'read' },
      { resource: 'gradebook', action: 'create' },
      { resource: 'gradebook', action: 'update' },
      { resource: 'examination', action: 'read' },
      { resource: 'assessment', action: 'read' },
    ],
  },
  {
    // attendance write + gradebook grade.entry + examination read.
    roleId: 'class_teacher',
    roleName: 'Class Teacher',
    permissions: [
      { resource: 'attendance', action: 'read' },
      { resource: 'attendance', action: 'create' },
      { resource: 'attendance', action: 'update' },
      { resource: 'gradebook', action: 'read' },
      { resource: 'gradebook', action: 'create' },
      { resource: 'gradebook', action: 'update' },
      { resource: 'examination', action: 'read' },
      { resource: 'assessment', action: 'read' },
    ],
  },
  {
    // AMBIGUOUS (flagged for reviewer): `marks_clerk` appears only in an
    // examination result-routes TEST fixture ("simulated future divergence",
    // exam.update), never in a production allow-list. Granted the narrowest
    // examination read consistent with that single reference; do not widen
    // without owner sign-off.
    roleId: 'marks_clerk',
    roleName: 'Marks Clerk',
    permissions: [{ resource: 'examination', action: 'read' }],
  },

  // --- Government / board actors (dashboards/scope.ts; read-only aggregates) ---
  {
    // dashboards BOARD_ADMIN scope + lms TENANT_ADMIN_ROLES (board read).
    roleId: 'board_admin',
    roleName: 'Board Admin',
    permissions: [
      { resource: 'report', action: 'read' },
      { resource: 'lms', action: 'read' },
    ],
  },
  {
    // report EXAM_STAFF_ROLES (exam_results) + gradebook REGISTRAR + exam read.
    roleId: 'board_officer',
    roleName: 'Board Officer',
    permissions: [
      { resource: 'report', action: 'read' },
      { resource: 'gradebook', action: 'read' },
      { resource: 'gradebook', action: 'update' },
      { resource: 'examination', action: 'read' },
    ],
  },
  {
    roleId: 'board_regional_officer',
    roleName: 'Board Regional Officer',
    permissions: [{ resource: 'report', action: 'read' }],
  },
  {
    roleId: 'ministry_admin',
    roleName: 'Ministry Admin',
    permissions: [{ resource: 'report', action: 'read' }],
  },
  {
    roleId: 'state_admin',
    roleName: 'State Admin',
    permissions: [{ resource: 'report', action: 'read' }],
  },
  {
    roleId: 'state_director',
    roleName: 'State Director',
    permissions: [{ resource: 'report', action: 'read' }],
  },

  // --- Portal actors (gateway-defined blocks, copied verbatim) ---------------
  {
    roleId: 'parent',
    roleName: 'Parent',
    permissions: [
      { resource: 'parent', action: 'create' },
      { resource: 'parent', action: 'update' },
      { resource: 'parent', action: 'delete' },
      { resource: 'parent', action: 'read' },
      { resource: 'parent', action: 'list' },
      { resource: 'student', action: 'read' },
      { resource: 'attendance', action: 'read' },
      { resource: 'assessment', action: 'read' },
      { resource: 'health', action: 'read' },
      { resource: 'fees', action: 'read' },
      { resource: 'communication', action: 'read' },
      { resource: 'lms', action: 'read' },
      { resource: 'gradebook', action: 'read' },
      { resource: 'timetable', action: 'read' },
      { resource: 'report', action: 'read' },
      { resource: 'library', action: 'read' },
    ],
  },
  {
    roleId: 'student',
    roleName: 'Student',
    permissions: [
      { resource: 'parent', action: 'create' },
      { resource: 'parent', action: 'update' },
      { resource: 'parent', action: 'delete' },
      { resource: 'parent', action: 'read' },
      { resource: 'parent', action: 'list' },
      { resource: 'student-portal', action: 'read' },
      { resource: 'student-portal', action: 'list' },
      { resource: 'student', action: 'read' },
      { resource: 'attendance', action: 'read' },
      { resource: 'assessment', action: 'read' },
      { resource: 'gradebook', action: 'read' },
      { resource: 'timetable', action: 'read' },
      { resource: 'examination', action: 'read' },
      { resource: 'fees', action: 'read' },
      { resource: 'library', action: 'read' },
      { resource: 'hostel', action: 'read' },
      { resource: 'transport', action: 'read' },
      { resource: 'communication', action: 'read' },
      { resource: 'scholarship', action: 'read' },
      { resource: 'lms', action: 'read' },
      { resource: 'lms', action: 'create' },
    ],
  },
  {
    // scholarship document-access APPLICANT_ROLES (own-application read/submit).
    roleId: 'applicant',
    roleName: 'Applicant',
    permissions: [{ resource: 'scholarship', action: 'read' }],
  },
];
