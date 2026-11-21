/**
 * PRC-L034 — negative authz for dashboard domain layouts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ServerSession } from '@/lib/auth/server';
import {
  canAccessDashboardDomain,
  DASHBOARD_DOMAIN_RESOURCES,
  DOMAIN_ROUTE_ROLE_IDS,
  canAccessReportRoleDashboard,
  HOSTEL_PACKAGE_ROLE_IDS,
  REPORT_ROLE_DASHBOARD_ROLE_IDS,
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

/** Gateway `report:read` holders (evidence rbac-matrix.json, rbac-registry.ts). */
const GATEWAY_REPORT_READ_ROLE_IDS: ReadonlySet<string> = new Set([
  'super-admin',
  'admin',
  'principal',
  'teacher',
  'staff',
  'guardian',
  'parent',
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
    for (const roles of [
      ['admin'],
      ['principal'],
      ['super-admin'],
      ['PRINCIPAL'],
      // T-O1: the gateway now grants the transport package staff roles.
      ['transport_officer'],
      ['transport-officer'],
      ['transport_manager'],
      ['transport-manager'],
      ['fleet_manager'],
      ['fleet-manager'],
      ['transport_admin'],
      ['transport-admin'],
      // Read-only at the gateway (writes are 403 there).
      ['registrar'],
    ]) {
      expect(canAccessDashboardDomain(session(roles), 'transport'), roles.join()).toBe(true);
    }
    for (const roles of [
      // Gateway STAFF_READS grants transport.read, the package guard denies.
      ['teacher'],
      ['staff'],
      // Gateway grants '*', the package guard has no platform role.
      ['platform_admin'],
      // Hostel staff hold no transport grant at the gateway or in the package.
      ['warden'],
      ['hostel_manager'],
      ['student'],
      ['parent'],
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
    for (const roles of [
      ['admin'],
      ['principal'],
      ['super-admin'],
      ['ADMIN'],
      // H-D2: the gateway now grants the hostel package staff roles.
      ['warden'],
      ['hostel_warden'],
      ['hostel-warden'],
      ['hostel_manager'],
      ['hostel-manager'],
      ['hostel_admin'],
      ['hostel-admin'],
      ['hostel_clerk'],
      // Read-only at the gateway (writes are 403 there).
      ['registrar'],
    ]) {
      expect(canAccessDashboardDomain(session(roles), 'hostel'), roles.join()).toBe(true);
    }
    for (const roles of [
      // Gateway STAFF_READS grants hostel.read, the package guard denies.
      ['teacher'],
      ['staff'],
      // Gateway grants '*', the package guard has no platform role.
      ['platform_admin'],
      // Transport staff hold no hostel grant at the gateway or in the package.
      ['transport_officer'],
      ['fleet_manager'],
      // Fee roles: no gateway `hostel` grant (residual, not in this change).
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

  it('MR-1: a multi-role session gets the gateway answer (one role grants, another passes the package)', () => {
    // Each pair is served by the gateway (apps/api-gateway rbac-campus-roles.test.ts).
    const served: Array<[string[], 'hostel' | 'transport']> = [
      [['teacher', 'transport_officer'], 'transport'],
      [['teacher', 'registrar'], 'transport'],
      [['teacher', 'registrar'], 'hostel'],
      [['staff', 'hostel_manager'], 'hostel'],
      [['student', 'warden'], 'hostel'],
      // The grant comes only from teacher/staff (gateway STAFF_READS): the
      // package role has no web or gateway registry entry.
      [['teacher', 'school_admin'], 'hostel'],
      [['staff', 'school-admin'], 'transport'],
      [['teacher', 'system_admin'], 'transport'],
    ];
    for (const [roles, domain] of served) {
      expect(canAccessDashboardDomain(session(roles), domain), `${roles.join('+')} ${domain}`).toBe(
        true,
      );
    }
    const denied: Array<[string[], 'hostel' | 'transport']> = [
      // Package role without any gateway grant on the domain.
      [['school_admin'], 'hostel'],
      [['system-admin'], 'transport'],
      [['guardian', 'school_admin'], 'hostel'],
      [['parent', 'school_admin'], 'transport'],
      // Gateway readers without a package role.
      [['teacher', 'staff'], 'hostel'],
      [['teacher', 'guardian'], 'transport'],
      // A role for the other domain does not open this one.
      [['teacher', 'warden'], 'transport'],
      [['staff', 'transport_officer'], 'hostel'],
      [['guardian'], 'hostel'],
      [['guardian'], 'transport'],
    ];
    for (const [roles, domain] of denied) {
      expect(canAccessDashboardDomain(session(roles), domain), `${roles.join('+')} ${domain}`).toBe(
        false,
      );
    }
  });

  it('MR-1: the base-reader rule does not leak into other domains', () => {
    // school_admin is in neither registry; teacher holds no web `platform` grant.
    expect(canAccessDashboardDomain(session(['teacher', 'school_admin']), 'billing')).toBe(false);
    expect(canAccessDashboardDomain(session(['teacher', 'school_admin']), 'audit-logs')).toBe(
      false,
    );
    expect(canAccessDashboardDomain(session(['staff', 'school_admin']), 'data-warehouse')).toBe(
      canAccessDashboardDomain(session(['staff']), 'data-warehouse'),
    );
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

  it('A-batch: the report role dashboard admits staff, the report catalogue does not', () => {
    // GET /api/v1/reports/dashboard (packages/backend/report/src/catalogue-routes.ts:642)
    // serves any gateway report:read holder; the catalogue routes add requireReportStaff.
    for (const roleId of ['admin', 'principal', 'teacher', 'staff', 'super-admin', 'STAFF']) {
      expect(canAccessReportRoleDashboard(session([roleId])), roleId).toBe(true);
    }
    for (const roleId of [
      'registrar',
      'admissions_officer',
      'staff_admin',
      'hr_officer',
      'counsellor',
      'nurse',
      'platform_admin',
      'student',
      'guardian',
      'parent',
    ]) {
      expect(canAccessReportRoleDashboard(session([roleId])), roleId).toBe(false);
    }
    expect(canAccessReportRoleDashboard(session([]))).toBe(false);
    expect(canAccessDashboardDomain(session(['staff']), 'reports')).toBe(false);
  });

  it('A-batch: the report role dashboard set is gateway report:read minus portal roles', () => {
    expect([...REPORT_ROLE_DASHBOARD_ROLE_IDS].sort()).toEqual(
      ['admin', 'principal', 'teacher', 'staff', 'super-admin'].sort(),
    );
    for (const roleId of REPORT_ROLE_DASHBOARD_ROLE_IDS) {
      expect(GATEWAY_REPORT_READ_ROLE_IDS.has(roleId), `${roleId} has gateway report:read`).toBe(
        true,
      );
    }
    for (const roleId of DOMAIN_ROUTE_ROLE_IDS.reports!) {
      expect(REPORT_ROLE_DASHBOARD_ROLE_IDS.has(roleId), roleId).toBe(true);
    }
    const src = readFileSync(
      resolve(__dirname, '../../../../../packages/backend/report/src/catalogue-routes.ts'),
      'utf8',
    );
    const start = src.indexOf('fastify.get(`${prefix}/dashboard`');
    expect(start, 'dashboard handler').toBeGreaterThan(-1);
    const end = src.indexOf('fastify.', start + 1);
    const handler = src.slice(start, end === -1 ? undefined : end);
    // If the package adds a staff check here, narrow the web set to match.
    expect(handler).not.toContain('requireReportStaff');
  });

  it('A-batch: only the role-dashboard pages use the report role-dashboard check', () => {
    const app = resolve(__dirname, '../../app/(dashboard)');
    const users = pageFiles(app)
      .filter((file) => readFileSync(file, 'utf8').includes('hasReportRoleDashboardRouteAccess('))
      .map((file) => relative(app, file))
      .sort();
    expect(users).toEqual(Object.keys(SECTION_PAGE_GUARDS).sort());
  });

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

  it('A-batch: every page of a page-guarded domain checks access before it renders', () => {
    const unguarded: string[] = [];
    for (const domain of Object.keys(DASHBOARD_DOMAIN_RESOURCES) as DashboardDomain[]) {
      if (LAYOUT_ONLY_DOMAINS.has(domain)) continue;
      const pages = pageFiles(resolve(__dirname, `../../app/(dashboard)/${domain}`));
      expect(pages.length, domain).toBeGreaterThan(0);
      for (const file of pages) {
        if (!pageChecksAccess(file, domain)) {
          unguarded.push(relative(resolve(__dirname, '../../app'), file));
        }
      }
    }
    expect(unguarded).toEqual([]);
  });

  it('A-batch: the layout-only exception list names only domains still without page checks', () => {
    // Remove a domain from LAYOUT_ONLY_DOMAINS once its pages are guarded.
    for (const domain of LAYOUT_ONLY_DOMAINS) {
      expect(DASHBOARD_DOMAIN_RESOURCES, domain).toHaveProperty(domain);
      const pages = pageFiles(resolve(__dirname, `../../app/(dashboard)/${domain}`));
      const guarded = pages.filter((file) => pageChecksAccess(file, domain));
      expect(guarded.length, `${domain} has page checks; drop it from the list`).toBeLessThan(
        pages.length,
      );
    }
  });
});

/**
 * Domains guarded by their layout before T-D1 whose pages do not yet call
 * `hasDashboardDomainRouteAccess` (outside the A-batch page list; follow-up).
 */
const LAYOUT_ONLY_DOMAINS: ReadonlySet<DashboardDomain> = new Set<DashboardDomain>([
  'attendance',
  'communication',
  'audit-logs',
  'billing',
  'data-warehouse',
]);

/**
 * Pages that check a section role set instead of their domain set, keyed by
 * path under app/(dashboard). The report role dashboard serves office `staff`
 * (packages/backend/report/src/catalogue-routes.ts:642).
 */
const SECTION_PAGE_GUARDS: Readonly<Record<string, string>> = {
  'reports/dashboard/page.tsx': 'hasReportRoleDashboardRouteAccess(',
  'reports/dashboards/page.tsx': 'hasReportRoleDashboardRouteAccess(',
};

function pageChecksAccess(file: string, domain: DashboardDomain): boolean {
  const section = SECTION_PAGE_GUARDS[relative(resolve(__dirname, '../../app/(dashboard)'), file)];
  return readFileSync(file, 'utf8').includes(
    section ?? `hasDashboardDomainRouteAccess('${domain}'`,
  );
}

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return entry.name === 'page.tsx' ? [path] : [];
  });
}
