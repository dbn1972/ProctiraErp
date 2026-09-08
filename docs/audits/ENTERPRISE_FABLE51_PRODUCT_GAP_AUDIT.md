# ProctiraERP — Master Enterprise Gap Report (single source of truth)

**Date:** 2026-09-08 · **Auditor:** Fable 5.1 (parallel explores + repo verification) · **Base:** `main` @ `39e899f`  
**Purpose:** The one report Cursor Auto-mode agents work from, **gap by gap, in order**, until ProctiraERP is a world-class enterprise school ERP.  
**Skills that govern every task:** `.cursor/skills/enterprise-module-production-ready/SKILL.md` and the related skills it lists (security-tenancy, data-sql-certification, product-ia, ux-designer, accessibility, mobile-flutter, release-ops, module-development).

---

## 0. How agents must use this report

1. Pick the **lowest-numbered OPEN gap** whose `Depends on` are all `DONE`.
2. Work on a slim branch `cursor/<gap-id-lowercase>-56c3` from `origin/main`. One gap = one PR.
3. Meet the **Acceptance** exactly; attach evidence paths (tests, artifacts, audit md).
4. Update the **Status** column here (`OPEN → IN PROGRESS → DONE (PR #n)`) in the same PR.
5. Never claim a pillar that needs external secrets (IdP, PSP, Twilio, LMS, Statuspage) — mark **WAIVED (dated)**.
6. Do not open mega-PRs. PR #38 (optional Keycloak) is the reference size.

---


## Progress log

| Date | Wave | Closed |
|------|------|--------|
| 2026-09-08 | 0–1 | G-002, G-003, G-101, G-102, G-103, G-104 on PR #40 (`cursor/enterprise-gap-close-56c3`) |
| 2026-09-08 | 2 | G-105 DONE; G-204/205 DONE (pg repos); G-401 scaffolding; G-201 fees still OPEN |
| 2026-09-08 | 4 (partial) | G-401 scaffolding: `.github/workflows/e2e-backend-ready.yml` + `tools/scripts/run-e2e-backend-ready.sh` (migrate/SQL + HS256 health write smoke; seeded-login journeys still residual) |

## 1. Verdict

| Pillar                     |     Score /10 | Headline gap                                                                                                                                                                                                                |
| -------------------------- | ------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security & tenancy         |       **3.5** | RBAC plugin exists but is **never mounted**; actors readable from `x-user-id` headers; raw-SQL tables have **zero RLS**                                                                                                     |
| Data / persistence         |       **4.0** | CI applies **Prisma only**; `db/sql/001–014` never applied in CI → those modules silently run **in-memory** in tests; scholarships, admissions, special-needs, notifications, workflows, insights, platform-admin in-memory |
| Functionality              |       **5.0** | Fees module = SQL file only, no gateway plugin; report cards disabled; HR leave / admissions not persisted                                                                                                                  |
| UX / a11y / multidevice    |       **5.0** | Authenticated axe / dark / touch / RTL specs **skip** when routes/backend not ready; no visual-diff                                                                                                                         |
| Platform / admin / release |       **4.0** | Platform-admin UI plugin (457 lines) has **no role check**; audit/tenant-lifecycle/billing plugins unmounted; Helm chart still named `openemis-platform`                                                                    |
| E2E evidence               |       **4.0** | `E2E_BACKEND_READY` absent from all workflows → write journeys never run in CI                                                                                                                                              |
| **Overall**                | **~5.5 / 10** (Wave 0–1 security spine closed on branch `cursor/enterprise-gap-close-56c3`) | Solid architecture and skills culture; **controls and persistence are not composed into the running gateway**                                                                                                               |

Peer-gap queue #1–#10 (closed) fixed peer deltas. This report covers the **whole product**.

---

## 2. Gap register (work top to bottom)

Legend — **Sev:** S0 blocker · S1 critical · S2 major · S3 minor. **Status:** OPEN unless noted.

### Wave 0 — Foundations (unblock everything)

| ID        | Sev | Gap (what is wrong)                                                                                                                                                                                                                                                                                                                                                  | Evidence                                                      | Fix                                                                                                                                                                      | Acceptance                                                                              | Depends on | Status              |
| --------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------- | ------------------- |
| **G-001** | S0  | Optional Keycloak slim PR not merged; identity/invite/OTP stores in-memory                                                                                                                                                                                                                                                                                           | PR #38 CI 13/13 green, still draft                            | Merge PR #38; follow-up: persist identity/invite/OTP                                                                                                                     | `main` has env-gated Keycloak; docs list env vars                                       | —          | OPEN (PR #38 ready) |
| **G-002** | S0  | **Two schema systems**: Prisma migrations (student/institution/staff/attendance/exam/assessment) vs raw SQL `db/sql/001–014` (health, timetable, gradebook, notifications, transport, comms, hostel, library, parent, fees, HR, admissions). CI runs `prisma:migrate:deploy` only (`ci.yml:502`), so raw-SQL modules fall back to in-memory during integration tests | `domain-plugins.ts` header; `ci.yml` 495–512; `db/sql/`       | Add `tools/scripts/apply-sql.sh` (idempotent, ordered 001→014 + seeds) and call it in CI after Prisma; document canonical order in `db/README.md`                        | Integration job applies both; a test proves `pg` repos are used when `DATABASE_URL` set | —          | **DONE (apply-sql.sh + CI)**                |
| **G-003** | S0  | No **mount matrix**: which package routes are live on the gateway is only visible by reading `domain-plugins.ts`. Fees, billing, audit, policy, tenant-lifecycle, custom-field, survey, dashboards, ETL, report, workflow (real), plugin, theme are **not** mounted                                                                                                  | `domain-plugins.ts` DOMAIN_REGISTRARS vs `packages/backend/*` | Publish `docs/audits/GATEWAY_MOUNT_MATRIX.md` (package → prefix → persistence → RBAC → E2E) and a unit test that fails when a package exports a plugin not in the matrix | Matrix committed; test green                                                            | —          | **CLOSED** (`GATEWAY_MOUNT_MATRIX.md` + `mount-matrix.ts` + `gateway-mount-matrix.test.ts`) |

### Wave 1 — Security spine (S0)

| ID        | Sev | Gap                                                                                                                                                                | Evidence                                                               | Fix                                                                                                                          | Acceptance                                                                                   | Depends on                                    | Status               |
| --------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------- | ---- |
| **G-101** | S0  | `rbacPlugin` (`packages/backend/auth/src/rbac-plugin.ts`) is **not registered** anywhere in `apps/api-gateway` → every domain route relies only on "has valid JWT" | grep `rbacPlugin` in `apps/api-gateway/src` = 0 hits; `app.ts` 239–350 | Register `rbacPlugin` after `tenantPlugin`; define permission map per prefix; default-deny for mutating verbs                | Every `POST/PUT/PATCH/DELETE` under `/api/v1/*` requires a permission; deny tests per module | G-003                                         | **DONE (rbacPlugin mounted)**                 |
| **G-102** | S0  | **Forgeable actor**: parent-portal and HR leave read `request.headers['x-user-id']`; timetable/gradebook/registration read actor-ish headers                       | `parent-portal/src/routes.ts:47`, `staff/src/leave-routes.ts:29`       | Actor = JWT `sub`/claims only; strip client `x-user-id`/`x-actor` at gateway; shared `getActor(request)` helper              | Property test: header override never changes actor; all routes use helper                    | G-101                                         | **DONE (JWT-only getActor)**                 |
| **G-103** | S0  | **Zero RLS** on raw-SQL tables (`db/sql/001–014`): `ENABLE ROW LEVEL SECURITY` count in `db/` = 0; RLS exists only in Prisma migrations                            | grep result                                                            | Add `db/sql/015_rls_policies.sql` (tenant_id policy on every table + `SET app.tenant_id`), wire in pg repos via `withTenant` | Tenant-isolation release gate extended to raw-SQL domains and green                          | G-002                                         | **DONE (015_rls_policies.sql)**                 |
| **G-104** | S0  | Platform-admin UI plugin (`platform-admin-ui-plugin.ts`, 457 lines) serves `/tenants`, `/plans`, `/break-glass`, `/audit`, `/platform` with **no role check**      | grep `requireRole                                                      | roles` = 0                                                                                                                   | Require `platform_admin` role via G-101; break-glass needs dual-control + audit              | Non-admin → 403; audit row per admin mutation | G-101                | **DONE (platform-admin gate)** |
| **G-105** | S1  | Audit package exists but no audit middleware mounted; admin & PHI/money mutations unaudited                                                                        | `packages/backend/audit` not in `domain-plugins.ts`                    | Mount audit plugin; emit on every mutating route (actor, tenant, resource, before/after hash)                                | Audit rows queryable; test per module                                                        | G-101                                         | **DONE (auditPlugin + onResponse)**                 |
| **G-106** | S1  | Tenant lifecycle / policy / billing-entitlement plugins unmounted → no plan limits, no suspend/offboard                                                            | `packages/backend/{tenant,policy,billing}` unmounted                   | Mount tenant lifecycle + entitlement middleware; wire plan checks                                                            | Suspended tenant → 403; entitlement test                                                     | G-101, G-003                                  | OPEN                 |
| **G-107** | S1  | Live IdP login not proven; HS-JWT default                                                                                                                          | PR #38 scope                                                           | After G-001: staging Keycloak realm + recorded login E2E                                                                     | Evidence recording or **WAIVED (dated)**                                                     | G-001                                         | WAIVED until secrets |

### Wave 2 — Persistence, money, PHI (S0/S1)

| ID        | Sev | Gap                                                                                                                           | Evidence                         | Fix                                                                                                             | Acceptance                                                | Depends on          | Status                 |
| --------- | --- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------- | ---------------------- |
| **G-201** | S0  | **Fees/finance has no gateway module**: `011_fees_finance_schema.sql` exists but no `feesPlugin`; only parent-portal reads it | grep `fees` in gateway = 0       | Build `packages/backend/fees` (invoices, ledger, receipts, concessions, dunning) on raw pg + RLS; mount `/fees` | Double-entry invariant tests; RBAC; restart-safe          | G-002, G-101, G-103 | OPEN                   |
| **G-202** | S0  | Payment gateway (PSP) integration absent                                                                                      | —                                | Adapter interface + sandbox stub + webhook idempotency                                                          | Sandbox charge proof or **WAIVED (dated)**                | G-201               | WAIVED until PSP keys  |
| **G-203** | S0  | Health **special-needs in-memory**; PHI read access unaudited; no field-level encryption policy                               | `domain-plugins.ts` 208–223      | Persist special-needs (SQL 012 ext.); PHI access log; encrypt sensitive columns (pgcrypto or app-level)         | No plaintext PHI in logs; audit on read; tenant deny test | G-103, G-105        | OPEN                   |
| **G-204** | S1  | Scholarships **in-memory + demo seed**                                                                                        | `InMemoryScholarshipRepository`  | `db/sql/016_scholarships_schema.sql` + pg repo (programs, applications, disbursements)                          | CRUD survives restart; RLS; E2E `10-scholarships` live    | G-002, G-103        | **CLOSED** (`016` + `PgScholarshipRepository` + factory) |
| **G-205** | S1  | Admissions CRM **in-memory**; SQL 014 unused; OCR waived                                                                      | `InMemoryRegistrationRepository` | pg repo on 014; pipeline stages; document upload stub                                                           | Persisted pipeline; RBAC; E2E                             | G-002, G-103        | **CLOSED** (`PgRegistrationRepository` + factory; OCR waived) |
| **G-206** | S1  | HR leave: persisted only when `DATABASE_URL`; approval actor forgeable; no payroll hooks                                      | `staff/src/leave-routes.ts`      | After G-102: approver from JWT; balances; audit                                                                 | Approve/deny matrix tests                                 | G-102               | OPEN                   |
| **G-207** | S1  | Notifications delivery records in-memory; no provider (email/SMS/push) adapters live                                          | `createNotificationStack`        | Persist deliveries; adapter interface; Twilio/SES stubs                                                         | Restart-safe; provider proof or **WAIVED**                | G-002               | OPEN / provider WAIVED |
| **G-208** | S1  | Workflow engine served by **UI seed plugin**, real `@proctira/backend-workflow` unmounted                                     | `workflowUiPlugin` comment       | Mount real workflow package with adapter matching UI shapes                                                     | Approvals persist; E2E `12-workflows` live                | G-002               | OPEN                   |
| **G-209** | S2  | Insights/platform-admin aggregates in-process, not from warehouse                                                             | `insightsUiPlugin`               | Wire `data-warehouse`/`report` packages; scheduled ETL job                                                      | Reports from DB; job runs in CI smoke                     | G-002               | OPEN                   |
| **G-210** | S2  | Assessment report-card repositories not wired; routes disabled                                                                | `domain-plugins.ts` 159–161      | Prisma or pg repo; enable routes or formally redirect to gradebook                                              | Report card generated E2E                                 | G-002               | OPEN                   |

### Wave 3 — SIS depth & portals (S1)

| ID        | Sev | Gap                                                                                  | Evidence                     | Fix                                                                 | Acceptance                           | Depends on   | Status               |
| --------- | --- | ------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------- | ------------------------------------ | ------------ | -------------------- |
| **G-301** | S1  | Route-permission coupling test covers core SIS only (`09-route-permission-coupling`) | e2e list                     | Extend to timetable, gradebook, health, fees, scholarships, portals | Spec asserts 403 per role per module | G-101        | OPEN                 |
| **G-302** | S1  | UUIDs shown as primary labels in timetable/gradebook/master-schedule UIs             | UX explore                   | Human labels (code + name), search-select components                | No raw UUID visible on list/detail   | —            | OPEN                 |
| **G-303** | S1  | Gradebook publish/lock/moderation workflow & transcript signing incomplete           | DEV_SIS_GRADEBOOK audit      | Publish states, lock after moderation, signed PDF                   | State machine tests; export job      | G-101        | OPEN                 |
| **G-304** | S1  | Master schedule conflict resolution & bulk ops thin                                  | DEV_SIS_MASTER_SCHEDULE      | Conflict engine surfaced in UI; bulk assign                         | Property tests on conflicts          | G-302        | OPEN                 |
| **G-305** | S1  | Board exports: async job, download, retention, tenant check                          | DEV_SIS_BOARD_EXPORTS        | Job queue + signed URL + audit                                      | E2E download; deny cross-tenant      | G-105        | OPEN                 |
| **G-306** | S1  | Parent/student portals: consent, messaging, fees against live API; actor from header | `22-parent-portal-smoke`     | After G-102/G-201: live journeys                                    | Authenticated E2E evidence           | G-102, G-201 | OPEN                 |
| **G-307** | S2  | Bulk import (`05-bulk-import`) validation/rollback semantics                         | e2e                          | Dry-run, row errors, transactional commit                           | Property tests                       | G-002        | OPEN                 |
| **G-308** | S2  | LMS / LTI integration only planned                                                   | `docs/plans/LMS_LTI_EPIC.md` | LTI 1.3 tool launch stub                                            | Launch proof or **WAIVED**           | —            | WAIVED until sandbox |

### Wave 4 — UX, accessibility, mobile, E2E CI (S1/S2)

| ID        | Sev | Gap                                                                                                 | Evidence                                                                             | Fix                                                                                          | Acceptance                                 | Depends on | Status             |
| --------- | --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------- | ------------------ |
| **G-401** | S1  | `E2E_BACKEND_READY` appears in **no** workflow → write-path E2E never runs in CI                    | grep `.github` = 0                                                                   | Add `e2e-backend-ready` job: Postgres + Redis + gateway + web, seeded admin, run write specs | Job in CI (required or nightly with badge) | G-002      | **IN PROGRESS** — workflow `.github/workflows/e2e-backend-ready.yml` + harness `tools/scripts/run-e2e-backend-ready.sh` (nightly/`workflow_dispatch`; migrate+SQL hard-fail; HS256 health write smoke when gateway healthy; seeded `loginAsTenantAdmin` journeys + full axe matrix still residual) |
| **G-402** | S1  | Authenticated axe / dark / touch / RTL specs `test.skip` when routes not enabled or backend missing | `a11y-axe.spec.ts:75,88,106,180`; `dark-mode-parity:118,186`; `touch-target:258,332` | Run in G-401 job with all module routes enabled; fail on critical violations                 | 0 critical axe across module route list    | G-401      | **IN PROGRESS** — `/health` + `/scholarships` (and nested) already on authenticated axe route list; live scan still gated on G-401 `E2E_BACKEND_READY=1` + session |
| **G-403** | S1  | No visual-regression CI (skill notes "No visual-diff CI")                                           | skill map                                                                            | Playwright `toHaveScreenshot` baseline for desktop/tablet/mobile top screens                 | Diff job green; baselines committed        | G-401      | OPEN               |
| **G-404** | S2  | MobileShell routes to missing/empty destinations                                                    | UX explore                                                                           | Route audit; hide/404-guard; capture PNGs                                                    | All shell links resolve                    | —          | OPEN               |
| **G-405** | S2  | i18n parity: hardcoded strings in redesign modules; RTL only spec-level                             | `apps/web/src/i18n`                                                                  | Extraction lint rule; fill locales for top modules                                           | Lint gate; RTL spec passes for modules     | —          | OPEN               |
| **G-406** | S2  | Flat IA for large modules; no command-palette deep links for campus modules                         | product-ia skill                                                                     | Nav grouping per IA skill; breadcrumbs; palette entries                                      | UX review checklist filled                 | —          | OPEN               |
| **G-407** | S2  | Flutter app: a11y semantics, offline, and device-farm evidence thin                                 | mobile explore                                                                       | Semantics pass; golden tests; farm run                                                       | Checklist + PNGs or **WAIVED** farm        | —          | OPEN / farm WAIVED |
| **G-408** | S2  | Multi-board 3×2×500 live certification not a standing proof                                         | skill §Live DB                                                                       | Add to G-401 job or nightly                                                                  | `verify-counts.txt` artifact refreshed     | G-002      | OPEN               |

### Wave 5 — Platform, release, operations (S1/S2)

| ID        | Sev | Gap                                                                                                                | Evidence                     | Fix                                                                             | Acceptance                                    | Depends on | Status |
| --------- | --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- | ---------- | ------ |
| **G-501** | S1  | Helm chart is `infrastructure/helm/openemis-platform`; deploy.yml assumes per-service charts `proctira-${SERVICE}` | `deploy.yml:270`; Chart.yaml | Rename/restructure charts per app; values per env; secrets via external-secrets | `helm template` in CI; staging deploy dry-run | —          | OPEN   |
| **G-502** | S1  | Observability: Prometheus/Grafana/alerts in `infra/observability` but no SLOs per module, no runbooks link         | dir listing                  | SLO doc + alert rules per critical journey; runbooks                            | Alerts fire in compose test                   | —          | OPEN   |
| **G-503** | S1  | Backup/restore, DR, data-retention (PHI/minor data) policies absent                                                | —                            | Documented + scripted pg backup/restore; retention jobs                         | Restore drill evidence                        | G-002      | OPEN   |
| **G-504** | S2  | Secrets management: env files; no rotation story for JWT secret / DB creds                                         | `config.ts`                  | Document rotation; support dual JWT keys (kid)                                  | Rotation test                                 | G-001      | OPEN   |
| **G-505** | S2  | Rate-limit & idempotency exist, but no per-tenant quotas / abuse detection                                         | `plugins/rate-limit.ts`      | Tenant-scoped limits from plan (G-106)                                          | Test 429 per tenant                           | G-106      | OPEN   |
| **G-506** | S2  | Statuspage / incident comms / pager absent                                                                         | —                            | Integration stub                                                                | **WAIVED (dated)**                            | —          | WAIVED |
| **G-507** | S2  | Install wizard / onboarding of new tenant end-to-end not certified                                                 | `apps/install-wizard`        | E2E: create tenant → admin → school → first student                             | Recording                                     | G-106      | OPEN   |
| **G-508** | S3  | Supply-chain: no SBOM / dependency audit gate / image signing                                                      | workflows                    | `pnpm audit` gate, SBOM, cosign                                                 | CI job green                                  | —          | OPEN   |

### Wave 6 — Long-tail campus modules (after G-101/G-103)

| ID        | Sev | Module                                                | Required to close                                      | Depends on   | Status |
| --------- | --- | ----------------------------------------------------- | ------------------------------------------------------ | ------------ | ------ |
| **G-601** | S2  | Hostel                                                | RBAC + RLS + live E2E write + audit md                 | G-101, G-103 | OPEN   |
| **G-602** | S2  | Transport                                             | same + GPS/attendance-on-bus stub                      | G-101, G-103 | OPEN   |
| **G-603** | S2  | Library                                               | same + fines → fees ledger                             | G-201        | OPEN   |
| **G-604** | S2  | Communication / emergency                             | RBAC (no send without role) + provider adapter + audit | G-101, G-207 | OPEN   |
| **G-605** | S2  | Surveys / custom fields / dashboards / theme packages | Mount, RBAC, E2E or formally park                      | G-003        | OPEN   |
| **G-606** | S2  | Public website + registration portal                  | Enterprise packs (SEO, forms, a11y, spam)              | G-205        | OPEN   |
| **G-607** | S2  | Developer portal / plugin marketplace                 | AuthZ, API keys, rate limits, docs                     | G-101, G-505 | OPEN   |

---

## 3. External waivers (dated 2026-09-08; re-check each release)

| Waiver              | Blocked gap | Needed from owner              |
| ------------------- | ----------- | ------------------------------ |
| Live Keycloak realm | G-107       | Staging realm + client secrets |
| Payment PSP sandbox | G-202       | Sandbox keys                   |
| Twilio / SES        | G-207       | Account + sender               |
| LMS/LTI sandbox     | G-308       | Platform registration          |
| Device farm         | G-407       | Farm account                   |
| Statuspage / pager  | G-506       | Accounts                       |

Agents implement adapters + mocks and keep the waiver row until evidence exists.

---

## 4. Execution order for Auto-mode agents

```
Serial:   G-001 → G-002 → G-003
Parallel: G-101 | G-103 | G-501 | G-404 | G-405 | G-302
Then:     G-102, G-104, G-105, G-106            (need G-101)
Then:     G-201, G-203, G-204, G-205, G-206, G-207, G-208   (need G-002/G-103)
Then:     G-401 → G-402 → G-403 ; G-408 ; G-301 ; G-303–G-307
Then:     G-502–G-508 ; G-601–G-607
```

Parallel only on **non-overlapping paths**. Suggested branch names: `cursor/g-101-rbac-mount-56c3`, `cursor/g-002-sql-apply-56c3`, etc.

---

## 5. Agent prompt (copy per gap)

```text
You are a Cursor Auto-mode subagent for ProctiraERP.
Gap: <G-xxx> from docs/audits/ENTERPRISE_FABLE51_PRODUCT_GAP_AUDIT.md
Obey: .cursor/skills/enterprise-module-production-ready/SKILL.md and the skill
named for this gap's pillar. Branch cursor/<g-xxx-short>-56c3 from origin/main.
Implement ONLY this gap. Meet the Acceptance column exactly. Add/extend tests.
Run lint + typecheck + affected unit tests. Commit, push, open draft PR.
Update the Status column of this gap in the same PR (DONE (PR #n)).
Never claim waived pillars (IdP/PSP/Twilio/LMS/Statuspage/farm) as complete.
```

---

## 6. Definition of "world-class enterprise ERP" (exit bar)

All true, waivers only where dated in §3:

1. **Security:** RBAC mounted and default-deny; JWT-only actors; RLS on every tenant table (Prisma + raw SQL); platform-admin authZ; audit on all mutations; entitlements enforced.
2. **Data:** Single documented schema-apply path used by CI, local, and certification; **no critical domain in-memory**; backup/restore drill.
3. **Function:** Fees, admissions, scholarships, HR leave, workflows, notifications persisted and mounted; report cards, transcripts, board exports E2E.
4. **UX/a11y:** Authenticated axe/dark/touch/RTL and visual-diff run in CI for all shipped modules; no UUID labels; i18n gate; mobile shell valid.
5. **E2E:** `E2E_BACKEND_READY` job green on every PR (or nightly with badge); multi-board 3×2×500 certification standing.
6. **Release/ops:** Helm per app, staging deploy dry-run in CI, SLOs + alerts + runbooks, secret rotation, SBOM.
7. **Mobile:** Flutter semantics pass; device evidence or dated waiver.

Scoreboards may claim **program production-ready** only when every non-waived gap above is `DONE`.

---

## 7. Sources

- Repo verification (2026-09-08): `apps/api-gateway/src/{app,domain-plugins,platform-admin-ui-plugin}.ts`, `.github/workflows/{ci,deploy}.yml`, `db/sql/`, `packages/backend/*`, `apps/web/e2e/*`, `infrastructure/helm/`.
- Fable 5.1 explores: SIS/Academics, Campus ops, Platform, UX/a11y.
- `docs/plans/PEER_GAP_CLOSURE_QUEUE.md` (#1–#10 closed), `SIS_WORLD_CLASS_10_GAP_CLOSURE.md`, `ENTERPRISE_SKILLS_MAP.md`, prior `docs/audits/*`.

_Update the Status column as gaps close. This file supersedes earlier ad-hoc gap lists._
