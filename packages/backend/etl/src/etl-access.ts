/**
 * ETL domain RBAC (PRC-H050).
 *
 * The gateway maps the `pipelines` resource onto the coarse `report` RBAC resource, so every
 * role that can read reports (parent, guardian, student, teacher, generic staff) was able to
 * GET pipeline definitions — which carry connector credentials (postgres password, REST
 * authConfig/headers) — and execution error rows (which contain source records). ETL pipeline
 * management is an operator/admin concern, not a report-reader concern.
 *
 * This module gates every ETL pipeline operation (read and write) behind a positive allowlist of
 * ETL/admin roles. Everyone else fails closed (403). Response redaction of connector secrets is a
 * separate defense-in-depth layer (see redactPipelineConnectors in routes).
 */
import { AppError } from '@proctira/common';

const ADMIN_ROLES = [
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'system-admin',
  'principal',
  'school_admin',
  'school-admin',
] as const;

const ETL_STAFF_ROLES = [
  'etl_engineer',
  'etl-engineer',
  'etl_operator',
  'etl-operator',
  'etl_admin',
  'etl-admin',
  'data_engineer',
  'data-engineer',
  'data_admin',
  'data-admin',
  'integration_admin',
  'integration-admin',
  ...ADMIN_ROLES,
] as const;

const ETL_STAFF_ROLE_SET = new Set<string>(ETL_STAFF_ROLES);

export function normalizeEtlRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((role) => {
      if (typeof role === 'string') return role.toLowerCase();
      if (role && typeof role === 'object') {
        const obj = role as Record<string, unknown>;
        const raw = obj['roleId'] ?? obj['roleName'] ?? obj['id'] ?? '';
        return String(raw).toLowerCase();
      }
      return '';
    })
    .filter(Boolean);
}

/** True when the caller holds an ETL/admin role permitted to manage pipelines. */
export function hasEtlAccess(roles: unknown): boolean {
  const normalized = normalizeEtlRoles(roles);
  if (normalized.length === 0) return false;
  return normalized.some((role) => ETL_STAFF_ROLE_SET.has(role));
}

export function assertEtlAccess(roles: unknown): void {
  if (!hasEtlAccess(roles)) {
    throw new AppError(
      'Forbidden: ETL pipeline access requires an ETL or admin role',
      'FORBIDDEN',
      403,
    );
  }
}

/**
 * PRC-H115: `etl.manage` — may read connector config (redacted) and create /
 * update pipelines. ETL operators keep run/monitor access but only see the
 * connector type. Granted by admin + ETL engineering roles, or an explicit
 * `etl.manage` permission claim.
 */
const ETL_MANAGE_ROLE_SET = new Set<string>([
  ...ADMIN_ROLES,
  'etl_admin',
  'etl-admin',
  'etl_engineer',
  'etl-engineer',
  'data_engineer',
  'data-engineer',
  'data_admin',
  'data-admin',
  'integration_admin',
  'integration-admin',
]);

export const ETL_MANAGE_PERMISSION = 'etl.manage';

export function hasEtlManageAccess(roles: unknown, permissions?: unknown): boolean {
  if (
    Array.isArray(permissions) &&
    permissions.some((p) => typeof p === 'string' && p.toLowerCase() === ETL_MANAGE_PERMISSION)
  ) {
    return true;
  }
  return normalizeEtlRoles(roles).some((role) => ETL_MANAGE_ROLE_SET.has(role));
}
