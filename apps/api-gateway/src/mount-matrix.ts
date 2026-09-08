/**
 * G-003 gateway mount matrix — TypeScript source of truth.
 *
 * Documents which `packages/backend/*` plugins (and gateway UI plugins) are
 * live on the api-gateway. Keep in sync with:
 *   - `DOMAIN_REGISTRAR_NAMES` in `domain-plugins.ts`
 *   - `docs/audits/GATEWAY_MOUNT_MATRIX.md`
 *
 * RBAC: `rbacPlugin` is not registered on the gateway (see G-101). Domains
 * rely on JWT presence only unless noted otherwise.
 */

export type PersistenceKind =
  | 'prisma+rls'
  | 'raw-pg'
  | 'mixed'
  | 'in-memory'
  | 'ui-seed'
  | 'n/a';

export interface MountMatrixEntry {
  /** `packages/backend/<dir>` name, or a gateway-only id (e.g. `insights-ui`). */
  package: string;
  /** Whether routes for this entry are served by the gateway today. */
  mounted: boolean;
  /** URL prefixes under `/api/v1` (proxyPrefixes and/or plugin native prefixes). */
  prefixes: readonly string[];
  persistence: PersistenceKind;
  /** Fine-grained permission checks via `rbacPlugin` (G-101). */
  rbacWired: boolean;
  notes: string;
  /**
   * When set, this entry is backed by a `DOMAIN_REGISTRARS` name in
   * `domain-plugins.ts`. Gateway-only mounts (auth) omit this.
   */
  registrarName?: string;
}

/**
 * Packages under `packages/backend/*` that are mounted live on the gateway
 * (via `DOMAIN_REGISTRARS` or direct `app.ts` registration).
 */
export const EXPECTED_MOUNTED: readonly string[] = [
  'assessment',
  'attendance',
  'auth',
  'communication',
  'examination',
  'gradebook',
  'health',
  'hostel',
  'institution',
  'library',
  'notification',
  'parent-portal',
  'registration',
  'scholarship',
  'staff',
  'student',
  'timetable',
  'transport',
] as const;

/**
 * Packages under `packages/backend/*` that export plugins but are NOT mounted
 * on the gateway (routes fall through to proxy or are absent).
 */
export const EXPECTED_UNMOUNTED: readonly string[] = [
  'admin-dashboard',
  'audit',
  'billing',
  'custom-field',
  'dashboards',
  'data-warehouse',
  'developer-portal',
  'etl',
  'install',
  'plugin',
  'policy',
  'report',
  'survey',
  'tenant',
  'theme',
  'workflow',
] as const;

/**
 * Full matrix rows: every `packages/backend/*` package plus gateway UI-only
 * registrars (`insights`, `platform-admin`, `workflow` UI).
 */
export const MOUNT_MATRIX: readonly MountMatrixEntry[] = [
  // —— Mounted domain packages (DOMAIN_REGISTRARS) ——
  {
    package: 'student',
    mounted: true,
    prefixes: ['/students'],
    persistence: 'prisma+rls',
    rbacWired: false,
    notes: 'Prisma when DATABASE_URL set, else in-memory. JWT only (G-101).',
    registrarName: 'student',
  },
  {
    package: 'institution',
    mounted: true,
    prefixes: ['/institutions'],
    persistence: 'prisma+rls',
    rbacWired: false,
    notes: 'Prisma when DATABASE_URL set, else in-memory.',
    registrarName: 'institution',
  },
  {
    package: 'staff',
    mounted: true,
    prefixes: ['/staff'],
    persistence: 'prisma+rls',
    rbacWired: false,
    notes: 'Staff + assignments; Prisma when DATABASE_URL set.',
    registrarName: 'staff',
  },
  {
    package: 'attendance',
    mounted: true,
    prefixes: ['/attendance'],
    persistence: 'prisma+rls',
    rbacWired: false,
    notes: 'Prisma when DATABASE_URL set, else in-memory.',
    registrarName: 'attendance',
  },
  {
    package: 'examination',
    mounted: true,
    prefixes: ['/examinations'],
    persistence: 'prisma+rls',
    rbacWired: false,
    notes: 'Exams + results + documents; Prisma when DATABASE_URL set.',
    registrarName: 'examination',
  },
  {
    package: 'assessment',
    mounted: true,
    prefixes: [
      '/assessments',
      '/grading-schemes',
      '/assessment-items',
      '/outcomes',
      '/results',
    ],
    persistence: 'prisma+rls',
    rbacWired: false,
    notes:
      'Proxy prefix `/assessments`; native routes under grading-schemes/items/outcomes/results. Report-card repos unwired (routes disabled).',
    registrarName: 'assessment',
  },
  {
    package: 'timetable',
    mounted: true,
    prefixes: ['/timetable'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes: 'Raw pg (003_sis_timetable_schedule_schema.sql) when DATABASE_URL set.',
    registrarName: 'timetable',
  },
  {
    package: 'gradebook',
    mounted: true,
    prefixes: ['/gradebook'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes: 'Raw pg (003/004) when DATABASE_URL set; else in-memory.',
    registrarName: 'gradebook',
  },
  {
    package: 'scholarship',
    mounted: true,
    prefixes: ['/scholarships'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes: 'Raw pg (016_scholarships_schema.sql) when DATABASE_URL set; else in-memory + demo seed (G-204).',
    registrarName: 'scholarship',
  },
  {
    package: 'health',
    mounted: true,
    prefixes: ['/health'],
    persistence: 'mixed',
    rbacWired: false,
    notes:
      'Counselling + profile/screening PHI via raw pg when DATABASE_URL; special-needs in-memory. Also mounts healthUiPlugin.',
    registrarName: 'health',
  },
  {
    package: 'notification',
    mounted: true,
    prefixes: ['/notifications'],
    persistence: 'mixed',
    rbacWired: false,
    notes: 'Delivery records in-memory; prefs/devices raw pg when DATABASE_URL (005).',
    registrarName: 'notification',
  },
  {
    package: 'transport',
    mounted: true,
    prefixes: ['/transport'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes: 'Raw pg (006_transport_schema.sql) when DATABASE_URL set.',
    registrarName: 'transport',
  },
  {
    package: 'communication',
    mounted: true,
    prefixes: ['/communication'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes: 'Raw pg (007_communication_schema.sql) when DATABASE_URL set.',
    registrarName: 'communication',
  },
  {
    package: 'hostel',
    mounted: true,
    prefixes: ['/hostel'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes: 'Raw pg (008_hostel_schema.sql) when DATABASE_URL set.',
    registrarName: 'hostel',
  },
  {
    package: 'library',
    mounted: true,
    prefixes: ['/library'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes: 'Raw pg (009_library_schema.sql) when DATABASE_URL set.',
    registrarName: 'library',
  },
  {
    package: 'parent-portal',
    mounted: true,
    prefixes: ['/parent-portal'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes: 'Raw pg (010_parent_portal_schema.sql) when DATABASE_URL set.',
    registrarName: 'parent-portal',
  },
  {
    package: 'registration',
    mounted: true,
    prefixes: ['/registrations'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes: 'Raw pg (014_admissions_crm_schema.sql) when DATABASE_URL set; else in-memory (G-205).',
    registrarName: 'registration',
  },

  // —— Mounted outside DOMAIN_REGISTRARS ——
  {
    package: 'auth',
    mounted: true,
    prefixes: ['/auth'],
    persistence: 'in-memory',
    rbacWired: false,
    notes:
      'Registered directly in `app.ts` (not DOMAIN_REGISTRARS). JWT + sessions; `rbacPlugin` exported but not registered (G-101).',
  },

  // —— Gateway UI-only registrars (no packages/backend package) ——
  {
    package: 'insights-ui',
    mounted: true,
    prefixes: ['/reports', '/data-warehouse'],
    persistence: 'ui-seed',
    rbacWired: false,
    notes:
      'insightsUiPlugin aggregates; real `report` / `data-warehouse` packages unmounted (G-209).',
    registrarName: 'insights',
  },
  {
    package: 'platform-admin-ui',
    mounted: true,
    prefixes: [
      '/tenants',
      '/plugins',
      '/break-glass',
      '/plans',
      '/themes',
      '/platform',
      '/audit',
    ],
    persistence: 'ui-seed',
    rbacWired: false,
    notes:
      'platformAdminUiPlugin stub/scaffold APIs; real tenant/plugin/theme/audit packages unmounted (G-104).',
    registrarName: 'platform-admin',
  },
  {
    package: 'workflow-ui',
    mounted: true,
    prefixes: ['/workflows'],
    persistence: 'ui-seed',
    rbacWired: false,
    notes:
      'workflowUiPlugin seed lists; real `@proctira/backend-workflow` unmounted (G-208). Registrar name `workflow`.',
    registrarName: 'workflow',
  },

  // —— Unmounted packages/backend/* ——
  {
    package: 'admin-dashboard',
    mounted: false,
    prefixes: ['/admin/scalability'],
    persistence: 'n/a',
    rbacWired: false,
    notes: 'Plugin exists; not registered on gateway.',
  },
  {
    package: 'audit',
    mounted: false,
    prefixes: ['/audit'],
    persistence: 'n/a',
    rbacWired: false,
    notes: 'Unmounted; `/audit` served by platform-admin UI stub instead (G-105).',
  },
  {
    package: 'billing',
    mounted: false,
    prefixes: ['/billing'],
    persistence: 'n/a',
    rbacWired: false,
    notes: 'Unmounted (G-106).',
  },
  {
    package: 'custom-field',
    mounted: false,
    prefixes: ['/custom-fields'],
    persistence: 'n/a',
    rbacWired: false,
    notes: 'Unmounted (G-605).',
  },
  {
    package: 'dashboards',
    mounted: false,
    prefixes: ['/dashboards'],
    persistence: 'n/a',
    rbacWired: false,
    notes: 'Unmounted (G-605).',
  },
  {
    package: 'data-warehouse',
    mounted: false,
    prefixes: ['/warehouses'],
    persistence: 'n/a',
    rbacWired: false,
    notes: 'Unmounted; insights UI owns `/data-warehouse` (G-209).',
  },
  {
    package: 'developer-portal',
    mounted: false,
    prefixes: ['/developer'],
    persistence: 'n/a',
    rbacWired: false,
    notes: 'Unmounted; Other Portals use honesty-demo paths.',
  },
  {
    package: 'etl',
    mounted: false,
    prefixes: ['/pipelines'],
    persistence: 'n/a',
    rbacWired: false,
    notes: 'Unmounted (G-209).',
  },
  {
    package: 'install',
    mounted: false,
    prefixes: ['/install'],
    persistence: 'n/a',
    rbacWired: false,
    notes: 'Unmounted; install wizard is portal/demo scoped.',
  },
  {
    package: 'plugin',
    mounted: false,
    prefixes: ['/plugins'],
    persistence: 'n/a',
    rbacWired: false,
    notes: 'Unmounted; `/plugins` served by platform-admin UI stub.',
  },
  {
    package: 'policy',
    mounted: false,
    prefixes: ['/policies'],
    persistence: 'n/a',
    rbacWired: false,
    notes: 'Unmounted (G-106).',
  },
  {
    package: 'report',
    mounted: false,
    prefixes: ['/reports'],
    persistence: 'n/a',
    rbacWired: false,
    notes: 'Unmounted; insights UI owns `/reports` (G-209).',
  },
  {
    package: 'survey',
    mounted: false,
    prefixes: ['/surveys'],
    persistence: 'n/a',
    rbacWired: false,
    notes: 'Unmounted (G-605).',
  },
  {
    package: 'tenant',
    mounted: false,
    prefixes: ['/tenants'],
    persistence: 'n/a',
    rbacWired: false,
    notes:
      'tenantLifecyclePlugin unmounted; `/tenants` served by platform-admin UI (G-106). Shared `@proctira/tenant` package still resolves JWT tenant on the gateway.',
  },
  {
    package: 'theme',
    mounted: false,
    prefixes: ['/themes'],
    persistence: 'n/a',
    rbacWired: false,
    notes: 'Unmounted; `/themes` served by platform-admin UI stub (G-605).',
  },
  {
    package: 'workflow',
    mounted: false,
    prefixes: ['/workflows'],
    persistence: 'n/a',
    rbacWired: false,
    notes:
      'Real workflowPlugin unmounted; gateway serves workflow-ui seed under registrar `workflow` (G-208).',
  },
] as const;

/** Registrar names documented in the matrix (must match DOMAIN_REGISTRAR_NAMES). */
export const MATRIX_REGISTRAR_NAMES: readonly string[] = MOUNT_MATRIX.filter(
  (row) => row.registrarName !== undefined,
).map((row) => row.registrarName!);

/** Backend package dirs that appear as matrix rows (excluding *-ui gateway ids). */
export const MATRIX_BACKEND_PACKAGES: readonly string[] = MOUNT_MATRIX.map((row) => row.package).filter(
  (pkg) => !pkg.endsWith('-ui'),
);
