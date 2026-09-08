/**
 * G-003 gateway mount matrix — TypeScript source of truth.
 *
 * Documents which `packages/backend/*` plugins (and gateway UI plugins) are
 * live on the api-gateway. Keep in sync with:
 *   - `DOMAIN_REGISTRAR_NAMES` in `domain-plugins.ts`
 *   - `docs/audits/GATEWAY_MOUNT_MATRIX.md`
 *
 * RBAC: `rbacPlugin` is registered on the gateway (G-101). Mutating routes are
 * gated; see also G-105 audit trail and G-106 suspend gate in `app.ts`.
 */

export type PersistenceKind = 'prisma+rls' | 'raw-pg' | 'mixed' | 'in-memory' | 'ui-seed' | 'n/a';

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
  /**
   * G-605 — formally parked (not productized for gateway composition).
   * Packages exist under packages/backend/* but stay unmounted by decision.
   */
  parked?: boolean;
  /** Human-readable park rationale when `parked: true`. */
  parkedReason?: string;
}

/**
 * Packages under `packages/backend/*` that are mounted live on the gateway
 * (via `DOMAIN_REGISTRARS` or direct `app.ts` registration).
 */
export const EXPECTED_MOUNTED: readonly string[] = [
  'assessment',
  'attendance',
  'audit',
  'auth',
  'billing',
  'communication',
  'developer-portal',
  'examination',
  'fees',
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
  'tenant',
  'timetable',
  'transport',
  'workflow',
] as const;

/**
 * Packages under `packages/backend/*` that export plugins but are NOT mounted
 * on the gateway (routes fall through to proxy or are absent).
 */
export const EXPECTED_UNMOUNTED: readonly string[] = [
  'admin-dashboard',
  'custom-field',
  'dashboards',
  'data-warehouse',
  'etl',
  'install',
  'plugin',
  'policy',
  'report',
  'survey',
  'theme',
] as const;

/**
 * G-605 — formally PARKED packages (subset of EXPECTED_UNMOUNTED).
 * Decision: packages exist but are not composed onto the gateway until
 * product UI + durable persistence are ready; theme prefix conflicts with
 * platform-admin stub; dashboards needs AreaHierarchyResolver product wiring.
 */
export const EXPECTED_PARKED: readonly string[] = [
  'custom-field',
  'dashboards',
  'survey',
  'theme',
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
    prefixes: ['/students', '/enrollments'],
    persistence: 'prisma+rls',
    rbacWired: false,
    notes:
      'Prisma when DATABASE_URL set, else in-memory. G-701: /enrollments + /students/import mounted (pg enrollment repo on 001/021).',
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
      '/report-cards',
    ],
    persistence: 'prisma+rls',
    rbacWired: false,
    notes:
      'Proxy prefix `/assessments`; native routes include `/report-cards` (G-210 in-memory templates/jobs). Durable HTML also via gradebook `/gradebook/report-cards`.',
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
    notes:
      'Raw pg (016_scholarships_schema.sql) when DATABASE_URL set; else in-memory + demo seed (G-204).',
    registrarName: 'scholarship',
  },
  {
    package: 'health',
    mounted: true,
    prefixes: ['/health'],
    persistence: 'mixed',
    rbacWired: false,
    notes:
      'Counselling + profile/screening PHI + special-needs via raw pg when DATABASE_URL (G-203). Also mounts healthUiPlugin.',
    registrarName: 'health',
  },
  {
    package: 'notification',
    mounted: true,
    prefixes: ['/notifications'],
    persistence: 'mixed',
    rbacWired: false,
    notes:
      'Deliveries via HybridNotificationRepository (PG when DATABASE_URL); prefs/devices raw pg when DATABASE_URL (005); providers sandbox/WAIVED (G-207).',
    registrarName: 'notification',
  },
  {
    package: 'transport',
    mounted: true,
    prefixes: ['/transport'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes:
      'Raw pg (006) when DATABASE_URL; GPS + attendance-on-bus sandbox stubs (G-602). Live telematics residual.',
    registrarName: 'transport',
  },
  {
    package: 'communication',
    mounted: true,
    prefixes: ['/communication'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes:
      'Raw pg (007) when DATABASE_URL; sandbox delivery adapter + send audit (G-604). Live Twilio/SES residual.',
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
    notes: 'Raw pg (009) when DATABASE_URL; fines → fees ledger via shared FeesService (G-603).',
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
    package: 'fees',
    mounted: true,
    prefixes: ['/fees'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes:
      'feesPlugin (G-201); raw pg 010+011 when DATABASE_URL set; else shared in-memory. Sandbox PSP only (G-202 waived).',
    registrarName: 'fees',
  },
  {
    package: 'registration',
    mounted: true,
    prefixes: ['/registrations'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes:
      'Raw pg (014_admissions_crm_schema.sql) incl. waitlist/interview CRM when DATABASE_URL set; else in-memory (G-205/G-717).',
    registrarName: 'registration',
  },
  {
    package: 'developer-portal',
    mounted: true,
    prefixes: ['/developer'],
    persistence: 'in-memory',
    rbacWired: true,
    notes:
      'G-607: mounted with in-memory API keys/docs; AuthZ via rbacPlugin; gateway rate-limit applies. Live IdP key mint residual.',
    registrarName: 'developer',
  },

  // —— Mounted outside DOMAIN_REGISTRARS ——
  {
    package: 'auth',
    mounted: true,
    prefixes: ['/auth'],
    persistence: 'in-memory',
    rbacWired: true,
    notes:
      'Registered directly in `app.ts` (not DOMAIN_REGISTRARS). JWT + sessions; `rbacPlugin` registered (G-101).',
  },
  {
    package: 'audit',
    mounted: true,
    prefixes: ['/audit-logs'],
    persistence: 'in-memory',
    rbacWired: true,
    notes:
      'auditPlugin + mutating onResponse trail in `app.ts` (G-105). Prefix `/audit-logs` avoids clash with platform-admin GET `/audit` stub.',
  },
  {
    package: 'billing',
    mounted: true,
    prefixes: ['/billing'],
    persistence: 'in-memory',
    rbacWired: false,
    notes:
      'billingPlugin mounted in `app.ts` (G-106). Suspend gate also checks JWT/in-memory store.',
  },
  {
    package: 'tenant',
    mounted: true,
    prefixes: ['/tenant-lifecycle'],
    persistence: 'in-memory',
    rbacWired: false,
    notes:
      'tenantLifecyclePlugin at `/tenant-lifecycle` (G-106); platform-admin UI still owns `/tenants`. Suspend gate wired on mutating routes.',
  },

  // —— Gateway UI-only registrars (no packages/backend package) ——
  {
    package: 'insights-ui',
    mounted: true,
    prefixes: ['/reports', '/data-warehouse'],
    persistence: 'mixed',
    rbacWired: false,
    notes:
      'insightsUiPlugin with PG store when DATABASE_URL set (020; G-209). Real `report` / `data-warehouse` packages still unmounted.',
    registrarName: 'insights',
  },
  {
    package: 'platform-admin-ui',
    mounted: true,
    prefixes: ['/tenants', '/plugins', '/break-glass', '/plans', '/themes', '/platform', '/audit'],
    persistence: 'ui-seed',
    rbacWired: true,
    notes:
      'platformAdminUiPlugin stub/scaffold APIs; real audit/billing/tenant lifecycle mounted separately in app.ts (G-104/G-105/G-106).',
    registrarName: 'platform-admin',
  },
  {
    package: 'workflow-ui',
    mounted: true,
    prefixes: ['/workflows'],
    persistence: 'mixed',
    rbacWired: false,
    notes:
      'workflowUiPlugin with PG store when DATABASE_URL set (G-208 approvals persist). Real `@proctira/backend-workflow` engine mounted separately under `/workflow-engine` (G-715); registrar name `workflow`.',
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
    package: 'custom-field',
    mounted: false,
    prefixes: ['/custom-fields'],
    persistence: 'n/a',
    rbacWired: false,
    parked: true,
    parkedReason:
      'G-605 PARKED — package exists (in-memory only); no redesign UI/E2E or durable schema. Mount when product path is funded.',
    notes: 'Formally PARKED (G-605).',
  },
  {
    package: 'dashboards',
    mounted: false,
    prefixes: ['/dashboards'],
    persistence: 'n/a',
    rbacWired: false,
    parked: true,
    parkedReason:
      'G-605 PARKED — needs AreaHierarchyResolver product wiring; insights UI covers reporting for now.',
    notes: 'Formally PARKED (G-605).',
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
    parked: true,
    parkedReason:
      'G-605 PARKED — multi-repo plugin ready but no gateway product surface/E2E; park until survey UX ships.',
    notes: 'Formally PARKED (G-605).',
  },
  {
    package: 'theme',
    mounted: false,
    prefixes: ['/themes'],
    persistence: 'n/a',
    rbacWired: false,
    parked: true,
    parkedReason:
      'G-605 PARKED — `/themes` owned by platform-admin UI stub; mounting themePlugin would conflict.',
    notes: 'Formally PARKED (G-605); platform-admin owns `/themes`.',
  },
  {
    package: 'workflow',
    mounted: true,
    prefixes: ['/workflow-engine'],
    persistence: 'raw-pg',
    rbacWired: false,
    registrarName: 'workflow-engine',
    notes:
      'G-715: real workflowPlugin (definitions/instances/transitions+audit/cases) mounted under `/workflow-engine`; Pg on db/sql/025 when DATABASE_URL set, else in-memory. `/workflows` stays with workflow-ui.',
  },
] as const;

/** Registrar names documented in the matrix (must match DOMAIN_REGISTRAR_NAMES). */
export const MATRIX_REGISTRAR_NAMES: readonly string[] = MOUNT_MATRIX.filter(
  (row) => row.registrarName !== undefined,
).map((row) => row.registrarName!);

/** Backend package dirs that appear as matrix rows (excluding *-ui gateway ids). */
export const MATRIX_BACKEND_PACKAGES: readonly string[] = MOUNT_MATRIX.map(
  (row) => row.package,
).filter((pkg) => !pkg.endsWith('-ui'));
