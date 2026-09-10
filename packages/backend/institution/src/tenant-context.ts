/**
 * Request-scoped tenant context for stores whose interface predates tenancy
 * (G-901: infrastructure hierarchy store).
 *
 * The institution plugin enters the context in an `onRequest` hook (same
 * pattern as `@fastify/request-context`), so store implementations can bind
 * `app.tenant_id` for RLS or partition in-memory data per tenant without
 * changing the `InfrastructureStore` contract used by the service and routes.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string | undefined;
}

export const tenantContext = new AsyncLocalStorage<TenantContext>();

/** Current request tenant, or `undefined` outside a request / when unauthenticated. */
export function currentTenantId(): string | undefined {
  return tenantContext.getStore()?.tenantId;
}

/** Tenant id required for a data access; throws a typed error for the route layer. */
export function requireTenantId(): string {
  const tenantId = currentTenantId();
  if (!tenantId) {
    const error = new Error('Tenant context is required') as Error & {
      statusCode: number;
      code: string;
    };
    error.statusCode = 400;
    error.code = 'TENANT_REQUIRED';
    throw error;
  }
  return tenantId;
}
