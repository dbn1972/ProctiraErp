/**
 * Scholarship domain RBAC (W1-SEC-02 residual).
 * Aid / finance / registrar roles manage programs, applications, and disbursements.
 * Teachers / viewers / empty roles are denied (fail closed).
 */
import { AppError } from '@proctira/common';

export type ScholarshipAction =
  | 'scholarship.read'
  | 'program.write'
  | 'application.submit'
  | 'application.decide'
  | 'disbursement.manage'
  | 'compliance.record';

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

const SCHOLARSHIP_OFFICER_ROLES = [
  'scholarship_officer',
  'financial_aid_officer',
  'aid_officer',
  'bursar',
  'finance_officer',
  'accountant',
  'registrar',
  'admissions_officer',
  ...ADMIN_ROLES,
] as const;

const ACTION_ROLES: Record<ScholarshipAction, readonly string[]> = {
  'scholarship.read': SCHOLARSHIP_OFFICER_ROLES,
  'program.write': SCHOLARSHIP_OFFICER_ROLES,
  'application.submit': SCHOLARSHIP_OFFICER_ROLES,
  'application.decide': [
    'scholarship_officer',
    'financial_aid_officer',
    'aid_officer',
    'bursar',
    'finance_officer',
    'principal',
    ...ADMIN_ROLES,
  ],
  'disbursement.manage': [
    'scholarship_officer',
    'financial_aid_officer',
    'aid_officer',
    'bursar',
    'finance_officer',
    'accountant',
    ...ADMIN_ROLES,
  ],
  'compliance.record': SCHOLARSHIP_OFFICER_ROLES,
};

export function normalizeScholarshipRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((role) => {
      if (typeof role === 'string') return role.toLowerCase();
      if (role && typeof role === 'object') {
        const obj = role as { roleId?: string; roleName?: string; id?: string };
        return String(obj.roleId ?? obj.roleName ?? obj.id ?? '').toLowerCase();
      }
      return '';
    })
    .filter(Boolean);
}

export function hasScholarshipAccess(roles: unknown, action: ScholarshipAction): boolean {
  const normalized = normalizeScholarshipRoles(roles);
  if (normalized.length === 0) return false;
  const allowed = ACTION_ROLES[action];
  return normalized.some((role) => allowed.includes(role));
}

export function assertScholarshipAccess(roles: unknown, action: ScholarshipAction): void {
  if (!hasScholarshipAccess(roles, action)) {
    throw new AppError(
      `Forbidden: role cannot perform scholarship action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}
