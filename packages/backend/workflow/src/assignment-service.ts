/**
 * Workflow Assignment Service
 *
 * Assigns workflow steps based on role and area hierarchy context.
 * Resolves the appropriate assignee for a workflow state based on:
 * - Role-based assignment (assign to any user with the specified role)
 * - User-based assignment (assign to a specific user)
 * - Area-role assignment (assign to a user with the role in the relevant area hierarchy)
 *
 * Requirements:
 * - 13.2: THE Workflow_Engine SHALL allow assigning workflow steps to specific roles
 *         or users based on Area_Hierarchy and institution context
 */
import type { WorkflowStateInput } from './schemas.js';

// ─── Assignment Types ────────────────────────────────────────────────────────

/**
 * Context for resolving workflow step assignments.
 */
export interface AssignmentContext {
  /** Tenant ID for scoping */
  tenantId: string;
  /** Institution ID where the workflow is running */
  institutionId?: string;
  /** Area ID in the hierarchy */
  areaId?: string;
  /** The user who initiated the workflow or last transitioned */
  initiatorId?: string;
}

/**
 * Resolved assignment target.
 */
export interface AssignmentTarget {
  /** Type of assignment */
  type: 'role' | 'user' | 'area_role';
  /** The resolved target identifier (role ID, user ID, or area-role combo) */
  targetId: string;
  /** Whether the assignment is scoped to a specific institution */
  institutionScoped: boolean;
  /** The area context for area-role assignments */
  areaId?: string;
  /** The institution context */
  institutionId?: string;
}

/**
 * Area hierarchy node for resolving area-based assignments.
 */
export interface AreaNode {
  id: string;
  parentId: string | null;
  name: string;
  level: number;
}

/**
 * Interface for resolving area hierarchy.
 */
export interface AreaHierarchyResolver {
  /**
   * Get the parent area of a given area.
   */
  getParentArea(tenantId: string, areaId: string): Promise<AreaNode | null>;

  /**
   * Get the ancestor chain for an area (from immediate parent to root).
   */
  getAncestorChain(tenantId: string, areaId: string): Promise<AreaNode[]>;

  /**
   * Get the area associated with an institution.
   */
  getInstitutionArea(tenantId: string, institutionId: string): Promise<string | null>;
}

/**
 * In-memory area hierarchy resolver for testing.
 */
export class InMemoryAreaHierarchyResolver implements AreaHierarchyResolver {
  private areas: Map<string, AreaNode> = new Map();
  private institutionAreas: Map<string, string> = new Map();

  addArea(area: AreaNode): void {
    this.areas.set(area.id, area);
  }

  setInstitutionArea(institutionId: string, areaId: string): void {
    this.institutionAreas.set(institutionId, areaId);
  }

  async getParentArea(tenantId: string, areaId: string): Promise<AreaNode | null> {
    const area = this.areas.get(areaId);
    if (!area || !area.parentId) return null;
    return this.areas.get(area.parentId) ?? null;
  }

  async getAncestorChain(tenantId: string, areaId: string): Promise<AreaNode[]> {
    const ancestors: AreaNode[] = [];
    let currentId: string | null = areaId;

    while (currentId) {
      const area = this.areas.get(currentId);
      if (!area || !area.parentId) break;
      const parent = this.areas.get(area.parentId);
      if (!parent) break;
      ancestors.push(parent);
      currentId = parent.parentId;
    }

    return ancestors;
  }

  async getInstitutionArea(tenantId: string, institutionId: string): Promise<string | null> {
    return this.institutionAreas.get(institutionId) ?? null;
  }

  clear(): void {
    this.areas.clear();
    this.institutionAreas.clear();
  }
}

// ─── Assignment Service ──────────────────────────────────────────────────────

/**
 * Service for resolving workflow step assignments based on role and area hierarchy.
 */
export class AssignmentService {
  constructor(private readonly areaResolver: AreaHierarchyResolver) {}

  /**
   * Resolve the assignment target for a workflow state.
   *
   * For 'role' type: assigns to the specified role ID directly.
   * For 'user' type: assigns to the specific user ID.
   * For 'area_role' type: resolves the role within the area hierarchy context,
   *   walking up the hierarchy if needed to find the appropriate level.
   *
   * @param state - The workflow state definition with assignee configuration
   * @param context - The context for resolving the assignment (institution, area, etc.)
   * @returns The resolved assignment target
   */
  async resolveAssignment(
    state: WorkflowStateInput,
    context: AssignmentContext,
  ): Promise<AssignmentTarget> {
    switch (state.assigneeType) {
      case 'role':
        return this.resolveRoleAssignment(state, context);
      case 'user':
        return this.resolveUserAssignment(state, context);
      case 'area_role':
        return this.resolveAreaRoleAssignment(state, context);
      default:
        return this.resolveRoleAssignment(state, context);
    }
  }

  /**
   * Resolve a role-based assignment.
   * The step is assigned to any user with the specified role.
   * If institutionScoped is true, only users with the role at the specific institution.
   */
  private async resolveRoleAssignment(
    state: WorkflowStateInput,
    context: AssignmentContext,
  ): Promise<AssignmentTarget> {
    return {
      type: 'role',
      targetId: state.assigneeId,
      institutionScoped: state.institutionScoped ?? false,
      institutionId: state.institutionScoped ? context.institutionId : undefined,
    };
  }

  /**
   * Resolve a user-based assignment.
   * The step is assigned to a specific user.
   */
  private async resolveUserAssignment(
    state: WorkflowStateInput,
    context: AssignmentContext,
  ): Promise<AssignmentTarget> {
    return {
      type: 'user',
      targetId: state.assigneeId,
      institutionScoped: state.institutionScoped ?? false,
      institutionId: context.institutionId,
    };
  }

  /**
   * Resolve an area-role assignment.
   * The step is assigned to a user with the specified role in the relevant area.
   *
   * Resolution strategy:
   * 1. If institution context is provided, get the institution's area
   * 2. If area context is provided directly, use that
   * 3. The role is scoped to the resolved area in the hierarchy
   *
   * This enables escalation patterns where higher-level approvals go to
   * users with roles at parent areas in the hierarchy.
   */
  private async resolveAreaRoleAssignment(
    state: WorkflowStateInput,
    context: AssignmentContext,
  ): Promise<AssignmentTarget> {
    let areaId: string | undefined = context.areaId;

    // If no area provided but institution is, resolve from institution
    if (!areaId && context.institutionId) {
      const institutionArea = await this.areaResolver.getInstitutionArea(
        context.tenantId,
        context.institutionId,
      );
      if (institutionArea) {
        areaId = institutionArea;
      }
    }

    return {
      type: 'area_role',
      targetId: state.assigneeId,
      institutionScoped: state.institutionScoped ?? false,
      areaId,
      institutionId: context.institutionId,
    };
  }

  /**
   * Resolve the escalation target by walking up the area hierarchy.
   *
   * When escalating, the assignment moves to the same role but at a higher
   * level in the area hierarchy (parent area).
   *
   * @param roleId - The role to assign to at the escalated level
   * @param currentAreaId - The current area where the workflow is stuck
   * @param tenantId - Tenant context
   * @returns The parent area ID for escalation, or null if at root
   */
  async resolveEscalationTarget(
    tenantId: string,
    currentAreaId: string,
    roleId: string,
  ): Promise<AssignmentTarget | null> {
    const parentArea = await this.areaResolver.getParentArea(tenantId, currentAreaId);
    if (!parentArea) {
      return null; // Already at root, cannot escalate further
    }

    return {
      type: 'area_role',
      targetId: roleId,
      institutionScoped: false,
      areaId: parentArea.id,
    };
  }
}
