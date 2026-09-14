/**
 * @proctira/tenant - Tenant resolution, context, and provisioning
 *
 * This package provides:
 * - Tenant resolution from JWT claims, headers, and subdomains
 * - Fastify plugin for automatic tenant context per request
 * - PostgreSQL RLS session variable management
 * - Tenant provisioning utilities
 */

// Tenant Resolution
export {
  resolveTenantId,
  isValidUuid,
  isAuthenticatedRequest,
  TenantResolutionError,
} from './tenant-resolution.js';
export type { TenantResolutionResult, TenantResolutionOptions } from './tenant-resolution.js';

// W3-TIME-01 — tenant timezone foundation
export {
  DEFAULT_TENANT_TIMEZONE,
  isValidIanaTimezone,
  resolveTenantTimezone,
} from './tenant-timezone.js';
export type { TenantTimezoneSource } from './tenant-timezone.js';

// Fastify Plugin
export { tenantPlugin } from './fastify-plugin.js';
export type { TenantPluginOptions } from './fastify-plugin.js';

// Provisioning
export { provisionTenant } from './provisioning.js';
export type {
  ProvisionTenantInput,
  ProvisionTenantResult,
  ProvisioningDbClient,
  ProvisioningTxClient,
} from './provisioning.js';
