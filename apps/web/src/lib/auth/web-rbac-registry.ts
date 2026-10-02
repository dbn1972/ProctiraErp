/**
 * Web-side RBAC registry (G-101, PRC-L237).
 *
 * UI route guards and navigation use the exact role table the API gateway
 * enforces: `createCampusRbacRegistry()` from `@proctira/auth`, which the
 * gateway's `createGatewayRbacRegistry()` also returns. There are no
 * web-only copies of gateway grants any more, so a grant added or removed in
 * the shared table changes both sides together.
 *
 * Gating here is UX only; the gateway remains the enforcement point.
 */
import { createCampusRbacRegistry, type RbacPermissionRegistry } from '@proctira/auth';

export function createWebRbacRegistry(): RbacPermissionRegistry {
  return createCampusRbacRegistry();
}

let cachedRegistry: RbacPermissionRegistry | undefined;

export function getWebRbacRegistry(): RbacPermissionRegistry {
  cachedRegistry ??= createWebRbacRegistry();
  return cachedRegistry;
}

/** Test-only: reset memoized registry between cases. */
export function resetWebRbacRegistryCache(): void {
  cachedRegistry = undefined;
}
