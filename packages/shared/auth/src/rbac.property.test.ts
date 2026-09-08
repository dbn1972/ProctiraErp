/**
 * Property-based tests for RBAC Area-Scoped Access Control.
 *
 * Property 3: RBAC Area-Scoped Access Control
 * For any user with role R scoped to area A in the hierarchy, the system SHALL
 * grant access only to resources belonging to area A or its descendant areas,
 * and SHALL deny access to resources in any area that is not A or a descendant of A.
 *
 * **Validates: Requirements 4.4, 17.5**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  evaluatePermission,
  RbacPermissionRegistry,
  InMemoryAreaHierarchyResolver,
} from './rbac.js';
import type { AreaNode, PermissionAction } from './rbac.js';
import type { AuthUser, RoleAssignment } from './types.js';

// --- Area Hierarchy Generator ---

/**
 * Represents a generated area hierarchy tree for property testing.
 * Contains the flat list of nodes plus helper lookups.
 */
interface GeneratedHierarchy {
  nodes: AreaNode[];
  /** Map from area ID to its node */
  nodeMap: Map<string, AreaNode>;
  /** Map from area ID to its descendant IDs (not including self) */
  descendants: Map<string, string[]>;
  /** Map from area ID to its ancestor IDs (not including self) */
  ancestors: Map<string, string[]>;
  /** Map from area ID to its sibling IDs (same parent, not including self) */
  siblings: Map<string, string[]>;
}

/**
 * Generates a random area hierarchy tree with configurable depth and branching.
 * The tree always has a root node and at least 2 levels to make the property meaningful.
 */
const areaHierarchyArb: fc.Arbitrary<GeneratedHierarchy> = fc
  .record({
    // Number of children per node at each level (branching factor)
    branchingFactors: fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 2, maxLength: 5 }),
  })
  .map(({ branchingFactors }) => {
    const nodes: AreaNode[] = [];
    let nodeCounter = 0;

    function makeId(): string {
      return `area-${nodeCounter++}`;
    }

    // Build tree level by level
    const rootId = makeId();
    const rootNode: AreaNode = {
      id: rootId,
      parentId: null,
      level: 0,
      path: `/${rootId}`,
    };
    nodes.push(rootNode);

    let currentLevel: AreaNode[] = [rootNode];

    for (let depth = 0; depth < branchingFactors.length; depth++) {
      const branching = branchingFactors[depth];
      const nextLevel: AreaNode[] = [];

      for (const parent of currentLevel) {
        for (let i = 0; i < branching; i++) {
          const childId = makeId();
          const childNode: AreaNode = {
            id: childId,
            parentId: parent.id,
            level: parent.level + 1,
            path: `${parent.path}/${childId}`,
          };
          nodes.push(childNode);
          nextLevel.push(childNode);
        }
      }

      currentLevel = nextLevel;
    }

    // Build lookup maps
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Compute descendants for each node
    const descendants = new Map<string, string[]>();
    for (const node of nodes) {
      const descs: string[] = [];
      for (const other of nodes) {
        if (other.id === node.id) continue;
        // other is a descendant of node if other's path starts with node's path + '/'
        if (other.path.startsWith(node.path + '/')) {
          descs.push(other.id);
        }
      }
      descendants.set(node.id, descs);
    }

    // Compute ancestors for each node
    const ancestors = new Map<string, string[]>();
    for (const node of nodes) {
      const ancs: string[] = [];
      let currentId = node.parentId;
      while (currentId !== null) {
        ancs.push(currentId);
        const parentNode = nodeMap.get(currentId);
        currentId = parentNode?.parentId ?? null;
      }
      ancestors.set(node.id, ancs);
    }

    // Compute siblings for each node
    const siblings = new Map<string, string[]>();
    for (const node of nodes) {
      const sibs: string[] = [];
      for (const other of nodes) {
        if (other.id === node.id) continue;
        if (other.parentId === node.parentId) {
          sibs.push(other.id);
        }
      }
      siblings.set(node.id, sibs);
    }

    return { nodes, nodeMap, descendants, ancestors, siblings };
  });

/**
 * Generates a valid permission action.
 */
const actionArb: fc.Arbitrary<PermissionAction> = fc.constantFrom(
  'create',
  'read',
  'update',
  'delete',
  'list',
);

/**
 * Generates a valid resource name.
 */
const resourceArb: fc.Arbitrary<string> = fc.constantFrom(
  'institution',
  'student',
  'staff',
  'assessment',
  'attendance',
  'report',
);

// --- Property 3: RBAC Area-Scoped Access Control ---

describe('Property 3: RBAC Area-Scoped Access Control', () => {
  // **Validates: Requirements 4.4, 17.5**

  it('a user with a role at area X can access resources in area X (self)', async () => {
    await fc.assert(
      fc.asyncProperty(
        areaHierarchyArb,
        resourceArb,
        actionArb,
        async (hierarchy, resource, action) => {
          // Pick a non-root area to assign the role to (ensures there are ancestors)
          const nonRootNodes = hierarchy.nodes.filter((n) => n.parentId !== null);
          if (nonRootNodes.length === 0) return; // skip degenerate case

          const assignedArea = nonRootNodes[0];

          // Create a role that grants the requested permission
          const registry = new RbacPermissionRegistry([
            {
              roleId: 'test-role',
              roleName: 'Test Role',
              permissions: [{ resource, action }],
            },
          ]);

          const resolver = new InMemoryAreaHierarchyResolver(hierarchy.nodes);

          const user: AuthUser = {
            userId: 'user-1',
            tenantId: 'tenant-1',
            email: 'test@example.com',
            displayName: 'Test User',
            roles: [{ roleId: 'test-role', roleName: 'Test Role', areaId: assignedArea.id }],
            areas: [{ areaId: assignedArea.id, level: assignedArea.level }],
            institutions: [],
          };

          // Access resource in the same area as the role assignment — should be granted
          const result = await evaluatePermission(user, resource, action, registry, resolver, {
            areaId: assignedArea.id,
          });

          expect(result.granted).toBe(true);
          expect(result.grantedByRole).toBe('Test Role');
          expect(result.matchedAreaId).toBe(assignedArea.id);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a user with a role at area X can access resources in all descendant areas of X', async () => {
    await fc.assert(
      fc.asyncProperty(
        areaHierarchyArb,
        resourceArb,
        actionArb,
        async (hierarchy, resource, action) => {
          // Pick an area that has at least one descendant
          const areasWithDescendants = hierarchy.nodes.filter(
            (n) => (hierarchy.descendants.get(n.id)?.length ?? 0) > 0,
          );
          if (areasWithDescendants.length === 0) return; // skip degenerate case

          const assignedArea = areasWithDescendants[0];
          const descendantIds = hierarchy.descendants.get(assignedArea.id)!;

          // Create a role that grants the requested permission
          const registry = new RbacPermissionRegistry([
            {
              roleId: 'test-role',
              roleName: 'Test Role',
              permissions: [{ resource, action }],
            },
          ]);

          const resolver = new InMemoryAreaHierarchyResolver(hierarchy.nodes);

          const user: AuthUser = {
            userId: 'user-1',
            tenantId: 'tenant-1',
            email: 'test@example.com',
            displayName: 'Test User',
            roles: [{ roleId: 'test-role', roleName: 'Test Role', areaId: assignedArea.id }],
            areas: [{ areaId: assignedArea.id, level: assignedArea.level }],
            institutions: [],
          };

          // Access resource in every descendant area — all should be granted
          for (const descendantId of descendantIds) {
            const result = await evaluatePermission(user, resource, action, registry, resolver, {
              areaId: descendantId,
            });

            expect(result.granted).toBe(true);
            expect(result.grantedByRole).toBe('Test Role');
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a user with a role at area X cannot access resources in ancestor areas of X', async () => {
    await fc.assert(
      fc.asyncProperty(
        areaHierarchyArb,
        resourceArb,
        actionArb,
        async (hierarchy, resource, action) => {
          // Pick an area that has at least one ancestor (non-root)
          const nonRootNodes = hierarchy.nodes.filter(
            (n) => (hierarchy.ancestors.get(n.id)?.length ?? 0) > 0,
          );
          if (nonRootNodes.length === 0) return; // skip degenerate case

          const assignedArea = nonRootNodes[nonRootNodes.length - 1]; // pick deepest for more ancestors
          const ancestorIds = hierarchy.ancestors.get(assignedArea.id)!;

          // Create a role that grants the requested permission
          const registry = new RbacPermissionRegistry([
            {
              roleId: 'test-role',
              roleName: 'Test Role',
              permissions: [{ resource, action }],
            },
          ]);

          const resolver = new InMemoryAreaHierarchyResolver(hierarchy.nodes);

          const user: AuthUser = {
            userId: 'user-1',
            tenantId: 'tenant-1',
            email: 'test@example.com',
            displayName: 'Test User',
            roles: [{ roleId: 'test-role', roleName: 'Test Role', areaId: assignedArea.id }],
            areas: [{ areaId: assignedArea.id, level: assignedArea.level }],
            institutions: [],
          };

          // Access resource in any ancestor area — all should be denied
          for (const ancestorId of ancestorIds) {
            const result = await evaluatePermission(user, resource, action, registry, resolver, {
              areaId: ancestorId,
            });

            expect(result.granted).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a user with a role at area X cannot access resources in sibling areas of X', async () => {
    await fc.assert(
      fc.asyncProperty(
        areaHierarchyArb,
        resourceArb,
        actionArb,
        async (hierarchy, resource, action) => {
          // Pick an area that has at least one sibling
          const areasWithSiblings = hierarchy.nodes.filter(
            (n) => (hierarchy.siblings.get(n.id)?.length ?? 0) > 0,
          );
          if (areasWithSiblings.length === 0) return; // skip degenerate case

          const assignedArea = areasWithSiblings[0];
          const siblingIds = hierarchy.siblings.get(assignedArea.id)!;

          // Create a role that grants the requested permission
          const registry = new RbacPermissionRegistry([
            {
              roleId: 'test-role',
              roleName: 'Test Role',
              permissions: [{ resource, action }],
            },
          ]);

          const resolver = new InMemoryAreaHierarchyResolver(hierarchy.nodes);

          const user: AuthUser = {
            userId: 'user-1',
            tenantId: 'tenant-1',
            email: 'test@example.com',
            displayName: 'Test User',
            roles: [{ roleId: 'test-role', roleName: 'Test Role', areaId: assignedArea.id }],
            areas: [{ areaId: assignedArea.id, level: assignedArea.level }],
            institutions: [],
          };

          // Access resource in any sibling area — all should be denied
          for (const siblingId of siblingIds) {
            const result = await evaluatePermission(user, resource, action, registry, resolver, {
              areaId: siblingId,
            });

            expect(result.granted).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a user cannot access resources in areas from a completely different branch', async () => {
    await fc.assert(
      fc.asyncProperty(
        areaHierarchyArb,
        resourceArb,
        actionArb,
        async (hierarchy, resource, action) => {
          // We need at least two branches: find two areas that are not in ancestor/descendant relationship
          const nonRootNodes = hierarchy.nodes.filter((n) => n.parentId !== null);
          if (nonRootNodes.length < 2) return;

          // Pick the first non-root area as the assigned area
          const assignedArea = nonRootNodes[0];
          const assignedDescendants = new Set(hierarchy.descendants.get(assignedArea.id) ?? []);
          const assignedAncestors = new Set(hierarchy.ancestors.get(assignedArea.id) ?? []);

          // Find areas that are neither descendants, ancestors, nor self
          const unrelatedAreas = hierarchy.nodes.filter(
            (n) =>
              n.id !== assignedArea.id &&
              !assignedDescendants.has(n.id) &&
              !assignedAncestors.has(n.id),
          );

          if (unrelatedAreas.length === 0) return; // skip if no unrelated areas exist

          const registry = new RbacPermissionRegistry([
            {
              roleId: 'test-role',
              roleName: 'Test Role',
              permissions: [{ resource, action }],
            },
          ]);

          const resolver = new InMemoryAreaHierarchyResolver(hierarchy.nodes);

          const user: AuthUser = {
            userId: 'user-1',
            tenantId: 'tenant-1',
            email: 'test@example.com',
            displayName: 'Test User',
            roles: [{ roleId: 'test-role', roleName: 'Test Role', areaId: assignedArea.id }],
            areas: [{ areaId: assignedArea.id, level: assignedArea.level }],
            institutions: [],
          };

          // Access resource in any unrelated area — all should be denied
          for (const unrelatedArea of unrelatedAreas) {
            const result = await evaluatePermission(user, resource, action, registry, resolver, {
              areaId: unrelatedArea.id,
            });

            expect(result.granted).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('the set of accessible areas equals exactly {self} ∪ {descendants} for any role assignment', async () => {
    await fc.assert(
      fc.asyncProperty(
        areaHierarchyArb,
        resourceArb,
        actionArb,
        fc.integer({ min: 0, max: 100 }),
        async (hierarchy, resource, action, nodeIndex) => {
          // Pick an area deterministically based on the generated index
          const assignedArea = hierarchy.nodes[nodeIndex % hierarchy.nodes.length];
          const expectedAccessible = new Set([
            assignedArea.id,
            ...(hierarchy.descendants.get(assignedArea.id) ?? []),
          ]);

          const registry = new RbacPermissionRegistry([
            {
              roleId: 'test-role',
              roleName: 'Test Role',
              permissions: [{ resource, action }],
            },
          ]);

          const resolver = new InMemoryAreaHierarchyResolver(hierarchy.nodes);

          const user: AuthUser = {
            userId: 'user-1',
            tenantId: 'tenant-1',
            email: 'test@example.com',
            displayName: 'Test User',
            roles: [{ roleId: 'test-role', roleName: 'Test Role', areaId: assignedArea.id }],
            areas: [{ areaId: assignedArea.id, level: assignedArea.level }],
            institutions: [],
          };

          // Check every area in the hierarchy
          for (const node of hierarchy.nodes) {
            const result = await evaluatePermission(user, resource, action, registry, resolver, {
              areaId: node.id,
            });

            if (expectedAccessible.has(node.id)) {
              expect(result.granted).toBe(true);
            } else {
              expect(result.granted).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
