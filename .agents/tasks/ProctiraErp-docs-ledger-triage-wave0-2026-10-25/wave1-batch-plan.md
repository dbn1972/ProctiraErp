# Wave 1 batch plan

The plan has three batches. Each batch gets one branch, one worktree and one PR against `main`. The base for all three is `4c7fb8fe`. Only rows that are still OPEN/PARTIAL after Wave 0 and are `ELIGIBLE_LOW` or `ELIGIBLE_MEDIUM` after the consolidation gate were selected (`work/gate-decisions.json`). The plan data is in `work/wave1-batches.json`. The generator and proof script is `work/wave1_plan.py`.

The branch names match the three Wave 1 branches the orchestrator had already created from the baseline:

- `fix/app-web-batch1`: no commits yet.
- `fix/ui-packages-batch1`: has commits `3457113e` (PRC-L447) and `260ee433` (PRC-L448).
- `fix/platform-services-batch1`: its `plan.md` has the same 10 ids as Batch C.

| Batch | Branch | Findings | Severity mix | Expected files |
|---|---|---|---|---|
| A | `fix/app-web-batch1` | 12 | 4 medium, 8 low | 27 |
| B | `fix/ui-packages-batch1` | 2 | 2 low | 7 |
| C | `fix/platform-services-batch1` | 10 | 1 medium, 9 low | 36 |

Batch B is well below the ~10 target, and this is driven by the evidence. Every non-closed `packages/ui/*` row (L195, L200, L201, L393, L520, L594, L596, L597, M455, M637) and the other custom-field rows (L446, L449, L450) are NEEDS_DECISION or BLOCKED_FOR_APPROVAL. Only PRC-L447 and PRC-L448 are eligible. The batch was not padded with rows from unrelated modules, because that would break the `fix/<module>-batchN` grouping rule.

## Batch A — `fix/app-web-batch1` (apps/web, split by route area)

| PRC id | Sev | Area | After W0 | One-line fix |
|---|---|---|---|---|
| PRC-L228 | low | staff / students list pages | PARTIAL | Add component tests for `app/(dashboard)/staff/page.tsx` and `students/page.tsx`. This is the only residual: gradebook, EntitySearchSelect, import and health tests already pass. |
| PRC-L240 | low | fees forms | PARTIAL | Add field-level errors and `aria-invalid`/`aria-describedby` to `new-fee-plan-form.tsx` and `new-invoice-form.tsx`. |
| PRC-L253 | low | service worker | PARTIAL | Generate or share the SW route classifier instead of hand-duplicating it. Add a Playwright project that runs with service workers enabled (`playwright.config.ts:59` blocks them in every run today). |
| PRC-L255 | low | institutions / infrastructure | OPEN | Prefill the edit-facility form, follow the selected facility, and refresh after room/facility saves. **Salvage source:** `fix/web-lows-L255` commit `05591952a` (4 files, not on main). Re-apply it against tip. |
| PRC-L270 | low | scholarships / documents | PARTIAL | Make Preview open inline instead of calling the same `download()` (`application-documents-panel.tsx:150-160`). Add a confirmation to Remove (`document-upload-slots.tsx:158-166`). The i18n part follows DECISION_REGISTER §4 and is not in this batch. |
| PRC-L413 | low | dev scripts | PARTIAL | Read the HMAC dev secret from env only, with no hard-coded default (`scripts/capture-institutions-timetable.mjs:49`). Stop the mock gateway from answering 200 to every write. |
| PRC-L435 | low | scholarships / disbursements | PARTIAL | Format the paid date in the tenant timezone using the existing `resolveTenantTimezone` (`page.tsx:74-82`). Add a payment-reference column. |
| PRC-L530 | low | gradebook / transcript | OPEN | Delete the unreferenced `issue-transcript-form.tsx`, which takes a pasted ID and has no confirmation (D6 allows removing unreachable code). The live IssueTranscriptByName path is not touched. |
| PRC-M134 | medium | lib/api gateway proxy | PARTIAL | Stream request and response bodies through a byte counter instead of `arrayBuffer()` (`gateway-proxy.ts:81,105`), keeping the existing cap. |
| PRC-M144 | medium | lib/api admin | PARTIAL | Delete the dead PATCH client `updateTenantGeneralSettings` (`lib/api/admin.ts:578-587`, zero callers). |
| PRC-M147 | medium | lib/api dashboards | PARTIAL | Remove the unreachable fabricated enrollment score and browser-local `formatClock` from `lib/api/dashboards.ts` (:668, :756-770). |
| PRC-M489 | medium | lib/api tests | PARTIAL | Add unit suites for `lib/api/examinations.ts`, `admin.server.ts` and `health.ts`. Gateway auth-fallback is already covered. |

Expected files:

- `apps/web/e2e/service-worker.spec.ts`
- `apps/web/playwright.config.ts`
- `apps/web/scripts/capture-institutions-timetable.mjs`
- `apps/web/scripts/mock-gateway.mjs`
- `apps/web/src/app/(dashboard)/fees/_components/{new-fee-plan-form.tsx,new-fee-plan-form.test.tsx,new-invoice-form.tsx}`
- `apps/web/src/app/(dashboard)/institutions/[id]/infrastructure/{actions.ts,page.tsx}`
- `apps/web/src/app/(dashboard)/scholarships/disbursements/{page.tsx,page.test.tsx}`
- `apps/web/src/app/(dashboard)/staff/page.test.tsx`
- `apps/web/src/app/(dashboard)/students/page.test.tsx`
- `apps/web/src/components/gradebook/issue-transcript-form.tsx`
- `apps/web/src/components/institutions/{facility-editor.tsx,facility-editor.test.tsx}`
- `apps/web/src/features/scholarships/components/{application-documents-panel.tsx,application-documents-panel.test.tsx,document-upload-slots.tsx}`
- `apps/web/src/lib/api/{admin.ts,admin.server.test.ts,dashboards.ts,examinations.test.ts,gateway-proxy.ts,gateway-proxy.test.ts,health.test.ts}`
- `docs/audits/remediation/app_web_batch1_DISPOSITIONS_2026-10-25.csv`

Notes:

- PRC-L253 is also cited on salvage branch `fix/partials-b1-web-hardening`. That branch's protected boundaries (auth, authz, finance, privacy, statutory, tenant) are too wide to cherry-pick from, so implement L253 fresh.
- Failing-first proof is required for M134, because it is a data-integrity/availability change. The other rows need passing regression tests.

## Batch B — `fix/ui-packages-batch1` (custom-field; ui-* rows ineligible)

| PRC id | Sev | Module | After W0 | One-line fix |
|---|---|---|---|---|
| PRC-L447 | low | custom-field | OPEN | Validate the definitions list query: coerce `isActive` to a boolean and reject `page`/`pageSize` outside 1..100 with the standard 400 envelope. |
| PRC-L448 | low | custom-field | OPEN | Reject impossible calendar dates. Re-check the dropdown-must-have-options rule on update. Replace-vs-merge of `validationRules` is an owner API decision and stays a residual. |

Expected files:

- `packages/backend/custom-field/src/{routes.ts,routes.test.ts}`
- `packages/backend/custom-field/src/{custom-field-validator.ts,custom-field-validator.test.ts}`
- `packages/backend/custom-field/src/{custom-field-service.ts,custom-field-service.test.ts}`
- `docs/audits/remediation/ui_packages_batch1_DISPOSITIONS_2026-10-25.csv`

PRC-L513 (ui-data-grid) was closed STALE in Wave 0, so the batch does not need to re-verify it.

## Batch C — `fix/platform-services-batch1` (etl, data-warehouse, notification, survey)

| PRC id | Sev | Module | After W0 | One-line fix |
|---|---|---|---|---|
| PRC-L099 | low | etl | OPEN | Apply `PipelineListQuerySchema` with coercion to both list handlers: boolean `enabled`, and `page`/`pageSize` capped at 1..100. |
| PRC-L100 | low | etl | OPEN | Validate `:pipelineId` and return 404 when the execution belongs to a different pipeline. |
| PRC-L302 | low | etl | OPEN | Emit one audit event per successful pipeline create, update, delete and execute through an injectable sink. Durable gateway sink injection is a residual (expect PARTIAL). |
| PRC-L101 | low | etl | PARTIAL | Add authz and cross-tenant repository tests (connector SSRF/LFI tests already exist). |
| PRC-L333 | low | notification | OPEN | Derive delivery capabilities from env instead of a hard-coded sandbox, and fix the retry off-by-one against the configured maximum. |
| PRC-M593 | medium | data-warehouse | OPEN | Fail closed when time-period labels are unknown, so an empty filter no longer returns everything. |
| PRC-L453 | low | data-warehouse | OPEN | Guard or cascade `deleteWarehouse` across indicators, records, GIS layers and translations. |
| PRC-L554 | low | data-warehouse | OPEN | Validate translation language codes and field names, include empty strings in the unique key, and link translation deletes to entity deletes. |
| PRC-L164 | low | survey | OPEN | Enforce `validation.pattern` through a safe-regex guard, validate table/repeater cells, and honour `minLength: 0`. |
| PRC-L165 | low | survey | OPEN | Make submit plus distribution update, and reminder publish plus count, atomic at the repository level. |

Expected files:

- `packages/backend/etl/src/{routes.ts,routes.test.ts,schemas.ts,etl-service.ts,etl-service.test.ts,etl-plugin.ts,etl-audit.ts,etl-audit.test.ts,execution-logger.ts,index.ts,pg-pipeline-repository.test.ts,connectors/safe-fetch.test.ts}`
- `packages/backend/notification/src/{notification-service.ts,notification-service.test.ts,routes.test.ts,channel-sender-factory.ts,sandbox-sms-sender.test.ts}`
- `packages/backend/data-warehouse/src/{data-warehouse-service.ts,data-warehouse-service.test.ts,publishing-service.ts,publish-export-caps.test.ts,in-memory-repository.ts,warehouse-repository.ts,gis-repository.ts,in-memory-gis-repository.ts,translation-repository.ts,in-memory-translation-repository.ts,translation-service.ts,translation-schemas.ts,gis-publishing-translation.test.ts}`
- `packages/backend/survey/src/{survey-service.ts,survey-service.test.ts,survey-repository.ts,in-memory-repository.ts,safe-regex-guard.ts}`
- `docs/audits/remediation/platform_services_batch1_DISPOSITIONS_2026-10-25.csv`

Failing-first proof is required for L302 (audit trail) and M593 (data integrity: unfiltered disclosure). data-warehouse and survey are unmounted, so their dispositions must say the fixes are code-level only.

## Disjointness proof

Command: `python3 .agents/tasks/ProctiraErp-docs-ledger-triage-wave0-2026-10-25/work/wave1_plan.py` (exit 0). Log: `logs/consolidation/wave1-disjointness.log`.

```text
Wave 1 expected-file disjointness proof
  fix/app-web-batch1: 12 findings, 27 files
  fix/ui-packages-batch1: 2 findings, 7 files
  fix/platform-services-batch1: 10 findings, 36 files
  fix/app-web-batch1 ∩ fix/ui-packages-batch1 = ∅ (empty)
  fix/app-web-batch1 ∩ fix/platform-services-batch1 = ∅ (empty)
  fix/ui-packages-batch1 ∩ fix/platform-services-batch1 = ∅ (empty)
  duplicate ids across batches: none
  eligibility/exclusion problems: none
```

The script also checks that every selected id is OPEN/PARTIAL with `ELIGIBLE_LOW`/`ELIGIBLE_MEDIUM` after the gate, has at least one expected file, and is not in an excluded module or eligibility class.

## Exclusions applied

- **Modules:** institution (PR #654), rbac/roles (PR #633), parent-portal (`fix/audit-parent-portal-batch`), and db/infrastructure/github (specialist batches). This also removes PRC-L083 (assessment), whose residual is in the claimed `parent-portal/src/pg-academic-visibility-store.ts`.
- **Eligibility classes:** BLOCKED_FOR_APPROVAL (155), NEEDS_DECISION (72), SCHEMA_BATCH (58), INFRA_BATCH (41) and CLAIMED (44). The rows are listed in `deferred-approval-items.md` and `defect-registry.md`.
- **Eligible but not selected:**
  - PRC-L244 (app-web): adds a user-visible "save without releasing" grading control and a new i18n key. It is overflow for `fix/app-web-batch2`.
  - PRC-L262 (app-web): DPDP-specific Privacy/Terms text is legal content and needs DPO/legal-owner copy first. The orchestrator's `lanes.json` `wave1` list includes L262. This plan leaves it out until the copy exists.
  - PRC-L407 (app-web): the residual "duplicate-resolution radios" could not be located, so there are no expected files.
  - PRC-M254 (flutter-core): needs `dart test`, and there is no Dart toolchain on the host.
  - PRC-M155 (app-web) is not eligible: it is NEEDS_DECISION because it overlaps PRC-M290 in PR #654.
- **Orchestrator Wave 2 lanes** (`.agents/tasks/wave2-plan-2026-10-25/lanes.json`, lanes D/E/F): rows in these lanes (developer-portal, registration, theme, report, workflow, plugin, tooling, academics) were not pulled forward, to avoid double assignment.
- **Salvage candidates** (`orphan-branches.json`): only `fix/web-lows-L255` → PRC-L255 has both an eligible id and files that fit without overlap.
  - PRC-L257, L259 and L260 on the same branch are not ELIGIBLE (L259 is FULLY_CLOSED in the ledger, and the mapper reports tip code contradicting that; see `orphan-branches.md`).
  - Salvage ids on the other branches are high-severity, already closed, or behind protected boundaries.
  - `fix/partials-close-back2` cites PRC-M382 and PRC-L389. Wave 0 closed both as STALE because the fix is already on main.
- **Eligible rows not in any batch or lane:** hostel L116/L317/M278, library M294, curriculum L288, student L366/L589/L590/M547/M635, gradebook L561/M515 and scholarship M632. They were triaged after the Wave 2 lanes were written. Candidate for a school-ops batch in a later wave.
