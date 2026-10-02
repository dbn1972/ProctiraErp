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
  // PRC-H022: lesson-plan writes name ?institutionId= so the gateway authorizes the school.
  'curriculum',
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
  return extractInstitutionIds(input)[0];
}

/**
 * Every institution id a request names, from query, params and body, under both the camelCase
 * and snake_case keys (PRC-H004: checking only the first match let `{institutionId: A,
 * institution_id: B}` through). Callers deny when any of them is out of scope.
 */
export function extractInstitutionIds(input: {
  query?: unknown;
  params?: unknown;
  body?: unknown;
}): string[] {
  const out: string[] = [];
  for (const source of [input.query, input.params, input.body]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const record = source as Record<string, unknown>;
    for (const key of ['institutionId', 'institution_id']) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0 && !out.includes(value)) out.push(value);
    }
  }
  return out;
}

/**
 * PRC-H004 (fix step 5): `/institutions/:id` routes address an institution record by `params.id`.
 * Returns that id so a school-bound caller cannot read or change another school's record. Static
 * sub-paths (e.g. `/institutions/directory-context`) have no `id` param and are unaffected.
 */
export function institutionRecordIdFromParams(
  urlPath: string,
  params: unknown,
): string | undefined {
  if (firstPathSegment(urlPath) !== 'institutions') return undefined;
  if (!params || typeof params !== 'object') return undefined;
  const id = (params as Record<string, unknown>)['id'];
  return typeof id === 'string' && id.length > 0 ? id : undefined;
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

/**
 * HTTP methods for which defaulting a missing institutionId to the caller's
 * primary institution is meaningful. GET/HEAD list handlers read
 * `query.institutionId` as a filter; no mutating-method route handler in this
 * repo reads it (writes are keyed by `:id` params or take their target
 * institution from the request body), so injecting a default there would be
 * dead data at best, and a value nobody actually supplied at worst.
 */
const INSTITUTION_INJECT_METHODS = new Set(['GET', 'HEAD']);

export function isInstitutionInjectionMethod(method: string | undefined): boolean {
  return !!method && INSTITUTION_INJECT_METHODS.has(method.toUpperCase());
}

export function decideInstitutionScope(
  user: InstitutionScopeUser | null | undefined,
  urlPath: string,
  institutionId: string | undefined,
  method?: string,
): InstitutionScopeDecision {
  if (!isSchoolBound(user)) return { action: 'allow' };
  const segment = firstPathSegment(urlPath);
  if (segment === 'institutions') {
    // Institution records: deny another school's id; never inject (list/directory untouched).
    if (institutionId && !allowedInstitutions(user).includes(institutionId)) {
      return { action: 'deny', institutionId };
    }
    return { action: 'allow' };
  }
  if (!segment || !INSTITUTION_SCOPED_SEGMENTS.has(segment)) return { action: 'allow' };
  const allowed = allowedInstitutions(user);
  if (institutionId) {
    return allowed.includes(institutionId)
      ? { action: 'allow' }
      : { action: 'deny', institutionId };
  }
  if (!isInstitutionInjectionMethod(method)) return { action: 'allow' };
  const primary = allowed[0];
  return primary ? { action: 'inject', institutionId: primary } : { action: 'allow' };
}
