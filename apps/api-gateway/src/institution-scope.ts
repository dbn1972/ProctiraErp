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

const SCOPE_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * PRC-H004 (fix step 2): what to do with a school-bound principal's write to a school-scoped
 * segment that names no institution (e.g. `PUT /students/:id` for a record of another school).
 * Defaulted: 'deny' (fail closed). Owner may change via GATEWAY_SCHOOL_SCOPE_UNRESOLVED_WRITES=allow
 * once every scoped domain handler re-checks the loaded record with assertInstitutionInScope().
 */
export type UnresolvedScopedWriteMode = 'deny' | 'allow';

export function resolveUnresolvedScopedWriteMode(
  env: Record<string, string | undefined> = process.env,
): UnresolvedScopedWriteMode {
  return env['GATEWAY_SCHOOL_SCOPE_UNRESOLVED_WRITES']?.trim().toLowerCase() === 'allow'
    ? 'allow'
    : 'deny';
}

/** True when the write must be refused because its target institution cannot be resolved. */
export function isUnresolvedScopedWrite(
  user: InstitutionScopeUser | null | undefined,
  urlPath: string,
  method: string | undefined,
  namedInstitutionIds: readonly string[],
  mode: UnresolvedScopedWriteMode,
): boolean {
  if (mode === 'allow') return false;
  if (!isSchoolBound(user)) return false;
  if (!method || !SCOPE_MUTATING_METHODS.has(method.toUpperCase())) return false;
  const segment = firstPathSegment(urlPath);
  if (!segment || !INSTITUTION_SCOPED_SEGMENTS.has(segment)) return false;
  return namedInstitutionIds.length === 0;
}

export class InstitutionOutOfScopeError extends Error {
  readonly statusCode = 403;
  readonly code = 'INSTITUTION_OUT_OF_SCOPE';
  constructor(readonly institutionId: string | null) {
    super('Institution is outside the caller school scope');
    this.name = 'InstitutionOutOfScopeError';
  }
}

/**
 * PRC-H004: shared per-handler check for keyed writes. Pass the institution of the *loaded*
 * record; throws for a school-bound principal when it is missing or outside their school set.
 */
export function assertInstitutionInScope(
  user: InstitutionScopeUser | null | undefined,
  institutionId: string | null | undefined,
): void {
  if (!isSchoolBound(user)) return;
  if (!institutionId || !allowedInstitutions(user).includes(institutionId)) {
    throw new InstitutionOutOfScopeError(institutionId ?? null);
  }
}

/**
 * PRC-H004 (fix step 6): school-bound callers only see their own schools in the directory
 * aggregates; tenant totals are recomputed from the visible schools.
 */
export function filterDirectoryContextForUser<
  T extends {
    studentsEnrolled: number | null;
    reportingToday: number | null;
    schools: Record<string, { studentCount: number | null; attendancePercent: number | null }>;
  },
>(context: T, user: InstitutionScopeUser | null | undefined): T {
  if (!isSchoolBound(user)) return context;
  const allowed = new Set(allowedInstitutions(user));
  const schools: T['schools'] = {} as T['schools'];
  for (const [id, school] of Object.entries(context.schools)) {
    if (allowed.has(id)) (schools as Record<string, unknown>)[id] = school;
  }
  const visible = Object.values(schools);
  return {
    ...context,
    schools,
    studentsEnrolled:
      context.studentsEnrolled === null
        ? null
        : visible.reduce((sum, s) => sum + (s.studentCount ?? 0), 0),
    reportingToday:
      context.reportingToday === null
        ? null
        : visible.filter((s) => s.attendancePercent !== null).length,
  };
}
