# Per-module deep evaluation prompt — ProctiraERP

Run this once per module. It produces one report per module so results are
comparable and the sweep is resumable. Do not batch modules into a single pass:
the failure mode this prevents is a shallow uniform verdict across 40 modules.

Existing assets this prompt orchestrates rather than replaces:

- Method and gap matrix: `.kiro/skills/enterprise-school-sis-erp/references/gap-analysis.md`
- Architecture map: `.kiro/skills/enterprise-school-sis-erp/references/architecture.md`
- Dimension checklists: `docs/audits/templates/ENTERPRISE_*.md`
- Honesty and disposition rules: `.cursor/skills/enterprise-module-production-ready/SKILL.md`

---

## The prompt

> Evaluate exactly one module of ProctiraERP: **`<MODULE>`**.
>
> Audit the current tip commit. Record the commit SHA in your report and treat it
> as the only thing you are describing. If you cannot verify something, say so;
> an honest `unverified` is worth more than a confident guess.
>
> ### Step 1 — Establish the module's real surface
>
> Do not trust any document. Derive the surface from code:
>
> ```bash
> M=<MODULE>
> git rev-parse HEAD
> ls packages/backend/$M/src 2>/dev/null || echo "NO SOURCE — module is a stub"
> # Is it actually served?
> grep -n -A12 "package: '$M'" apps/api-gateway/src/mount-matrix.ts
> grep -n "$M" apps/api-gateway/src/domain-plugins.ts | head
> # Which persistence is selected at runtime, not which files exist?
> ls packages/backend/$M/src | grep -E '^create-|^pg-|^prisma-|in-memory|hybrid'
> grep -rn "new Pg|PrismaClient|InMemory" packages/backend/$M/src/create-*.ts
> # Backing migrations and RLS
> ls db/sql | grep -iE "$M"
> grep -rln "$M" db/sql | head
> # Tests, split by kind
> find packages/backend/$M/src -name '*.test.ts' | grep -v '\.live\.' | wc -l
> find packages/backend/$M/src -name '*.live.test.ts'
> # Client surfaces
> grep -rln "$M" apps/web/src/app apps/web/e2e apps/mobile/lib 2>/dev/null | head
> ```
>
> The `mount-matrix.ts` `persistence` field is known to go stale. Verify it
> against the runtime factory and report any contradiction as a finding.
>
> ### Step 2 — Trace the vertical chain
>
> Follow `.kiro/.../gap-analysis.md` §2 for every capability in the module:
>
> `actor → active UI → API contract → authz/scope → domain service → repository
→ production persistence/RLS → events/jobs/providers → audit/telemetry → tests
→ deployment/runbook`
>
> A placeholder or missing link makes the capability `partial`, even when every
> other layer is complete. Name the broken link explicitly.
>
> ### Step 3 — Score the five dimensions
>
> Assess each against the named checklist. Cite file and line for every claim.
>
> | #   | Dimension         | Checklist                                                                     | Must answer                                                                                                                                                                                                                                                                                                                                                               |
> | --- | ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | 1   | **UX design**     | `ENTERPRISE_UX_DESIGN_REVIEW.md` + `ENTERPRISE_ACCESSIBILITY_CHECKLIST.md`    | Which routes exist for this module in `apps/web/src/app`? Are empty, loading, error and permission-denied states handled? Keyboard reachable? Does it work at 320px? Is copy i18n-resolved or hardcoded? For mobile, is there a real Flutter screen or only a web view?                                                                                                   |
> | 2   | **Functionality** | `ENTERPRISE_MODULE_DEV_CHECKLIST.md` + `ENTERPRISE_PRODUCT_IA_CHECKLIST.md`   | Which actor can complete which lifecycle end to end today, without a developer intervening? Which lifecycle states are unreachable from the UI? What happens on the exception paths: cancel, amend, reverse, refund, withdraw, late, absent, resit?                                                                                                                       |
> | 3   | **Integrity**     | `ENTERPRISE_DATA_SQL_CHECKLIST.md`                                            | What is the authoritative row and how is history preserved? Which invariants can break under retry or concurrency? Are money and count columns integer-typed? Is every write that spans tables in one transaction? Are cross-domain FKs present and `convalidated`? Is audit written in the same transaction as the fact it records?                                      |
> | 4   | **Security**      | `ENTERPRISE_SECURITY_TENANCY_CHECKLIST.md`                                    | Is every table tenant-scoped with `FORCE ROW LEVEL SECURITY` and a leading `tenant_id` index? Prove cross-tenant denial with a live test, not a unit mock. Is authorization per-route and per-resource, or only per-role? For child, health, custody, disciplinary or financial rows, who is denied and how is access logged? Does any read path perform a durable write? |
> | 5   | **Production**    | `ENTERPRISE_RELEASE_OPS_CHECKLIST.md` + `ENTERPRISE_MODULE_TEST_CHECKLIST.md` | Does it run with `NODE_ENV=production` and `DATABASE_URL` set, or does `assertInMemoryFallbackAllowed` throw? Are external providers real or sandbox? Are blobs in S3 or local disk? What are the SLOs, alerts and runbook? What breaks on a single-replica restart, and on a multi-replica rollout?                                                                      |
>
> ### Step 4 — Classify honestly
>
> Per capability assign exactly one evidence status from `gap-analysis.md` §4:
> `implemented` · `partial` · `absent` · `unverified`.
>
> Per remediation assign a disposition from the mandatory vocabulary:
> `FULLY_CLOSED` · `PARTIAL` · `OPEN` · `REGRESSED` · `EXTERNALLY_UNVERIFIED`.
>
> When unsure, do not close. Record `Contradiction: yes` with both sources cited
> whenever code and documentation disagree, and prefer the code.
>
> ### Step 5 — Emit the gap matrix
>
> Use the 13 columns from `gap-analysis.md` §5 verbatim: Capability, Current
> evidence, Evidence status, Contradiction, Maturity, Expected enterprise state,
> Gap, Impact, Recommendation, Dependencies, Priority, Effort, Confidence.
>
> One row per capability, not one row per module. Priority per gap, never a
> single blended module grade.
>
> ### Step 6 — State the acceptance criteria
>
> Close with the smallest set of observable conditions that would move each P0
> and P1 gap to `FULLY_CLOSED`. Each must be executable: a command, a test name,
> or a measurable runtime behaviour. "Improve coverage" is not acceptance.
>
> ### Output
>
> Write to `docs/audits/modules/<MODULE>_DEEP_EVAL_<YYYY-MM-DD>.md` with a header
> recording the audited SHA, the commands you ran, and what you could not verify
> and why.

---

## Claims that are not permitted

Derived from failures actually observed in this repository:

| Do not conclude                                  | Because                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| "Production ready" from passing tests            | Tests can pass against in-memory stores and sandbox adapters                                        |
| "Secure" from unit tests                         | Cross-tenant denial needs a live database with the non-superuser app role and FORCE RLS             |
| "Complete" from `*_COMPLETE.md` or a merged PR   | 247 audit docs exist; several describe superseded states                                            |
| Persistence kind from `mount-matrix.ts` alone    | It currently mislabels `developer-portal`, `billing` and `auth`                                     |
| "UX reviewed" without opening the screens        | Route files existing is not a reviewed experience                                                   |
| "Mobile ready" from web screenshots              | `apps/mobile` has 28 Flutter screens; confirm the module has one                                    |
| A module exists because a package directory does | `alumni`, `canteen`, `finance`, `inventory`, `payroll` contain only `node_modules`                  |
| Payments or messaging work                       | `payment-adapter.ts` is a sandbox stub; SMS/email/push live adapters are explicitly not implemented |
| A skipped CI job counts as passing               | Path filters skip jobs; run the equivalent locally or mark `unverified`                             |

## Sweep order

Evaluate in dependency order so foundation defects surface before breadth.

1. `auth`, `tenant`, `audit`, `privacy` — trust and governance
2. `student`, `institution`, `staff` — core records
3. `attendance`, `assessment`, `examination`, `gradebook`, `timetable`, `curriculum`
4. `fees`, `billing`, `scholarship`, `finance` — money
5. `health`, `parent-portal`, `communication`, `notification` — sensitive and outbound
6. `library`, `hostel`, `transport`, `lms`, `survey`, `inventory`, `canteen`, `alumni`
7. `report`, `data-warehouse`, `etl`, `dashboards`, `admin-dashboard`
8. `developer-portal`, `plugin`, `providers`, `theme`, `custom-field`, `policy`, `workflow`, `install`, `payroll`

## Per-module time expectation

A genuine pass on one module is hours, not minutes, and requires standing up a
migrated PostgreSQL with strict FKs to test anything in dimensions 3, 4 or 5.
Bootstrap sequence is in `.kiro/steering/sis-reliability-delivery-context.md`.
A module evaluated without a live database can only report `unverified` for
integrity, security and production.
