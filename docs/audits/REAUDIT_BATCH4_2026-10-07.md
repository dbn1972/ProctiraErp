# Re-audit — Batch 4 (mobile · portals · install · cleanup) — 2026-10-07

Branch: `fix/audit-batch4-mobile-portals-cleanup`
Owned paths: `apps/mobile`, `packages/flutter-core`, `apps/registration-portal`,
`apps/install-wizard`, parent-portal web pages, `apps/web` components outside
batch-2 module folders.

Dispositions: FULLY_CLOSED / PARTIAL / ALREADY_FIXED / OPEN.
Honesty rule: FULLY_CLOSED/ALREADY_FIXED only with a test that fails without the
fix (or an existing passing test proving the behaviour). CI-only means it could
not be executed here (no live Postgres / helm / device farm).

Verification environment: Flutter SDK 3.47.4; `flutter test` (apps/mobile),
`dart test` (packages/flutter-core/api-client), `npx vitest run` (Next apps),
`npx tsc --noEmit`.

---

## HIGH findings

| PRC | Disposition | Evidence (file + test) |
|-----|-------------|------------------------|
| PRC-H013 | FULLY_CLOSED | New `apps/mobile/lib/core/auth/token_refresh_policy.dart` + refactored interceptor in `apps/mobile/lib/core/di/injector.dart`: refresh failure forces logout only on 400/401/403; timeout/5xx/connection errors and a failed replay keep the session + offline queue. Test `apps/mobile/test/token_refresh_policy_test.dart` (8 cases) fails against the old always-logout behaviour. The logout-purge half (don't silently purge unsynced work) was already implemented via `AuthWorkspaceSwitchRequested`/`UnsyncedWork` and is covered by `workspace_switch_confirm_test.dart`. `flutter test` → 302 passed. |
| PRC-H014 | ALREADY_FIXED | `apps/mobile/lib/core/storage/database.dart` schemaVersion=8 migration v8 creates `assessment_results_cache`, `examinations_cache`, `examination_results_cache`, all in `_userDataTables`. Proven by `apps/mobile/test/exam_assessment_cache_test.dart` (cache populated, offline read, logout purge). |
| PRC-H015 | ALREADY_FIXED | `apps/mobile/test/scholarship_contract_test.dart` parses real backend payloads (applicantId, applicationEndDate, snake_case `under_review`); `scholarship_bloc_test.dart` passes. 14 contract-test cases green. |
| PRC-H060 | FULLY_CLOSED (contract) / PARTIAL (UX) | Client contract aligned: `attendance_api.dart` POSTs `/api/v1/attendance/student` (backend upsert) for create+edit; `attendance_record.dart` uses real fields (`date`, `academicPeriodId`, `classId`, `EARLY_DEPARTURE`); `sync_dispatcher.dart` routes create+update to the upsert and parks unsupported deletes/malformed payloads. Review follow-up: `AttendanceRepository.markAttendance` now refuses (ArgumentError) to queue a mark without `classId`/`academicPeriodId`, and the attendance screen collects an academic period ID and blocks marking until class + period are set — so no UI mark can be queued that the dispatcher would park. Gateway `dart-client-contract.test.ts` KNOWN_DRIFT updated (4 resolved `/attendance/students*` routes removed; 3/3 pass). Evidence: `test/attendance_repository_test.dart` 'PRC-H060 …never queued' (fails with the guard removed); `flutter test` 303 passed; `dart test` 16 passed; `flutter analyze` clean. RESIDUAL (UX): the academic period is a typed ID, not a picker — the gateway has no academic-period list route yet (`GET /institutions/:id/academic-periods` is known drift; M031/M468). |
| PRC-H018 | ALREADY_FIXED | `apps/registration-portal/src/lib/gateway-config.ts` reads `GATEWAY_URL` and throws in production when unset (no `/api` fallback); `src/lib/gateway.ts` uses `node:http` server transport; browser calls go through the same-origin proxy `src/app/api/registrations/[[...path]]/route.ts`. Tests `src/lib/gateway.test.ts` (8) pass. |
| PRC-H113 | ALREADY_FIXED | `resolvePublicHost` forwards `X-Forwarded-Host`/`Host` to the gateway so the public tenant resolver selects the applicant tenant; `serverTransport` applies it. Tests `src/lib/tenant-host-forwarding.test.ts` (4) pass. CI-only: real two-tenant compose smoke test not runnable here. |
| PRC-H009 | ALREADY_FIXED (install-wizard + developer-portal) | `apps/install-wizard/next.config.mjs` + `security-headers.mjs` emit CSP (`frame-ancestors 'none'`), X-Frame-Options DENY, nosniff, Referrer-Policy, HSTS in prod; same in `apps/developer-portal`. Test `apps/install-wizard/src/security-headers.test.ts` (2) passes. eslint runs in the CI Lint job (config comment); `ignoreDuringBuilds` retained only to keep Docker image builds lean. RESIDUAL: the main `apps/web` app still lacks a global CSP/frame-ancestors (same root cause PRO-S66-05); not changed because a restrictive CSP on the production web app (next-intl, server actions, dashboards) cannot be verified safely here — see OPEN below. |

---

## MEDIUM / LOW findings (owned areas)

| PRC | Disposition | Evidence (file + test) |
|-----|-------------|------------------------|
| PRC-M253 | ALREADY_FIXED | `packages/flutter-core/api-client/lib/src/api/api_client.dart` classifies 408/425/429 as `TransientApiException` with Retry-After; `report_api.dart` downloadReport routes through `request()`. `test/base_api_test.dart` + `api_contract_test.dart` (16 pass). |
| PRC-M254 | FULLY_CLOSED | `test/api_contract_test.dart` asserts the client call-set equals `contract/client_routes.json`; it now reflects the real attendance route. Gateway-side cross-check `apps/api-gateway/src/dart-client-contract.test.ts` KNOWN_DRIFT updated in this batch (3/3 pass). |
| PRC-M035 | ALREADY_FIXED | Examination/assessment caches sealed with CacheCrypto and in `_userDataTables`. `test/exam_assessment_cache_test.dart` (ciphertext-at-rest, logout purge). |
| PRC-M562 | ALREADY_FIXED | Assessment fallback distinguishes 403 (error) from timeout (cached+offline flag). Covered by `exam_assessment_cache_test.dart`. |
| PRC-M051/M052/M053/M055/M056 | ALREADY_FIXED | registration-portal: `institution-map.test.tsx` (typeId→UUID + pagination), `landing-no-fabrication.test.ts` (no hard-coded stats), `catalogs.test.ts` (locale parity), `track-page-state.test.ts`/`track-lookup.test.ts` (outage vs not-found). 78 portal tests pass. |
| PRC-L008 | ALREADY_FIXED | `apps/mobile/lib/core/storage/cache_crypto.dart` throws on unsealed/plaintext reads and binds AAD context. Covered by `cache_crypto_context_test.dart`. |
| PRC-L009 | FULLY_CLOSED | `apps/mobile/lib/core/sync/sync_engine.dart` `flushPending` returns an empty result when no tenant is active (was draining all tenants). Test `apps/mobile/test/sync_engine_test.dart` → "PRC-L009: flushPending dispatches nothing when tenant is unset". |
| PRC-L214 | FULLY_CLOSED | New `apps/mobile/lib/features/scholarship/presentation/scholarship_date_format.dart` (`formatScholarshipStepDate`), used by `scholarship_status_screen.dart` instead of unguarded `substring(0,10)`. Test `apps/mobile/test/scholarship_step_date_test.dart` (short/malformed strings no longer RangeError). |
| PRC-L402 | FULLY_CLOSED | Deleted dead `apps/mobile/lib/features/home/presentation/placeholder_screen.dart` (no references). `flutter analyze` clean; `flutter test` 302 passed. |
| PRC-L226 | PARTIAL | registration-portal CSP/clickjacking headers added via `security-headers.mjs` + `next.config.mjs`; CSP still permits the Leaflet map (unpkg icons, OSM tiles). Test `src/security-headers.test.ts` (2). RESIDUAL: the timeline sr-only state text and `htmlFor`/`id` DocumentUpload a11y, and bundling Leaflet marker images locally, are not addressed. |
| PRC-L225 | FULLY_CLOSED | `src/app/track/lookup/route.ts` builds its redirect from `resolveRedirectBase` (PUBLIC_BASE_URL or X-Forwarded-Host/Proto) rather than the internal request origin. Tests in `src/lib/track-lookup.test.ts` (4 resolveRedirectBase cases). |
| PRC-L005 | FULLY_CLOSED | `apps/install-wizard/src/lib/bootstrap-lock.ts` adds a 30-minute TTL (expired sessions evicted + reported not found) and a `MAX_SESSIONS` cap with sweep-on-insert. Tests in `apps/install-wizard/src/lib/bootstrap-lock.test.ts` (3 fake-timer cases). |

---

## OPEN / not addressed (with reason)

| PRC | Disposition | Reason |
|-----|-------------|--------|
| PRC-H009 (web portion, PRO-S66-05) | OPEN | `apps/web/next.config.mjs` has no global CSP/`frame-ancestors`. Adding a restrictive CSP to the main production web app (next-intl, server actions, dashboards, inline scripts) is high-risk and cannot be verified without a running app; left for a dedicated, test-backed slice. |
| PRC-M467 (install) | OPEN (needs decision) | Persisted global installed-flag + bootstrap secret. The finding itself notes the routes are inert stubs; a safe fix needs an owner decision on the durable store, so not implemented. |
| PRC-L400 (install route tests) | OPEN | No route-handler tests added; lib-level `bootstrap-lock`/`install-security` tests exist. Lower value; deferred to keep quality high on the items above. |
| PRC-L224 (idempotency rotation) | PARTIAL/ALREADY_FIXED | `review-step.tsx` mints a fresh submissionKey on success (PRC-M054); explicit rotation on a 409-after-edit is not added (backend already rejects payload-mismatch with 409). |
| PRC-M568 (registration e2e in CI) | OPEN (CI-only) | Requires the compose stack + seeded tenant in CI; cannot be run here. |
| Mobile M031/M039/M468 and various L2xx | OPEN/PARTIAL | Verified still open against current code but not fixed this stage (functional/UX scope beyond the HIGH + safe-LOW cluster); left to avoid rushing low-value changes. |

---

## Commands run

- `dart test` in `packages/flutter-core/api-client` → 16 passed.
- `flutter test` in `apps/mobile` → 302 passed (full suite, repeated after each change).
- `flutter analyze` in `apps/mobile` and `dart analyze` in api-client → no issues.
- `npx vitest run --exclude '**/*.live.test.ts'` in `apps/registration-portal` → 78 passed.
- `npx vitest run --exclude '**/*.live.test.ts'` in `apps/install-wizard` → 36 passed.
- `npx tsc --noEmit -p .` in install-wizard → clean; in registration-portal → only pre-existing `@proctira/common` `@sinclair/typebox` resolution errors (environmental, not from batch-4 files).

CI-only (not runnable here): live Postgres RLS/isolation, helm, registration e2e
compose smoke, Flutter integration_test device runs.
