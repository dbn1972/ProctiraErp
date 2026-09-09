/**
 * G-805 — School (institution) scope gate.
 */
const BOARD_TENANT_ADMIN_ROLES = new Set([
  'admin',
  'board_admin',
  'tenant-admin',
  'tenant_admin',
  'platform_admin',
  'super-admin',
  'super_admin',
  'administrator',
]);

export const INSTITUTION_SCOPED_SEGMENTS = new Set([
  'students',
  'enrollments',
  'staff',
  'fees',
  'health',
  'library',
  'hostel',
  'transport',
  'scholarships',
  'timetable',
  'gradebook',
  'lms',
  'attendance',
  'assessments',
  'examinations',
  // G-901
  'classes',
  'infrastructure',
  'institution-subjects',
]);

export type InstitutionScopeUser = {
  institutions?: string[];
  roles?: Array<string | { roleId?: string; roleName?: string }>;
};

export function roleIdsOf(user: InstitutionScopeUser | null | undefined): string[] {
  return (user?.roles ?? [])
    .map((r) => (typeof r === 'string' ? r : (r.roleId ?? r.roleName ?? '')))
    .filter(Boolean);
}

export function isBoardOrTenantAdmin(user: InstitutionScopeUser | null | undefined): boolean {
  return roleIdsOf(user).some((id) => BOARD_TENANT_ADMIN_ROLES.has(id));
}

export function isSchoolBound(user: InstitutionScopeUser | null | undefined): boolean {
  return (user?.institutions?.length ?? 0) > 0 && !isBoardOrTenantAdmin(user);
}

export function allowedInstitutions(user: InstitutionScopeUser | null | undefined): string[] {
  return [...new Set((user?.institutions ?? []).filter(Boolean))];
}

export function extractInstitutionId(input: {
  query?: unknown;
  params?: unknown;
  body?: unknown;
}): string | undefined {
  for (const source of [input.query, input.params, input.body]) {
    if (!source || typeof source !== 'object') continue;
    const record = source as Record<string, unknown>;
    const value = record['institutionId'] ?? record['institution_id'];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function firstPathSegment(urlPath: string): string | undefined {
  const path = urlPath.split('?')[0] ?? urlPath;
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2]) return parts[2];
  return parts[0];
}

export type InstitutionScopeDecision =
  | { action: 'allow' }
  | { action: 'inject'; institutionId: string }
  | { action: 'deny'; institutionId: string };

export function decideInstitutionScope(
  user: InstitutionScopeUser | null | undefined,
  urlPath: string,
  institutionId: string | undefined,
): InstitutionScopeDecision {
  if (!isSchoolBound(user)) return { action: 'allow' };
  const segment = firstPathSegment(urlPath);
  if (!segment || !INSTITUTION_SCOPED_SEGMENTS.has(segment)) return { action: 'allow' };
  const allowed = allowedInstitutions(user);
  if (institutionId) {
    return allowed.includes(institutionId)
      ? { action: 'allow' }
      : { action: 'deny', institutionId };
  }
  const primary = allowed[0];
  return primary ? { action: 'inject', institutionId: primary } : { action: 'allow' };
}
