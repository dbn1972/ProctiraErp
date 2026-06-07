/**
 * Shared constants used across all Definition-of-Done checks.
 *
 * These values codify the platform charter (Section 32 — Definition of Done)
 * and the service catalog under packages/backend/*.
 */

/** Known service prefixes that map to table names and route owners. */
export const KNOWN_SERVICES = [
  'assessment',
  'attendance',
  'audit',
  'auth',
  'billing',
  'custom-field',
  'data-warehouse',
  'developer-portal',
  'etl',
  'examination',
  'health',
  'install',
  'institution',
  'notification',
  'plugin',
  'policy',
  'registration',
  'report',
  'scholarship',
  'staff',
  'student',
  'survey',
  'tenant',
  'theme',
  'transport',
  'workflow',
];

/**
 * Tables that are explicitly shared across services or are framework-owned
 * (Prisma migrations) and therefore exempt from the service-prefix rule.
 */
export const SHARED_TABLES = new Set([
  'tenants',
  '_prisma_migrations',
]);

/** All check identifiers used in the structured report. */
export const CHECK_IDS = Object.freeze({
  TABLE_NAMING: 'table-naming',
  CROSS_SERVICE_JOINS: 'cross-service-joins',
  TENANT_ID: 'tenant-id',
  AUDIT_EVENTS: 'audit-events',
  API_SCHEMA: 'api-schema',
  ERROR_ENVELOPE: 'error-envelope',
  I18N: 'i18n-readiness',
});

/** Severity levels for a finding. */
export const SEVERITY = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning',
});

/**
 * Convert a kebab-case service id (e.g. "custom-field") to its table prefix
 * form (e.g. "custom_field"). Tables prepended with this string + "_" pass
 * the service-prefix rule.
 */
export function servicePrefix(svc) {
  return svc.replace(/-/g, '_');
}
