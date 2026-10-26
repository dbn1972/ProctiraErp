## Summary

This PR closes Wave 0 of the audit-gap programme: it triages the ledger and changes nothing else. All 497 non-closed findings in `docs/audits/remediation/CANONICAL_LEDGER.csv` were triaged against tip `4c7fb8fe`. 44 of them are claimed by in-flight work and were excluded. Four parallel triage groups produced the proposals. A consolidation evidence gate checked them, and the accepted ones were applied to the CSV in one row-scoped scripted pass.

- 163 rows changed:
  - 11 STALE → FULLY_CLOSED
  - 4 DUPLICATE
  - 45 OPEN → PARTIAL
  - 103 PARTIAL rows got refreshed notes
- In each changed row only `disposition`, `latest_wave` (`wave0-triage-2026-10-25`) and `notes` changed. Every other line is byte-identical to the baseline (`work/csv-diff-check.json`, `all_pass: true`).
- Reports in `.agents/tasks/ProctiraErp-docs-ledger-triage-wave0-2026-10-25/`:
  - `baseline-assessment.md`
  - `defect-registry.md` (all 497 rows)
  - `deferred-approval-items.md`
  - `orphan-branches.md`
  - `wave1-batch-plan.md`
  - `evidence-manifest.json`
  - `work/*.json` (raw evidence)
- No application code, schema, infra, dependency, auth or test changes.

The source xlsx (`docs/audits/gap-analysis/Proctira_Code_Audit_Gaps.xlsx`) is not in the repo, its history or on the host. The orchestrator approved triaging on ledger data only: title, notes and evidence plus tip code. Fix steps, Acceptance and Needs were therefore unavailable, and the STALE bar was raised to "tip code resolves the title/notes exactly as stated, plus a passing test that was actually run".

Scope and non-goals: ledger triage and reporting only. No findings are fixed here. Wave 1 fixes run on their own batch branches (see `wave1-batch-plan.md`). `docs/audits/remediation/README.md` asks closers to put proof in the `evidence` column. This brief restricted edits to disposition, latest_wave and notes, so proof is recorded in `notes` using the established `Found already implemented at tip … disposition ALREADY_FIXED (STALE finding)` convention. The README status table (180/207/371) is stale and was not updated.

## Counts before → after (758 rows)

| Disposition  | Before | After | Δ   |
| ------------ | ------ | ----- | --- |
| OPEN         | 291    | 241   | −50 |
| PARTIAL      | 206    | 241   | +35 |
| FULLY_CLOSED | 260    | 271   | +11 |
| DUPLICATE    | 1      | 5     | +4  |

Transitions:

| Transition                     | Rows |
| ------------------------------ | ---- |
| OPEN → FULLY_CLOSED            | 5    |
| PARTIAL → FULLY_CLOSED         | 6    |
| PARTIAL → DUPLICATE            | 4    |
| OPEN → PARTIAL                 | 45   |
| PARTIAL → PARTIAL (notes only) | 103  |

STALE + DUPLICATE = 15 = rows moved to FULLY_CLOSED or DUPLICATE.

Triage results over the 497 rows:

| Result            | Rows |
| ----------------- | ---- |
| STILL_OPEN        | 288  |
| PARTIAL_CONFIRMED | 150  |
| CLAIMED           | 44   |
| STALE             | 11   |
| DUPLICATE         | 4    |
| NOT_TRIAGED       | 0    |

Claimed by in-flight work: 44 rows, all excluded from triage with no CSV change:

| Claimed by                      | Rows |
| ------------------------------- | ---- |
| PR #654 (institution)           | 22   |
| `fix/audit-parent-portal-batch` | 11   |
| PR #633 (role catalogue)        | 11   |

Rows still OPEN/PARTIAL, by eligibility:

| Eligibility          | Rows                                                                |
| -------------------- | ------------------------------------------------------------------- |
| BLOCKED_FOR_APPROVAL | 155                                                                 |
| NEEDS_DECISION       | 72 (the xlsx Needs column contributed 0 because the file is absent) |
| SCHEMA_BATCH         | 58                                                                  |
| INFRA_BATCH          | 41                                                                  |
| ELIGIBLE_LOW         | 59                                                                  |
| ELIGIBLE_MEDIUM      | 53                                                                  |

## Evidence gate (consolidation)

- **Completeness:** every group input row has exactly one triage entry (453 = 113 + 116 + 111 + 113). No row is NOT_TRIAGED.
- **STALE (14 proposed):**
  - Each proposal needed tip `file:line` evidence and a test with exit code 0 whose log exists. The medium rows M292, M382, M386, M549 and M211 were spot-opened at tip.
  - 11 were accepted. M292's production PG path (`pg-library-repository.ts:274-300`) honours `decrementAvailable` in code, but no PG test was run.
  - 3 were downgraded, with no CSV change:
    - PRC-L421 and PRC-L439 → STILL_OPEN / NEEDS_DECISION. The merged D6 PR #634 ledger table keeps both OPEN ("root cause is a live module/backend, not resolved by deletion"). For L421 the backend cross-board transfer surface is still at tip (`student/src/enrollment/enrollment-routes.ts:523`, `api-gateway/src/rbac-registry.ts:48`). The owner must reconcile.
    - PRC-M211 → PARTIAL_CONFIRMED / NEEDS_DECISION. Webhook fan-out is opt-in: `parseWebhookFanOutEvents` returns `[]` when `WEBHOOK_FANOUT_EVENTS` is unset (`developer-portal/src/webhook-event-fanout.ts:40`), so by default nothing creates deliveries. Migration 113 was not live-verified.
- **DUPLICATE (4):** the twins PRC-M132, L500, M381 and M543 all exist in the ledger and are PARTIAL, not DUPLICATE.
- **PRC-L563:** its PARTIAL_CONFIRMED notes refresh was **not written**. The row already has a CSV encoding anomaly (backslash-escaped quotes, which parse as 12 fields), and rewriting it would re-encode the line. It stays PARTIAL with its original bytes.

## Changed ledger rows (163)

| id       | old → new              | result            | evidence                                                                                                                                                                                                 |
| -------- | ---------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRC-L175 | OPEN → FULLY_CLOSED    | STALE             | `packages/backend/timetable/src/routes.ts:121`, `packages/backend/timetable/src/routes.ts:160`; test exit 0 `timetable-vitest.log`                                                                       |
| PRC-L209 | OPEN → FULLY_CLOSED    | STALE             | `apps/etl-worker/src/server.ts:92-108`, `apps/etl-worker/src/auth.ts:110-126`; test exit 0 `L209-etl-worker.log`                                                                                         |
| PRC-L434 | OPEN → FULLY_CLOSED    | STALE             | `apps/web/src/features/registration/RegistrationWizard.tsx (at d02fae81^):490`, `apps/registration-portal/src/components/registration/document-upload.tsx:79`; test exit 0 `web-d6-guard-tests.log`      |
| PRC-L513 | OPEN → FULLY_CLOSED    | STALE             | `packages/ui/data-grid/src/DataGrid.tsx:57`, `packages/ui/data-grid/src/DataGrid.tsx:59`; test exit 0 `data-grid-audit-test.log`                                                                         |
| PRC-M292 | OPEN → FULLY_CLOSED    | STALE             | `packages/backend/library/src/library-service.ts:183`, `packages/backend/library/src/library-service.ts:204`; test exit 0 `library-vitest.log`                                                           |
| PRC-L374 | PARTIAL → FULLY_CLOSED | STALE             | `packages/backend/timetable/src/generation.ts:213`, `packages/backend/timetable/src/timetable-service.ts:1228`; test exit 0 `timetable-vitest.log`                                                       |
| PRC-L389 | PARTIAL → FULLY_CLOSED | STALE             | `tools/scripts/run-e2e-backend-ready.sh:24-28`, `tools/scripts/run-e2e-backend-ready.sh:59-63`; test exit 0 `L389-run-e2e.log`                                                                           |
| PRC-L573 | PARTIAL → FULLY_CLOSED | STALE             | `packages/backend/library/src/patron-binding.test.ts:158`, `packages/backend/library/src/library-ops.test.ts:162`; test exit 0 `library-vitest.log`                                                      |
| PRC-M382 | PARTIAL → FULLY_CLOSED | STALE             | `packages/backend/staff/src/staff-csv.ts:141`, `packages/backend/staff/src/staff-csv.ts:34`; test exit 0 `staff-vitest.log`                                                                              |
| PRC-M386 | PARTIAL → FULLY_CLOSED | STALE             | `packages/backend/student/src/students-360/service.ts:521`, `packages/backend/student/src/students-360/service.ts:463`; test exit 0 `student-vitest.log`                                                 |
| PRC-M549 | PARTIAL → FULLY_CLOSED | STALE             | `packages/backend/timetable/src/routes.ts:1250`, `packages/backend/timetable/src/routes.ts:1267`; test exit 0 `timetable-vitest.log`                                                                     |
| PRC-L501 | PARTIAL → DUPLICATE    | DUPLICATE         | duplicate of PRC-L500; Same defect at the same location as PRC-L500, which stays as the surviving row.                                                                                                   |
| PRC-M067 | PARTIAL → DUPLICATE    | DUPLICATE         | duplicate of PRC-M132; Row title itself says 'duplicate of M132'; same file/endpoint, same fail-closed behaviour.                                                                                        |
| PRC-M371 | PARTIAL → DUPLICATE    | DUPLICATE         | duplicate of PRC-M381; M381 is a superset (erase + forge + lock) of the same defect at the same location and survives.                                                                                   |
| PRC-M380 | PARTIAL → DUPLICATE    | DUPLICATE         | duplicate of PRC-M543; Same defect at the same location; M543 is the superset row.                                                                                                                       |
| PRC-L093 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/sql/242_outbox_redrive_history_append_only.sql:1,27,72`; unmet: mirror redrive_history entries into audit_log_entries                                                                         |
| PRC-L136 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `packages/backend/privacy/src/pg-privacy-repository.ts:401`; unmet: legal-hold release is read-then-write with no conditional UPDATE/row lock (pg-privacy-repository.ts:262-291; privacy-service… |
| PRC-L195 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `packages/ui/bulk-import/src/BulkImport.tsx:143`; unmet: file-upload, data-grid (e.g. 'Rows per page:', 'Export data to Excel'), area-picker, notification-bell, dashboards still hard-code Engl… |
| PRC-L223 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `apps/public-website/src/lib/health.ts:22`; unmet: Dockerfile does not document/declare CONTACT_WEBHOOK_URL / STATUS_PROBE_* runtime env                                                          |
| PRC-L228 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `apps/web/src/components/gradebook/gradebook-workflow-panel.test.tsx`; unmet: no component tests for the staff and students list pages (app/(dashboard)/staff/page.tsx, app/(dashboard)/students… |
| PRC-L236 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `apps/web/src/components/examinations/exam-ops-controls.tsx:226`; unmet: exam ops page still loads invigilators per session (N+1) — apps/web/src/app/(dashboard)/examinations/[id]/ops/page.tsx:… |
| PRC-L253 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `apps/web/src/lib/sw/sw-parity.test.ts:2`; unmet: classifier is still hand-duplicated (drift detected, not generated)                                                                             |
| PRC-L277 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `packages/backend/attendance/src/ops-schemas.ts:64`; unmet: UUID validation for device-registration and ingest identifiers                                                                        |
| PRC-L293 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/sql/241_actor_reason_trusted_source.sql:1-37`; unmet: reason sourcing from trusted column                                                                                                     |
| PRC-L294 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/sql/240_rls_malformed_guc_safe_deny.sql:1-5,31-41,70-87`; unmet: identify/fix tenth policy cited by finding                                                                                   |
| PRC-L295 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `packages/backend/audit/src/audit-service.ts:252-262`; unmet: platform-controlled archival window                                                                                                 |
| PRC-L375 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `tools/dod-checks/src/lib/fs-utils.mjs:50-55`; unmet: fail when ts-ast unavailable                                                                                                                |
| PRC-L408 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `apps/web/src/app/(dashboard)/health/_components/create-counselling-session-form.tsx:5`; unmet: live health lists have no paging (lib/api/health.ts:168-169 fetchList('/health/records') with no… |
| PRC-L460 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `docker-compose.yml:28-32`; unmet: stop overriding POSTGRES_PASSWORD with a known password                                                                                                        |
| PRC-L461 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/seeds/006_sunrise_public_school_demo.sql:1877-1894`; unmet: write demo audit rows via chained writer or drop them                                                                             |
| PRC-L462 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/seeds/004b_sis_master_schedule_demo.sql:1`; unmet: correct sector/ownership seed values                                                                                                       |
| PRC-L463 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/sql/063_student_merge_registry.sql:1-8`; unmet: wire consumers or drop tables                                                                                                                 |
| PRC-L494 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `packages/shared/search-index/src/adapters/postgres-search-index.ts:83`; unmet: no service imports @proctira/search-index (no package.json dependency outside the package), so the index is stil… |
| PRC-L555 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/seeds/003_sis_timetable_board_scales.sql:84-98`; unmet: DB constraint preventing grading band gaps/overlaps                                                                                   |
| PRC-L556 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/seeds/003_sis_timetable_board_scales.sql:27,143`; unmet: colocated *b seeds GUC binding                                                                                                       |
| PRC-L597 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `packages/ui/form-builder/vitest.config.ts:19`; unmet: no jest-axe/vitest-axe dependency in the widget packages (only packages/ui/components/package.json:60-65)                                  |
| PRC-M005 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `apps/admin-console/e2e/01-platform-admin-smoke.spec.ts:39`; unmet: authenticated e2e still skipped and cannot log in without a seeded backend (apps/admin-console/e2e/01-platform-admin-smoke.s… |
| PRC-M013 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `apps/api-gateway/src/mutation-audit.ts:120`; unmet: grades/attendance/staff/student/scholarship(other than netting)/tenant-admin mutations still rely on post-hoc audit with body hash only and… |
| PRC-M014 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `apps/api-gateway/src/app.ts:1149`; unmet: no HTTP regression test proves that a post-commit audit failure returns the original 2xx with x-audit-status: deferred (grep finds no test asserting…  |
| PRC-M026 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `apps/api-gateway/src/scim-plugin.ts:449`; unmet: GET /Users (incl. eq filters) and GET /Groups still page through the whole tenant directory via allUsers() in memory (scim-plugin.ts:268-278,4… |
| PRC-M147 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `apps/web/src/lib/api/dashboards.ts:759`; unmet: dead client apps/web/src/lib/api/dashboards.ts still contains the fabricated log-scale enrollment score (:668, :756-759) and browser-local form… |
| PRC-M155 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `apps/web/src/lib/institutions/lookups.ts:26`; unmet: type/sector/ownership still use nil-pattern fallback UUIDs (lookups.ts:24-37) pending catalogue endpoints + seed + remap migration          |
| PRC-M169 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `packages/backend/attendance/src/prisma-attendance-repository.ts:629`; unmet: Live-PG verification of the new config reads                                                                        |
| PRC-M173 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `packages/backend/attendance/src/ops-service.ts:398`; unmet: Wire holidayLookup into the gateway attendance ops service                                                                           |
| PRC-M183 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `packages/backend/auth/src/mfa-routes.test.ts:48`; unmet: no HTTP tests for invite routes (create/accept/revoke) — invite/routes.ts only exercised for tenant-directory                           |
| PRC-M198 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/sql/244_sis_range_checks_locked_grade_guard.sql:41-48`; unmet: range checks on remaining core SIS tables (scope unconfirmed without xlsx)                                                     |
| PRC-M201 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/sql/245_payroll_fee_adjustment_immutability.sql:28-55`; unmet: balanced-journal constraint                                                                                                    |
| PRC-M202 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/sql/245_payroll_fee_adjustment_immutability.sql:60-87`; unmet: journal_id FK to fee ledger                                                                                                    |
| PRC-M207 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/sql/246_payroll_posted_once_per_month.sql:1,78`; unmet: live-PG verification of 246 (requires Postgres)                                                                                       |
| PRC-M213 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/sql/248_academic_fee_overlap_exclusion.sql:1,111-122`; unmet: close-prior header contradiction                                                                                                |
| PRC-M215 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/sql/249_scholarship_document_retention.sql:29-45`; unmet: purge/erasure job                                                                                                                   |
| PRC-M311 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `docker-compose.yml:29-32`; unmet: pin MinIO by digest                                                                                                                                            |
| PRC-M330 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `packages/backend/registration/src/registration-service.ts:148`; unmet: no antivirus/malware scan of stored documents                                                                             |
| PRC-M400 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/sql/230_timetable_section_meeting_subject_persist.sql:1`; unmet: Live-PG round-trip of meeting.subjectId (test skipped; NOT VERIFIED)                                                         |
| PRC-M503 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `db/sql/250_fee_payment_provider_txn_id.sql:1,19`; unmet: provider-aware defaults                                                                                                                 |
| PRC-M530 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `docker-compose.yml:149-152`; unmet: ALLOW_SANDBOX_PROVIDERS default 0                                                                                                                            |
| PRC-M559 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `tools/scripts/phi-retention-job.mjs:131-140`; unmet: psqlScalar throw                                                                                                                            |
| PRC-M568 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `apps/registration-portal/e2e/03-registration-live-journey.spec.ts:30`; unmet: no CI workflow seeds E2E_REGISTRATION_INSTITUTION_ID or runs registration-portal against a live backend (e2e-back… |
| PRC-M602 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `packages/backend/plugin/src/sandbox/in-process-sandbox.ts:98`; unmet: the worker-based PluginSandbox still runs plugin code in node:vm inside a worker thread (sandbox-worker.ts:12,205); a vm…  |
| PRC-M628 | OPEN → PARTIAL         | PARTIAL_CONFIRMED | met at `packages/backend/plugin/src/sandbox/egress-policy.ts:25`; unmet: redirects are not blocked or re-validated: both sandboxes call globalThis.fetch with caller init (default redirect follow) aft… |
| PRC-L006 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/mobile/lib/core/router/app_router.dart:117`; unmet: ATTENDANCE_THRESHOLD still routes to ReportDetailScreen(id: 'attendance-summary') placeholder pending a backend attendance-summary rep… |
| PRC-L007 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/mobile/lib/app/app.dart:22`; unmet: l10n coverage still a hand-rolled map in apps/mobile/lib/core/l10n/app_localizations.dart; no ARB/gen_l10n; ~70 hard-coded English Text('...') literal… |
| PRC-L011 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/mobile/lib/features/attendance/presentation/attendance_screen.dart:350`; unmet: offline fallback still permits free-text institution id entry when the institutions cache is empty (by des… |
| PRC-L036 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/app/(dashboard)/examinations/[id]/candidates/page.tsx:85`; unmet: no issued board registration number field exists on the candidate record                                          |
| PRC-L048 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/app/(dashboard)/staff/[id]/page.tsx:422`; unmet: designation, subjects, school, joinDate (service years) and qualification still read from free-form customData and shown as autho… |
| PRC-L054 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/app/(dashboard)/students/_components/student-profile-kpis.ts:33`; unmet: attendance on-track threshold is a hard-coded constant (ATTENDANCE_ON_TRACK_PCT, [id]/page.tsx:370) rathe… |
| PRC-L056 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/app/(dashboard)/staff/leaves/_components/leave-decision-buttons.tsx:53`; unmet: no remaining leave balance shown at decision time                                                   |
| PRC-L079 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/assessment/src/result-service.ts:143`; unmet: TypeBox body schema with UUID + maxItems                                                                                          |
| PRC-L083 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/assessment/src/report-card-routes.ts:147`; unmet: Stop leaking output_url via parent-portal                                                                                     |
| PRC-L097 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/api-gateway/src/domain-plugins.ts:1784`; unmet: analytics/docs/ratings remain in-memory while the gateway comment still says 'G-607 / W1-ARCH-01 COMPLETE' (apps/api-gateway/src/domain-pl… |
| PRC-L115 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/health/src/routes.ts:146`; unmet: Remove 'anonymous' actor fallback                                                                                                             |
| PRC-L117 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/hostel/src/schemas.ts:25`; unmet: Calendar-date validation                                                                                                                      |
| PRC-L129 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/library/src/library-service.ts:55`; unmet: Loan limits                                                                                                                          |
| PRC-L157 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/staff/src/staff-service.ts:318`; unmet: Align delete contract (soft-delete semantics) across route docs and adapters                                                            |
| PRC-L172 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/theme/src/routes.ts:359`; unmet: publish body validation failure is silently ignored (routes.ts:359-361 uses commitMessage undefined instead of 400)                            |
| PRC-L204 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/api-gateway/src/insights-ui-plugin.ts:180`; unmet: demo-mode path still casts the body with a presence check only: no TypeBox schema (source enum, filename length, rows integer >= 0) bef… |
| PRC-L213 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/tenant/src/roles-service.ts:480`; unmet: tenant id still client-typed; no tenant-memberships listing endpoint exists in packages/backend/auth or packages/backend/tenant        |
| PRC-L216 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/public-website/src/lib/contact-rate-limit.ts:43`; unmet: falls back to x-real-ip then a shared 'unknown' bucket (contact-rate-limit.ts:68)                                                  |
| PRC-L225 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/registration-portal/src/lib/track-lookup.ts:27`; unmet: x-forwarded-host is trusted without an allow-list (trusted-edge decision)                                                           |
| PRC-L240 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/app/(dashboard)/fees/_components/new-fee-plan-form.tsx:95`; unmet: fees create forms (new-fee-plan-form.tsx, new-invoice-form.tsx) have no field-level errors / aria-invalid        |
| PRC-L256 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/app/(dashboard)/audit-logs/actions.ts:17`; unmet: backend audit schema still allows retentionMonths minimum 1 (packages/backend/audit/src/schemas.ts:79)                            |
| PRC-L260 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/lib/validation/action-input-schema.ts:47`; unmet: dayPattern is a free string (max 60) with no allowed-pattern validation (action-input-schema.ts:47)                               |
| PRC-L263 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/app/(dashboard)/help/help-accuracy.test.ts`; unmet: registration submit journey is only a live e2e spec that is skipped by default in CI (see PRC-M568)                             |
| PRC-L269 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/features/settings/pages/NotificationPreferences.tsx:77`; unmet: notification backend has no per-category mandatory flags; enforcement is UI-only                                    |
| PRC-L270 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/features/scholarships/components/application-documents-panel.tsx:158`; unmet: Preview calls the same download() as Download (application-documents-panel.tsx:150-160)               |
| PRC-L274 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/assessment/src/assessment-access.ts:35`; unmet: Per-student scoping                                                                                                             |
| PRC-L275 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/attendance/src/prisma-attendance-repository.ts:553`; unmet: Live-PG roster verification                                                                                         |
| PRC-L278 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/attendance/src/ops-routes.test.ts:1`; unmet: Execute live cross-tenant ops-store suite green                                                                                    |
| PRC-L288 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/curriculum/src/routes.ts:136`; unmet: PATCH body/:id validation                                                                                                                 |
| PRC-L289 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `db/sql/071_cross_domain_fk_constraints.sql:112`; unmet: updateOutcome unit ownership check                                                                                                       |
| PRC-L310 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/gradebook/src/signed-download.ts:175`; unmet: Dedicated board-export secret, fail closed in production                                                                          |
| PRC-L312 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/health/src/pg-student-institution-lookup.ts:30`; unmet: Fail closed on student-institution lookup errors across all PHI read paths                                              |
| PRC-L313 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/health/src/aws-kms-phi-client.ts:135`; unmet: Root-key hot refresh / rotation without restart (decision)                                                                        |
| PRC-L327 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/library/src/library-service.ts:590`; unmet: Institution scoping of catalog items (decision)                                                                                     |
| PRC-L329 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/lms/src/lms-file-store.ts:96`; unmet: Dedicated secret, fail closed in production                                                                                               |
| PRC-L330 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/lms/src/pg-lms-repository.ts:54`; unmet: Remove per-assignment N+1 in analytics                                                                                                 |
| PRC-L331 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/lms/src/lms-service.ts:104`; unmet: SIS identity mapping                                                                                                                        |
| PRC-L339 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/report/src/pg-report-store.ts:126`; unmet: resolveTenantId still falls back to the client x-tenant-id header after request.tenantId (catalogue-routes.ts:24-31)                 |
| PRC-L366 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/student/src/import/import-routes.test.ts:1`; unmet: Cross-tenant isolation tests for new stores                                                                                 |
| PRC-L373 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/timetable/src/timetable-service.ts:132`; unmet: Wire auditPool into the gateway TimetableService                                                                                |
| PRC-L380 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `tools/scripts/apply-sql.sh:207-213`; unmet: strict-FK default outside CI/production                                                                                                              |
| PRC-L413 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/scripts/capture-institutions-timetable.mjs:49`; unmet: HMAC dev secret still hard-coded (apps/web/scripts/capture-institutions-timetable.mjs:49 'dev-secret-change-in-production'); no… |
| PRC-L435 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/app/(dashboard)/scholarships/disbursements/page.tsx:66`; unmet: payment date formatted without a timeZone (page.tsx:74-82), not tenant timezone                                     |
| PRC-L436 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/app/(dashboard)/scholarships/_components/application-decision-form.tsx:97`; unmet: approval rationale is optional (comment Textarea, no requirement)                                |
| PRC-L464 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/developer-portal/src/developer-portal-service.ts:695`; unmet: no claim/lease for in-flight 'pending' deliveries, so concurrent or post-crash redelivery can re-send; crash-saf… |
| PRC-L466 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/developer-portal/src/developer-portal-service.test.ts:93`; unmet: RLS-enforcing cross-tenant cases only exist as live PG tests that skip without DATABASE_URL (pg-h049-residua… |
| PRC-L472 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/health/vitest.config.ts:10`; unmet: Coverage thresholds                                                                                                                         |
| PRC-L503 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/timetable/src/timetable-access.test.ts:1`; unmet: Execute the live-PG suites green against a migrated DB                                                                        |
| PRC-L527 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/admin-console/src/lib/api/gateway.ts:117`; unmet: admin-console list endpoints remain unpaginated                                                                                           |
| PRC-L532 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/app/(public)/track/application-tracking.tsx:148`; unmet: no aria-live/focus move for lookup results                                                                                 |
| PRC-L534 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/app/dead-internal-links.test.ts:69`; unmet: components/layout/marketing-header.tsx / marketing-footer.tsx still carry ~45 dead link targets, excluded only because unrouted; app/(… |
| PRC-L545 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/lib/auth/return-to.test.ts:3`; unmet: no forged/unsigned-token rejection test — blocked on PRC-L254 signature verification                                                          |
| PRC-L574 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/lms/src/lms-scope-fence.test.ts:1`; unmet: Parent/guardian role tests                                                                                                           |
| PRC-L589 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/student/src/import/import-routes.ts:135`; unmet: Row cap                                                                                                                        |
| PRC-L592 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/transport/src/transport-ops.test.ts:1`; unmet: Cross-tenant isolation tests                                                                                                     |
| PRC-M022 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/api-gateway/src/workflow-ui-engine-store.ts:286`; unmet: definitions list (workflow-ui-plugin.ts:249 -> listDefinitions with PAGE 200) still truncates                                      |
| PRC-M039 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/mobile/test/parent_home_screen_test.dart:111`; unmet: mobile Fees screen still read-only; sandbox POST /parent-portal/fees/invoices/:id/pay not wired                                       |
| PRC-M090 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/lib/api/fees.ts:380`; unmet: refund still cannot target a specific payment (no paymentId in the contract)                                                                           |
| PRC-M132 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/lib/tenant-theme/server.ts:143`; unmet: no backend serves the published-theme path; tenant branding never on first paint                                                            |
| PRC-M133 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/app/api/auth/refresh/route.test.ts:24`; unmet: no tests for login, callback and mfa-verify proxies                                                                                  |
| PRC-M134 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/lib/api/gateway-proxy.ts:81`; unmet: request.arrayBuffer() buffers the full body before the cap (gateway-proxy.ts:81)                                                               |
| PRC-M144 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/lib/api/admin.ts:584`; unmet: dead PATCH client updateTenantGeneralSettings still exported from apps/web/src/lib/api/admin.ts:578-587 (zero callers)                                |
| PRC-M146 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/lib/api/list-result.drift.test.ts:43`; unmet: 91 reads still collapse denial/outage to an empty list                                                                                |
| PRC-M166 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/assessment/src/report-card-schemas.ts:151`; unmet: Inline bulk N-cap                                                                                                            |
| PRC-M231 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/examination/src/ops-store.ts:715`; unmet: Normalize free-text room_id to the shared rooms table                                                                                 |
| PRC-M293 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/library/src/isbn-lookup.ts:133`; unmet: Production fail-closed when no real ISBN provider is configured                                                                         |
| PRC-M332 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/registration/src/routes.ts:403`; unmet: no per-identifier throttle on anonymous submit                                                                                          |
| PRC-M349 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/scholarship/src/scholarship-service.ts:425`; unmet: Institution-local 'today'                                                                                                   |
| PRC-M368 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `db/sql/246_payroll_posted_once_per_month.sql:78`; unmet: Map unique violation to 409/idempotent re-export                                                                                        |
| PRC-M378 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/staff/src/routes.ts:80`; unmet: Mask/ACL DOB, phone, salary                                                                                                                     |
| PRC-M381 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/staff/src/staff-service.ts:346`; unmet: Dedicated offboard status column                                                                                                        |
| PRC-M392 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/theme/src/theme-service.ts:164`; unmet: theme package is PARKED/unmounted in the gateway (apps/api-gateway/src/mount-matrix.ts:571), so runtime behaviour is unverifiable       |
| PRC-M394 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/theme/src/schemas.ts:54`; unmet: theme package is PARKED/unmounted (G-605) so rendering path is unverifiable                                                                    |
| PRC-M395 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/theme/src/theme-service.ts:94`; unmet: theme package is PARKED/unmounted (G-605) so runtime authz path is unverifiable                                                          |
| PRC-M396 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/timetable/src/timetable-service.ts:886`; unmet: Executed live-PG concurrency proof for createMeetingAtomic                                                                      |
| PRC-M407 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/timetable/src/routes.ts:124`; unmet: Executed (live-PG) test proving substitutions of soft-deleted meetings/sections are hidden                                                 |
| PRC-M463 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/workflow/src/transition-concurrency.test.ts:10`; unmet: the optimistic transition guard is only proven against InMemoryWorkflowRepository; no PG-backed (live) concurrent-tran… |
| PRC-M467 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/install-wizard/src/lib/bootstrap-lock.ts:23`; unmet: lock is per-session in an in-memory Map (apps/install-wizard/src/lib/bootstrap-lock.ts:19-24, 65); a fresh session bypasses it         |
| PRC-M468 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/attendance/src/schemas.ts`; unmet: AttendanceRecord.toRecordPayload() does not send lat/lon and RecordStudentAttendanceSchema (packages/backend/attendance/src/schemas.ts) has… |
| PRC-M470 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/mobile/android/app/build.gradle.kts:64`; unmet: certificate pinning not implemented (no pinning/SecurityContext/badCertificateCallback under apps/mobile/lib)                               |
| PRC-M482 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/lib/api/scholarships.ts:150`; unmet: program code is still embedded in/parsed from description (apps/web/src/lib/api/scholarships.ts:150,247); no real code column                  |
| PRC-M489 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `apps/web/src/lib/api/gateway.test.ts:136`; unmet: no dedicated suites for lib/api/examinations.ts, lib/api/admin.server.ts, lib/api/health.ts                                                    |
| PRC-M495 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/assessment/src/report-card-routes.ts:427`; unmet: Domain before/after score audit                                                                                               |
| PRC-M496 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/attendance/src/attendance-service.ts:225`; unmet: Back-dating window (owner decision)                                                                                           |
| PRC-M497 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/auth/src/mfa-routes.ts:100`; unmet: gateway mounts registerMfaRoutes without resolvePrimaryAuth/issueCompletionTicket (apps/api-gateway/src/app.ts:610-611), so the challenge…  |
| PRC-M508 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `workers/exam-document/src/worker.ts:101`; unmet: Graceful drain of in-flight handlers on stop() (needs queue-abstraction consumer-cancel/drain primitive)                                        |
| PRC-M510 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/examination/src/document-generation-service.ts:202`; unmet: Real roll number on admit cards/certificates                                                                        |
| PRC-M514 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/gradebook/src/board-export-generator.ts:39`; unmet: Object storage                                                                                                              |
| PRC-M515 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/gradebook/src/schemas.ts:5`; unmet: UUID validation                                                                                                                             |
| PRC-M527 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/lms/src/lms-service.ts:733`; unmet: Domain before/after audit                                                                                                                   |
| PRC-M528 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/lms/src/lms-file-store.ts:44`; unmet: RFC 5987 Content-Disposition                                                                                                              |
| PRC-M537 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/registration/src/pipeline/pipeline-service.ts:618`; unmet: waitlist dequeue + next offer creation are separate store calls, not one transaction (pipeline-service.ts:749-751)   |
| PRC-M539 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/scholarship/src/document-service.ts:216`; unmet: Bind verify/reject to the route application id                                                                                 |
| PRC-M540 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/scholarship/src/scholarship-service.ts:319`; unmet: totalSlots >= usedSlots guard                                                                                               |
| PRC-M543 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/staff/src/training-service.ts:69`; unmet: Scheduler wiring                                                                                                                      |
| PRC-M547 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/student/src/import/duplicate-detector.ts:37`; unmet: Issue admission numbers on import                                                                                          |
| PRC-M550 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/timetable/src/timetable-service.ts:1244`; unmet: Atomic (all-or-nothing) persistMeetings                                                                                        |
| PRC-M583 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/assessment/src/pg-report-card-repository.live.test.ts:51`; unmet: Executed live Prisma tenant-isolation test for grading/result repositories                                    |
| PRC-M587 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/auth/src/external-providers/saml-provider.ts:211`; unmet: no signature-verifying SAML response parser ships — the only built-in parser is regex-based with verifiesSignature=f… |
| PRC-M589 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/auth/src/external-providers/external-auth-routes.ts:41`; unmet: pending login state and the default web-ticket store are still process-local (in-memory Map / MemoryWebTicketS… |
| PRC-M620 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/examination/src/cross-tenant-authz.test.ts:1`; unmet: PG-backed suites executed in CI/live DB                                                                                   |
| PRC-M632 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/scholarship/src/pg-approve-application-concurrency.live.test.ts:70`; unmet: verify/reject IDOR tests                                                                            |
| PRC-M635 | PARTIAL → PARTIAL      | PARTIAL_CONFIRMED | met at `packages/backend/student/src/import/import-service.ts:371`; unmet: Record processRows failures                                                                                                   |

## Overlap with other ledger PRs

Edits are row-scoped: only changed lines differ, so conflicts are limited to the rows below.

- **#652 `docs/reconcile-ledger-649`:** MERGED, and its merge commit is this PR's base. It changed 17 rows (`triage-manifest.json` → `overlap_652`). Rows that this PR also changes: none.
- **#630 `chore/canonical-gap-ledger`:** OPEN and CONFLICTING. It adds the CSV as a new file against an old base, so in raw diff terms it overlaps all 163 changed rows. Rows whose content actually differs between #630 and main (`overlap_630_effective_vs_main`, 112 rows) and that this PR also changes (16): PRC-L006, PRC-L007, PRC-L011, PRC-L115, PRC-L213, PRC-L312, PRC-L313, PRC-L435, PRC-L472, PRC-M039, PRC-M231, PRC-M349, PRC-M468, PRC-M470, PRC-M510, PRC-M620. If #630 is revived it must be rebased onto main after this PR, and these rows must be re-resolved.

## Baseline failures (pre-existing, not fixed)

Baseline at `4c7fb8fe`:

- typecheck: exit 0
- test: exit 0 (11,692 passed, 299 skipped, 0 failed)
- lint: **exit 1**. 27 packages fail with 133 errors, mostly `import/order` and `no-unused-vars`. The list is in `baseline-assessment.md`, and the log is `logs/baseline/lint.log` (gitignored).

These failures predate this PR. This PR changes no lintable source.

## Tests and verification evidence

- Triage targeted test runs: 39 distinct commands, all exit 0, every log present (`evidence-manifest.json` → `tests_run`). `~/bin/server-guard.sh` exited 0 before each run.
- `work/verify_ledger.py` (exit 0) checked:
  - 758 data rows
  - CRLF line endings and trailing newline kept
  - header and row order unchanged
  - changed ids == accepted proposals
  - only the 3 allowed columns differ, and their values equal the proposals
  - all other lines byte-identical to `4c7fb8fe`
  - before-counts match `ledger-before.json`
- `work/wave1_plan.py` (exit 0): the three Wave 1 file sets are pairwise disjoint.
- No test command ran during consolidation, because the change is limited to the ledger and docs.

Rollout and rollback: documentation only. Revert the ledger commit to roll back. No runtime, migration, API, event or tenant impact. Security/privacy impact: none (no code). Some PRC rows now read FULLY_CLOSED, and the evidence above backs each one.

## Not verified

- xlsx Fix steps / Acceptance / Needs, because the file is absent.
- Live/PG suites, because `DATABASE_URL`/`REDIS_URL` were unset. This covers:
  - the PG repository paths, including library `claimCopyForCheckout` (M292) and developer-portal migration 113 (M211)
  - the db rows from PR #650 (kept PARTIAL)
- Flutter/Dart tests (no toolchain), which affects the mobile rows and PRC-M254.
- Web/Flutter e2e, build-only gates and root `check:*` scripts.
- Why main CI is green while package lint fails at baseline.
- The Wave 1 expected file sets, which are planning estimates.

## Wave 1 (planned, separate PRs)

| Branch                         | Findings | Notes                                                                     |
| ------------------------------ | -------- | ------------------------------------------------------------------------- |
| `fix/app-web-batch1`           | 12       | PRC-L255 salvaged from `fix/web-lows-L255`                                |
| `fix/ui-packages-batch1`       | 2        | Only custom-field L447/L448 are eligible; every ui-* row needs a decision |
| `fix/platform-services-batch1` | 10       | etl, data-warehouse, notification, survey                                 |

## Reviewer verdict

APPROVED: one independent semantic review pass found no blocking findings. The full review doc is kept locally in the run folder (`review/review.md`) and is not committed.

### Follow-ups (non-blocking review findings)

- [ ] PRC-M292: FULLY_CLOSED rests on the in-memory suite. The PG `claimCopyForCheckout` / `decrementAvailable` path looks correct in code, but no live-PG test ran. Add a live-PG hold-fulfilment test, or annotate the PG path as EXTERNALLY_UNVERIFIED.
- [ ] PRC-L573: the concurrency and cross-tenant tests use `InMemoryLibraryRepository` only, so PG row locking and RLS are not proven. Record that limit in the row note, or add live-PG tests.
- [ ] PRC-L434 / PRC-M330: L434 is closed by the D6 deletion, and its cited web tests are indirect (route guard, not upload). Confirm that the M330 residual covers the server-issued id / AV step from L434's prior note.
- [ ] PRC-M386 residual: upload compensation swallows blob-delete errors, and `removeDocument` deletes the row before the blob. A storage failure can still orphan an untracked blob. Note the residual or add retry/outbox.
- [ ] PRC-L447 / PRC-L448: Wave 1 Batch B (`fix/ui-packages-batch1`) has 2 findings against a target of about 10. Merge it into a later custom-field batch or accept it as a small PR.
- [ ] Batch A owner-parked items: L435's tenant-timezone step depends on the unanswered DECISION_REGISTER §3 policy (L596 is NEEDS_DECISION for the same policy). The L413 and M134 prior notes say "owner". Confirm these with the owner or drop those halves. Run the D6 guardrail (full Next build + web/E2E) for the L530/M144/M147 deletions.
