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
  'curriculum',
  'developer-portal',
  'examination',
  'fees',
  'gradebook',
  'health',
  'hostel',
  'institution',
  'library',
  'lms',
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
 * G-605 / G-924 — formally PARKED packages (equals EXPECTED_UNMOUNTED: every
 * unmounted package carries a decision + rationale; no "undecided" rows).
 * Decision: packages exist but are not composed onto the gateway until
 * product UI + durable persistence are ready; theme prefix conflicts with
 * platform-admin stub; dashboards needs AreaHierarchyResolver product wiring.
 */
export const EXPECTED_PARKED: readonly string[] = [
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
      'Prisma when DATABASE_URL set, else in-memory. G-701: /enrollments + /students/import mounted (pg enrollment repo on 001/021). G-914: /students/:id/{photo,id-card.pdf,siblings,consents,discipline,attendance-heatmap} on 035 (no new prefix).',
    registrarName: 'student',
  },
  {
    package: 'institution',
    mounted: true,
    prefixes: [
      '/institutions',
      '/academic-periods',
      '/grades',
      '/classes',
      '/subjects',
      '/institution-subjects',
      '/infrastructure',
    ],
    persistence: 'mixed',
    rbacWired: true,
    notes:
      'Prisma when DATABASE_URL set, else in-memory. G-901: academic periods / grades / classes / subjects (Prisma or in-memory look-alike) + infrastructure hierarchy (raw-pg on db/sql/027 with RLS, else tenant-partitioned in-memory) mounted by institutionPlugin.',
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
    notes:
      'Prisma when DATABASE_URL set, else in-memory. G-919: /attendance/regularisation, /leave-requests, /devices, /ingest on 042 (FORCE RLS); EARLY_DEPARTURE present-partial 0.5. Self-contained request/approve (not WorkflowService).',
    registrarName: 'attendance',
  },
  {
    package: 'examination',
    mounted: true,
    prefixes: ['/examinations'],
    persistence: 'prisma+rls',
    rbacWired: false,
    notes:
      'Exams + results + documents + ops (invigilators/seating/double-entry/re-eval); Prisma + raw SQL 036 when DATABASE_URL set.',
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
    notes:
      'Raw pg (003_sis_timetable_schedule_schema.sql + 041_timetable_generation_schema.sql) when DATABASE_URL set. G-917: /timetable/generation-jobs (sync in-process greedy+repair) and /timetable/teacher-absences. Else in-memory.',
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
    package: 'curriculum',
    mounted: true,
    prefixes: ['/curriculum'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes:
      'Raw pg (033_curriculum_schema.sql) when DATABASE_URL set; else in-memory. Syllabus units, lesson plans, outcomes, coverage % (G-923).',
    registrarName: 'curriculum',
  },
  {
    package: 'lms',
    mounted: true,
    prefixes: ['/lms'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes:
      'Raw pg (026_lms_schema.sql) when DATABASE_URL set; else in-memory. Board/school scoped assignments · homework · quizzes · Spiral PAL (G-801/G-802).',
    registrarName: 'lms',
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
      'Counselling + profile/screening PHI + special-needs via raw pg when DATABASE_URL (G-203). Also mounts healthUiPlugin; its list aggregates are folded from domain rows (allergies/conditions, diagnoses/plans, screening programs, sessions) with the demo seed limited to dev/test (G-912).',
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
    prefixes: ['/parent-portal', '/student-portal'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes:
      'Raw pg (010_parent_portal_schema.sql) when DATABASE_URL set. G-904 academic reads + /student-portal/me self-binding. Fee routes delegate to backend-fees (G-903) with parent self-binding.',
    registrarName: 'parent-portal',
  },
  {
    package: 'fees',
    mounted: true,
    prefixes: ['/fees'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes:
      'feesPlugin (G-201/G-903); raw pg 010+011+031 when DATABASE_URL set; else shared in-memory. Structures/concessions/refunds/recon + overdue reminder feed. Sandbox PSP only (G-202 waived).',
    registrarName: 'fees',
  },
  {
    package: 'registration',
    mounted: true,
    prefixes: ['/registrations', '/admissions'],
    persistence: 'raw-pg',
    rbacWired: false,
    notes:
      'Raw pg 014 waitlist/interview + 034 enquiry/merit/seat/offer when DATABASE_URL set; else in-memory (G-205/G-717/G-906). Auto-enrol via student + enrollment services on offer accept.',
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
    persistence: 'raw-pg',
    rbacWired: true,
    notes:
      'auditPlugin + mutating onResponse trail in `app.ts` (G-105). Raw pg 022/028 when DATABASE_URL (G-704): append-only trigger + sha256 hash chain with `/chain/verify`, DSAR export, runtime retention scheduler (G-913). Prefix `/audit-logs` avoids clash with platform-admin GET `/audit` stub.',
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
    registrarName: 'tenant-admin',
    mounted: true,
    prefixes: ['/tenant-lifecycle', '/tenant', '/scim'],
    persistence: 'mixed',
    rbacWired: true,
    notes:
      'tenantLifecyclePlugin at `/tenant-lifecycle` (G-106); platform-admin UI still owns `/tenants`. Suspend gate wired on mutating routes. G-910: `/tenant/{roles,permissions,users,settings}` admin console via tenantAdminPlugin (control_plane_documents on db/sql/022 when DATABASE_URL, RLS; else in-memory), RBAC `tenant` → `user`. G-924: SCIM 2.0 `/scim/v2/{Users,Groups,ServiceProviderConfig,ResourceTypes,Schemas}` over the same directory (RBAC `scim` → `user`).',
  },

  // —— Gateway UI-only registrars (no packages/backend package) ——
  {
    package: 'insights-ui',
    mounted: true,
    prefixes: ['/reports', '/data-warehouse'],
    persistence: 'mixed',
    rbacWired: false,
    notes:
      'insightsUiPlugin with PG store when DATABASE_URL set (020; G-209). G-809: GET /reports/board/:boardId/summary. Real `report` / `data-warehouse` packages still unmounted.',
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
      'G-924: workflowUiPlugin now served by EngineBackedWorkflowUiStore — the same `@proctira/backend-workflow` repositories as `/workflow-engine` (db/sql/025 when DATABASE_URL, else in-memory), so UI steps/approvals are engine definitions/transitions with audit. The former workflow-ui PG store is retained only for the isolated plugin unit test. Registrar name `workflow`.',
    registrarName: 'workflow',
  },

  // —— Unmounted packages/backend/* ——
  {
    package: 'admin-dashboard',
    mounted: false,
    prefixes: ['/admin/scalability'],
    persistence: 'n/a',
    rbacWired: false,
    parked: true,
    parkedReason:
      'G-924 PARKED (superseded) — platform-admin UI + insights own every dashboard surface; package kept only for its aggregation helpers. Retire when no importer remains.',
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
    parked: true,
    parkedReason:
      "G-924 PARKED (superseded) — `/data-warehouse` served by insights UI with PG store (G-209); warehouse package's connector model needs an ETL runtime that is not funded this wave.",
    notes: 'Unmounted; insights UI owns `/data-warehouse` (G-209).',
  },
  {
    package: 'etl',
    mounted: false,
    prefixes: ['/pipelines'],
    persistence: 'n/a',
    rbacWired: false,
    parked: true,
    parkedReason:
      'G-924 PARKED (deferred) — pipeline runtime has no product surface; scheduled report runs (G-909) cover the operational need. Mount with data-warehouse when BI pipelines are funded.',
    notes: 'Unmounted (G-209).',
  },
  {
    package: 'install',
    mounted: false,
    prefixes: ['/install'],
    persistence: 'n/a',
    rbacWired: false,
    parked: true,
    parkedReason:
      'G-924 PARKED (out of scope for gateway) — install wizard is portal/demo scoped and must never be reachable on a live tenant gateway.',
    notes: 'Unmounted; install wizard is portal/demo scoped.',
  },
  {
    package: 'plugin',
    mounted: false,
    prefixes: ['/plugins'],
    persistence: 'n/a',
    rbacWired: false,
    parked: true,
    parkedReason:
      'G-924 PARKED (superseded) — `/plugins` served by platform-admin UI; marketplace runtime deferred.',
    notes: 'Unmounted; `/plugins` served by platform-admin UI stub.',
  },
  {
    package: 'policy',
    mounted: false,
    prefixes: ['/policies'],
    persistence: 'n/a',
    rbacWired: false,
    parked: true,
    parkedReason:
      "G-924 PARKED (superseded) — retention is enforced at runtime by the audit RetentionScheduler (G-913); policy package's generic engine has no other consumer.",
    notes: 'Unmounted (G-106).',
  },
  {
    package: 'report',
    mounted: false,
    prefixes: ['/reports'],
    persistence: 'n/a',
    rbacWired: false,
    parked: true,
    parkedReason:
      'G-924 decision: MOUNT via G-909 (this wave) — real CSV/XLSX/PDF generation + schedules replace insights-ui synthetic downloads; until that lands insights UI owns `/reports`.',
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
