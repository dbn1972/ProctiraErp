const ADMIN_ROLES = ['admin', 'super-admin', 'super_admin', 'system_admin', 'principal', 'school_admin'];
const TEACHER_ROLES = ['teacher', 'class_teacher', 'subject_teacher', ...ADMIN_ROLES];
const REGISTRAR_ROLES = ['registrar', 'board_officer', 'examinations_officer', ...ADMIN_ROLES];

function normalizeRoles(
  roles: Array<{ roleId?: string; roleName?: string; id?: string }> | string[] | undefined,
): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((r) => {
      if (typeof r === 'string') return r.toLowerCase();
      return String(r.roleId ?? r.roleName ?? r.id ?? '').toLowerCase();
    })
    .filter(Boolean);
}

export function canSubmitGrades(roles: unknown): boolean {
  const names = normalizeRoles(roles as never);
  return names.some((n) => TEACHER_ROLES.includes(n));
}

export function canModerateGrades(roles: unknown): boolean {
  const names = normalizeRoles(roles as never);
  return names.some((n) => REGISTRAR_ROLES.includes(n));
}
