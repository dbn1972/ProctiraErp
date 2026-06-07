/**
 * RBAC Evaluator - Backend wrapper around the shared RBAC module.
 *
 * Re-exports the core evaluatePermission function from @proctira/auth
 * and provides any backend-specific evaluation logic.
 */

export {
  evaluatePermission,
  hasPermission,
  RbacPermissionRegistry,
  InMemoryAreaHierarchyResolver,
  DEFAULT_ROLES,
} from '@proctira/auth';

export type {
  Permission,
  PermissionAction,
  RoleDefinition,
  AreaNode,
  ResourceContext,
  PermissionEvaluationResult,
  AreaHierarchyResolver,
} from '@proctira/auth';
