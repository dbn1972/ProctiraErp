/**
 * PRC-L034 — negative authz for dashboard domain layouts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ServerSession } from '@/lib/auth/server';
import {
  canAccessDashboardDomain,
  DASHBOARD_DOMAIN_RESOURCES,
  DOMAIN_ROUTE_ROLE_IDS,
  HOSTEL_PACKAGE_ROLE_IDS,
  TRANSPORT_PACKAGE_ROLE_IDS,
  type DashboardDomain,
} from './domain-route-guards';

/**
 * Gateway role catalogue (`createGatewayRbacRegistry` in
 * apps/api-gateway/src/rbac-registry.ts: DEFAULT_ROLES plus platform_admin).
 * A role outside it gets 403 from the gateway whatever the package allows.
 */
const GATEWAY_ROLE_IDS: ReadonlySet<string> = new Set([
  'super-admin',
  'admin',
  'principal',
  'teacher',
  'staff',
  'guardian',
  'hr_officer',
  'staff_admin',
  'registrar',
  'admissions_officer',
  'counsellor',
  'discipline_officer',
  'nurse',
  'parent',
  'student',
  'platform_admin',
]);

interface DomainCase {
  domain: DashboardDomain;
  allowed: string[];
  denied: string[];
  /** Backend package read check; absent when the gateway grant is the only check. */
  packageFile?: string;
}

/** A-batch role table (plan.md PR A): gateway read grant ∩ backend package read roles. */
const A_BATCH_REGISTRY_DOMAINS: DomainCase[] = [
  {
    domain: 'academic-periods',
    allowed: ['admin', 'principal', 'teacher', 'staff', 'super-admin', 'platform_admin'],
    denied: ['student', 'guardian', 'parent', 'nurse', 'hr_officer', 'registrar'],
  },
  {
    domain: 'institutions',
    allowed: ['admin', 'principal', 'teacher', 'staff', 'super-admin', 'platform_admin'],
    denied: ['student', 'guardian', 'parent', 'nurse', 'hr_officer', 'registrar'],
  },
  {
    domain: 'tenant-lifecycle',
    allowed: ['platform_admin', 'super-admin'],
    denied: ['admin', 'principal', 'teacher', 'staff', 'student'],
  },
];

const A_BATCH_SET_DOMAINS: DomainCase[] = [
  {
    domain: 'admissions',
    allowed: ['admin', 'principal', 'super-admin'],
    denied: [
      'teacher',
      'staff',
      'registrar',
      'admissions_officer',
      'platform_admin',
      'student',
      'guardian',
      'parent',
    ],
    packageFile: 'registration/src/registration-access.ts',
  },
  {
    domain: 'assessments',
    allowed: ['admin', 'principal', 'teacher', 'super-admin'],
    denied: ['staff', 'registrar', 'platform_admin', 'student', 'guardian', 'parent'],
    packageFile: 'assessment/src/assessment-access.ts',
  },
  {
    domain: 'fees',
    allowed: ['admin', 'principal', 'super-admin'],
    denied: ['teacher', 'staff', 'registrar', 'platform_admin', 'student', 'guardian', 'parent'],
    packageFile: 'fees/src/fees-access.ts',
  },
  {
    domain: 'library',
    allowed: ['admin', 'principal', 'super-admin'],
    denied: ['teacher', 'staff', 'registrar', 'platform_admin', 'student', 'guardian', 'parent'],
    packageFile: 'library/src/library-access.ts',
  },
  {
    domain: 'lms',
    allowed: ['admin', 'principal', 'teacher', 'super-admin'],
    denied: ['staff', 'registrar', 'platform_admin', 'student', 'parent'],
    packageFile: 'lms/src/lms-access.ts',
  },
  {
    domain: 'pipelines',
    allowed: ['admin', 'principal', 'super-admin'],
    denied: ['teacher', 'staff', 'platform_admin', 'student', 'guardian'],
    packageFile: 'etl/src/etl-access.ts',
  },
  {
    domain: 'reports',
    allowed: ['admin', 'principal', 'teacher', 'super-admin'],
    denied: [
      'staff',
      'registrar',
      'admissions_officer',
      'staff_admin',
      'platform_admin',
      'guardian',
      'parent',
    ],
    packageFile: 'report/src/report-access.ts',
  },
  {
    domain: 'scholarships',
    allowed: ['admin', 'principal', 'super-admin'],
    denied: ['teacher', 'staff', 'registrar', 'admissions_officer', 'platform_admin', 'student'],
    packageFile: 'scholarship/src/scholarship-access.ts',
  },
  {
    domain: 'staff',
    allowed: [
      'admin',
      'principal',
      'super-admin',
      'hr_officer',
      'staff_admin',
      'registrar',
      'admissions_officer',
    ],
    denied: ['teacher', 'staff', 'nurse', 'platform_admin', 'student', 'guardian'],
    packageFile: 'staff/src/staff-access.ts',
  },
  {
    domain: 'students',
    allowed: ['admin', 'principal', 'teacher', 'staff', 'nurse', 'super-admin'],
    denied: ['registrar', 'hr_officer', 'platform_admin', 'student', 'guardian', 'parent'],
    packageFile: 'student/src/student-access.ts',
  },
  {
    domain: 'workflows',
    allowed: ['admin', 'principal', 'teacher', 'staff', 'super-admin', 'platform_admin'],
    denied: ['registrar', 'hr_officer', 'nurse', 'student', 'guardian', 'parent'],
  },
];

function session(roleIds: string[]): ServerSession {
  return {
    accessToken: 'test-token',
    refreshToken: null,
    isExpired: false,
    user: {
      sub: 'user-1',
      tenantId: 'tenant-a',
      email: 'test@tenant-a.test',
      roles: roleIds.map((roleId) => ({ roleId, roleName: roleId, areaId: 'area-1' })),
      iat: 0,
      exp: 9999999999,
    },
  };
}

describe('dashboard domain route guards (PRC-L034)', () => {
  it('denies a student session on /communication (emergency) and other staff domains', () => {
    for (const domain of Object.keys(DASHBOARD_DOMAIN_RESOURCES) as Array<
      keyof typeof DASHBOARD_DOMAIN_RESOURCES
    >) {
      expect(canAccessDashboardDomain(session(['student']), domain)).toBe(false);
      expect(canAccessDashboardDomain(session(['guardian']), domain)).toBe(false);
      expect(canAccessDashboardDomain(session(['parent']), domain)).toBe(false);
    }
  });

  it('denies users with no roles', () => {
    expect(canAccessDashboardDomain(session([]), 'attendance')).toBe(false);
  });

  it('allows staff roles for their domains', () => {
    expect(canAccessDashboardDomain(session(['teacher']), 'attendance')).toBe(true);
    expect(canAccessDashboardDomain(session(['teacher']), 'communication')).toBe(true);
    expect(canAccessDashboardDomain(session(['admin']), 'communication')).toBe(true);
    expect(canAccessDashboardDomain(session(['admin']), 'data-warehouse')).toBe(true);
  });

  it('restricts platform surfaces to platform administrators', () => {
    expect(canAccessDashboardDomain(session(['admin']), 'billing')).toBe(false);
    expect(canAccessDashboardDomain(session(['admin']), 'audit-logs')).toBe(false);
    expect(canAccessDashboardDomain(session(['platform_admin']), 'billing')).toBe(true);
    expect(canAccessDashboardDomain(session(['super-admin']), 'audit-logs')).toBe(true);
  });

  it('T-D1: grants transport only where the gateway and the transport package both allow it', () => {
    // Gateway grant (rbac-registry.ts) AND package guard (transport-access.ts).
    for (const roles of [['admin'], ['principal'], ['super-admin'], ['PRINCIPAL']]) {
      expect(canAccessDashboardDomain(session(roles), 'transport'), roles.join()).toBe(true);
    }
    for (const roles of [
      // Gateway STAFF_READS grants transport.read, the package guard denies.
      ['teacher'],
      ['staff'],
      // Gateway grants '*', the package guard has no platform role.
      ['platform_admin'],
      // T-O1: package allows, the gateway registry has no such role (403).
      ['transport_officer'],
      ['transport-manager'],
      ['fleet_manager'],
      ['transport_admin'],
      ['registrar'],
      ['student'],
      ['guardian'],
      [],
    ]) {
      expect(canAccessDashboardDomain(session(roles), 'transport'), roles.join()).toBe(false);
    }
    // Any role carrying both grants is enough, as at the gateway.
    expect(canAccessDashboardDomain(session(['teacher', 'principal']), 'transport')).toBe(true);
  });

  it('T-D1: mirrors every transport package role the web guard lets through', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../../packages/backend/transport/src/transport-access.ts'),
      'utf8',
    );
    const packageRoles = new Set(
      [...src.matchAll(/^\s+'([a-z_-]+)',$/gm)].map((match) => match[1]!.toLowerCase()),
    );
    expect(packageRoles.size).toBeGreaterThan(0);
    for (const roleId of TRANSPORT_PACKAGE_ROLE_IDS) {
      expect(packageRoles.has(roleId), roleId).toBe(true);
    }
    for (const roleId of packageRoles) {
      expect(TRANSPORT_PACKAGE_ROLE_IDS.has(roleId), roleId).toBe(true);
    }
  });

  it('H-D1: grants hostel only where the gateway and the hostel package both allow it', () => {
    // Gateway grant (rbac-registry.ts) AND package guard (hostel-access.ts).
    for (const roles of [['admin'], ['principal'], ['super-admin'], ['ADMIN']]) {
      expect(canAccessDashboardDomain(session(roles), 'hostel'), roles.join()).toBe(true);
    }
    for (const roles of [
      // Gateway STAFF_READS grants hostel.read, the package guard denies.
      ['teacher'],
      ['staff'],
      // Gateway grants '*', the package guard has no platform role.
      ['platform_admin'],
      // H-D2: package allows, the gateway registry grants them no `hostel` (403).
      ['warden'],
      ['hostel_warden'],
      ['hostel-manager'],
      ['hostel_admin'],
      ['hostel_clerk'],
      ['registrar'],
      // Fee roles: no gateway `hostel` grant either.
      ['bursar'],
      ['accountant'],
      // Portal roles (the gateway grants student hostel.read, the package denies).
      ['student'],
      ['parent'],
      ['guardian'],
      [],
    ]) {
      expect(canAccessDashboardDomain(session(roles), 'hostel'), roles.join()).toBe(false);
    }
    expect(canAccessDashboardDomain(session(['teacher', 'principal']), 'hostel')).toBe(true);
  });

  it('H-D1: mirrors the hostel package hostel.read roles exactly', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../../packages/backend/hostel/src/hostel-access.ts'),
      'utf8',
    );
    const block = (name: string): string[] => {
      const body = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(src)?.[1];
      expect(body, name).toBeDefined();
      return [...body!.matchAll(/'([a-z_-]+)'/g)].map((match) => match[1]!);
    };
    expect(src).toMatch(/'hostel\.read': HOSTEL_STAFF_ROLES,/);
    expect(block('HOSTEL_STAFF_ROLES')).toContain('warden');
    expect(src).toMatch(
      /const HOSTEL_STAFF_ROLES = \[[\s\S]*?\.\.\.ADMIN_ROLES,[\s\S]*?\] as const;/,
    );
    const packageRoles = new Set([...block('HOSTEL_STAFF_ROLES'), ...block('ADMIN_ROLES')]);
    expect([...HOSTEL_PACKAGE_ROLE_IDS].sort()).toEqual([...packageRoles].sort());
  });

  for (const { domain, allowed, denied } of [...A_BATCH_REGISTRY_DOMAINS, ...A_BATCH_SET_DOMAINS]) {
    it(`A-batch: ${domain} allows ${allowed.join(', ')} and denies the rest`, () => {
      expect(DASHBOARD_DOMAIN_RESOURCES).toHaveProperty(domain);
      for (const roleId of allowed) {
        expect(canAccessDashboardDomain(session([roleId]), domain), roleId).toBe(true);
      }
      expect(canAccessDashboardDomain(session([allowed[0]!.toUpperCase()]), domain)).toBe(true);
      for (const roleId of denied) {
        expect(canAccessDashboardDomain(session([roleId]), domain), roleId).toBe(false);
      }
      expect(canAccessDashboardDomain(session([]), domain)).toBe(false);
    });
  }

  it('A-batch: fees is served when any single role is in the set, fail-closed otherwise', () => {
    expect(canAccessDashboardDomain(session(['teacher', 'principal']), 'fees')).toBe(true);
    // The gateway serves this pair (teacher grant + bursar package role); the
    // web guard needs one role in the intersection and stays closed.
    expect(canAccessDashboardDomain(session(['teacher', 'bursar']), 'fees')).toBe(false);
  });

  it('A-batch: registry domains keep the web RBAC registry check (no explicit set)', () => {
    for (const { domain } of A_BATCH_REGISTRY_DOMAINS) {
      expect(DOMAIN_ROUTE_ROLE_IDS[domain], domain).toBeUndefined();
    }
  });

  for (const { domain, allowed, packageFile } of A_BATCH_SET_DOMAINS) {
    it(`A-batch: ${domain} role set holds gateway roles${packageFile ? ' the package reads' : ''}`, () => {
      const set = DOMAIN_ROUTE_ROLE_IDS[domain];
      expect(set, domain).toBeDefined();
      expect([...set!].sort()).toEqual([...allowed].sort());
      for (const roleId of set!) {
        expect(GATEWAY_ROLE_IDS.has(roleId), `${roleId} in gateway catalogue`).toBe(true);
      }
      if (!packageFile) return;
      const src = readFileSync(
        resolve(__dirname, `../../../../../packages/backend/${packageFile}`),
        'utf8',
      );
      for (const roleId of set!) {
        expect(src, `${roleId} in ${packageFile}`).toContain(`'${roleId}'`);
      }
    });
  }

  it('wires every domain layout to the guard', () => {
    for (const domain of Object.keys(DASHBOARD_DOMAIN_RESOURCES)) {
      const src = readFileSync(
        resolve(__dirname, `../../app/(dashboard)/${domain}/layout.tsx`),
        'utf8',
      );
      expect(src).toContain(`canAccessDashboardDomain(session, '${domain}')`);
      expect(src).toContain('RouteAccessDenied');
    }
  });
});
