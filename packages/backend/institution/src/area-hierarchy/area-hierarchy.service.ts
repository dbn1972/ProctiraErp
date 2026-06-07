/**
 * Area Hierarchy Service
 *
 * Manages geographic/administrative area hierarchy nodes with:
 * - CRUD operations (create, update, move, list tree)
 * - Maximum nesting depth enforcement (10 levels)
 * - Tree traversal queries for descendant areas (using materialized path)
 * - Area-based institution filtering
 */

import type { GeographicArea, Institution } from '@proctira/database';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

/** Maximum allowed nesting depth for area hierarchy */
export const MAX_AREA_DEPTH = 10;

/**
 * Input for creating a new area hierarchy node.
 */
export interface CreateAreaInput {
  tenantId: string;
  name: string;
  code: string;
  parentId?: string | null;
}

/**
 * Input for updating an existing area hierarchy node.
 */
export interface UpdateAreaInput {
  name?: string;
  code?: string;
}

/**
 * Input for moving an area node to a new parent.
 */
export interface MoveAreaInput {
  newParentId: string | null;
}

/**
 * Tree node representation for area hierarchy responses.
 */
export interface AreaTreeNode {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  level: number;
  parentId: string | null;
  path: string;
  lft: number;
  rgt: number;
  children: AreaTreeNode[];
}

/**
 * Minimal database client interface for area hierarchy operations.
 * This allows testing without a real Prisma client.
 */
export interface AreaHierarchyDbClient {
  geographicArea: {
    findUnique(args: { where: { id: string } }): Promise<GeographicArea | null>;
    findFirst(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> | Record<string, unknown>[] }): Promise<GeographicArea | null>;
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> | Record<string, unknown>[] }): Promise<GeographicArea[]>;
    create(args: { data: Record<string, unknown> }): Promise<GeographicArea>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<GeographicArea>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
  institution: {
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown>; skip?: number; take?: number }): Promise<Institution[]>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
}

/**
 * Area Hierarchy Service implementation.
 */
export class AreaHierarchyService {
  constructor(private readonly db: AreaHierarchyDbClient) {}

  /**
   * Create a new area hierarchy node.
   * Enforces maximum nesting depth of 10 levels.
   */
  async create(input: CreateAreaInput): Promise<GeographicArea> {
    const { tenantId, name, code, parentId } = input;

    // Check for duplicate code within tenant
    const existingCode = await this.db.geographicArea.findFirst({
      where: { tenantId, code, deletedAt: null },
    });
    if (existingCode) {
      throw new ConflictError(`Area with code '${code}' already exists in this tenant`);
    }

    let level = 0;
    let path = '';
    let lft = 1;
    let rgt = 2;

    if (parentId) {
      const parent = await this.db.geographicArea.findUnique({
        where: { id: parentId },
      });

      if (!parent) {
        throw new NotFoundError(`Parent area with id '${parentId}' not found`);
      }

      if (parent.tenantId !== tenantId) {
        throw new ValidationError('Parent area belongs to a different tenant');
      }

      // Enforce maximum depth
      level = parent.level + 1;
      if (level >= MAX_AREA_DEPTH) {
        throw new BusinessRuleError(
          `Maximum area hierarchy depth of ${MAX_AREA_DEPTH} levels exceeded. Current parent is at level ${parent.level}.`
        );
      }

      // Build materialized path
      path = parent.path ? `${parent.path}/${parent.id}` : `/${parent.id}`;

      // Calculate nested set values: insert at the right of the parent
      lft = parent.rgt;
      rgt = parent.rgt + 1;

      // Shift existing nodes to make room
      await this.db.geographicArea.updateMany({
        where: { tenantId, rgt: { gte: parent.rgt } },
        data: { rgt: { increment: 2 } },
      });
      await this.db.geographicArea.updateMany({
        where: { tenantId, lft: { gt: parent.rgt } },
        data: { lft: { increment: 2 } },
      });
    } else {
      // Root node - find the max rgt value to place after all existing roots
      const maxNode = await this.db.geographicArea.findFirst({
        where: { tenantId, deletedAt: null },
        orderBy: { rgt: 'desc' } as Record<string, unknown>,
      });

      if (maxNode) {
        lft = maxNode.rgt + 1;
        rgt = maxNode.rgt + 2;
      }

      path = '';
    }

    const area = await this.db.geographicArea.create({
      data: {
        tenantId,
        name,
        code,
        level,
        parentId: parentId || null,
        path,
        lft,
        rgt,
      },
    });

    return area;
  }

  /**
   * Update an existing area hierarchy node (name and/or code).
   */
  async update(tenantId: string, areaId: string, input: UpdateAreaInput): Promise<GeographicArea> {
    const area = await this.db.geographicArea.findUnique({
      where: { id: areaId },
    });

    if (!area || area.tenantId !== tenantId || area.deletedAt !== null) {
      throw new NotFoundError(`Area with id '${areaId}' not found`);
    }

    // If code is being changed, check for duplicates
    if (input.code && input.code !== area.code) {
      const existingCode = await this.db.geographicArea.findFirst({
        where: { tenantId, code: input.code, deletedAt: null, id: { not: areaId } },
      });
      if (existingCode) {
        throw new ConflictError(`Area with code '${input.code}' already exists in this tenant`);
      }
    }

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.code !== undefined) updateData.code = input.code;

    const updated = await this.db.geographicArea.update({
      where: { id: areaId },
      data: updateData,
    });

    return updated;
  }

  /**
   * Move an area node to a new parent.
   * Enforces maximum nesting depth for the moved subtree.
   */
  async move(tenantId: string, areaId: string, input: MoveAreaInput): Promise<GeographicArea> {
    const area = await this.db.geographicArea.findUnique({
      where: { id: areaId },
    });

    if (!area || area.tenantId !== tenantId || area.deletedAt !== null) {
      throw new NotFoundError(`Area with id '${areaId}' not found`);
    }

    const { newParentId } = input;

    // Cannot move to itself
    if (newParentId === areaId) {
      throw new BusinessRuleError('Cannot move an area to be its own parent');
    }

    let newLevel = 0;
    let newPath = '';

    if (newParentId) {
      const newParent = await this.db.geographicArea.findUnique({
        where: { id: newParentId },
      });

      if (!newParent || newParent.tenantId !== tenantId || newParent.deletedAt !== null) {
        throw new NotFoundError(`New parent area with id '${newParentId}' not found`);
      }

      // Cannot move to a descendant of itself
      const isDescendant = await this.isDescendant(tenantId, newParentId, areaId);
      if (isDescendant) {
        throw new BusinessRuleError('Cannot move an area to one of its own descendants');
      }

      newLevel = newParent.level + 1;
      newPath = newParent.path ? `${newParent.path}/${newParent.id}` : `/${newParent.id}`;

      // Check depth constraint for the entire subtree
      const subtreeDepth = await this.getSubtreeDepth(tenantId, areaId);
      const totalDepth = newLevel + subtreeDepth;
      if (totalDepth >= MAX_AREA_DEPTH) {
        throw new BusinessRuleError(
          `Moving this area would exceed the maximum hierarchy depth of ${MAX_AREA_DEPTH} levels. ` +
          `New parent is at level ${newParent.level}, subtree has depth ${subtreeDepth}.`
        );
      }
    }

    // Calculate level difference for updating descendants
    const levelDiff = newLevel - area.level;
    const oldPath = area.path ? `${area.path}/${area.id}` : `/${area.id}`;
    const newFullPath = newPath ? `${newPath}/${area.id}` : `/${area.id}`;

    // Update the area itself
    await this.db.geographicArea.update({
      where: { id: areaId },
      data: {
        parentId: newParentId,
        level: newLevel,
        path: newPath,
      },
    });

    // Update all descendants' paths and levels
    const descendants = await this.db.geographicArea.findMany({
      where: {
        tenantId,
        path: { startsWith: oldPath },
        deletedAt: null,
      },
      orderBy: { level: 'asc' } as Record<string, unknown>,
    });

    for (const descendant of descendants) {
      const updatedPath = descendant.path.replace(oldPath, newFullPath);
      await this.db.geographicArea.update({
        where: { id: descendant.id },
        data: {
          path: updatedPath,
          level: descendant.level + levelDiff,
        },
      });
    }

    // Return the updated area
    const updated = await this.db.geographicArea.findUnique({
      where: { id: areaId },
    });

    return updated!;
  }

  /**
   * Get the full area hierarchy tree for a tenant, optionally starting from a root node.
   */
  async getTree(tenantId: string, rootId?: string): Promise<AreaTreeNode[]> {
    let areas: GeographicArea[];

    if (rootId) {
      const root = await this.db.geographicArea.findUnique({
        where: { id: rootId },
      });

      if (!root || root.tenantId !== tenantId || root.deletedAt !== null) {
        throw new NotFoundError(`Area with id '${rootId}' not found`);
      }

      // Get all descendants using nested set (lft/rgt)
      areas = await this.db.geographicArea.findMany({
        where: {
          tenantId,
          lft: { gte: root.lft },
          rgt: { lte: root.rgt },
          deletedAt: null,
        },
        orderBy: { lft: 'asc' } as Record<string, unknown>,
      });
    } else {
      areas = await this.db.geographicArea.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { lft: 'asc' } as Record<string, unknown>,
      });
    }

    return this.buildTree(areas);
  }

  /**
   * Get a single area by ID.
   */
  async getById(tenantId: string, areaId: string): Promise<GeographicArea> {
    const area = await this.db.geographicArea.findUnique({
      where: { id: areaId },
    });

    if (!area || area.tenantId !== tenantId || area.deletedAt !== null) {
      throw new NotFoundError(`Area with id '${areaId}' not found`);
    }

    return area;
  }

  /**
   * Get all descendant area IDs for a given area (using materialized path).
   * Includes the area itself.
   */
  async getDescendantIds(tenantId: string, areaId: string): Promise<string[]> {
    const area = await this.db.geographicArea.findUnique({
      where: { id: areaId },
    });

    if (!area || area.tenantId !== tenantId || area.deletedAt !== null) {
      throw new NotFoundError(`Area with id '${areaId}' not found`);
    }

    // Use materialized path to find descendants
    const pathPrefix = area.path ? `${area.path}/${area.id}` : `/${area.id}`;

    const descendants = await this.db.geographicArea.findMany({
      where: {
        tenantId,
        path: { startsWith: pathPrefix },
        deletedAt: null,
      },
      orderBy: { level: 'asc' } as Record<string, unknown>,
    });

    return [area.id, ...descendants.map((d) => d.id)];
  }

  /**
   * Get all ancestor area IDs for a given area (using materialized path).
   * Returns IDs from root to the given area (inclusive).
   */
  async getAncestorIds(tenantId: string, areaId: string): Promise<string[]> {
    const area = await this.db.geographicArea.findUnique({
      where: { id: areaId },
    });

    if (!area || area.tenantId !== tenantId || area.deletedAt !== null) {
      throw new NotFoundError(`Area with id '${areaId}' not found`);
    }

    if (!area.path) {
      return [area.id];
    }

    // Parse materialized path to get ancestor IDs
    const ancestorIds = area.path
      .split('/')
      .filter((segment) => segment.length > 0);

    return [...ancestorIds, area.id];
  }

  /**
   * Filter institutions by area, including all descendant areas.
   */
  async getInstitutionsByArea(
    tenantId: string,
    areaId: string,
    options: PaginationOptions
  ): Promise<PaginatedResult<Institution>> {
    // Get all descendant area IDs (including the specified area)
    const areaIds = await this.getDescendantIds(tenantId, areaId);

    const where = {
      tenantId,
      areaId: { in: areaIds },
      deletedAt: null,
    };

    const [institutions, totalItems] = await Promise.all([
      this.db.institution.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
      this.db.institution.count({ where }),
    ]);

    return {
      data: institutions,
      meta: {
        page: options.page,
        pageSize: options.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / options.pageSize),
      },
    };
  }

  /**
   * Check if targetId is a descendant of ancestorId.
   */
  private async isDescendant(tenantId: string, targetId: string, ancestorId: string): Promise<boolean> {
    const target = await this.db.geographicArea.findUnique({
      where: { id: targetId },
    });

    if (!target || target.tenantId !== tenantId) return false;

    // Check if the ancestor's ID appears in the target's path
    const pathSegments = target.path.split('/').filter((s) => s.length > 0);
    return pathSegments.includes(ancestorId);
  }

  /**
   * Get the maximum depth of a subtree rooted at the given area.
   * Returns 0 if the area has no children.
   */
  private async getSubtreeDepth(tenantId: string, areaId: string): Promise<number> {
    const area = await this.db.geographicArea.findUnique({
      where: { id: areaId },
    });

    if (!area) return 0;

    const pathPrefix = area.path ? `${area.path}/${area.id}` : `/${area.id}`;

    const descendants = await this.db.geographicArea.findMany({
      where: {
        tenantId,
        path: { startsWith: pathPrefix },
        deletedAt: null,
      },
      orderBy: { level: 'desc' } as Record<string, unknown>,
    });

    if (descendants.length === 0) return 0;

    const maxDescendantLevel = descendants[0]!.level;
    return maxDescendantLevel - area.level;
  }

  /**
   * Build a tree structure from a flat list of areas.
   */
  private buildTree(areas: GeographicArea[]): AreaTreeNode[] {
    const nodeMap = new Map<string, AreaTreeNode>();
    const roots: AreaTreeNode[] = [];

    // Create nodes
    for (const area of areas) {
      nodeMap.set(area.id, {
        id: area.id,
        tenantId: area.tenantId,
        name: area.name,
        code: area.code,
        level: area.level,
        parentId: area.parentId,
        path: area.path,
        lft: area.lft,
        rgt: area.rgt,
        children: [],
      });
    }

    // Build parent-child relationships
    for (const area of areas) {
      const node = nodeMap.get(area.id)!;
      if (area.parentId && nodeMap.has(area.parentId)) {
        nodeMap.get(area.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}
