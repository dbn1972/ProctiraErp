# Enterprise module test — Flutter mobile

**Module:** Flutter mobile (`apps/mobile`)  
**Branch / tip:** `cursor/mobile-enterprise-e2e-56c3`  
**Environment:** cloud agent (headless / analyzer + unit)  
**Date (UTC):** 2026-09-05  
**Tip CI:** pending on this PR

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md` and adapted for Flutter.

---

## 0. Screen inventory (mobile routes)

| Area         | Route / screen   | Roles         | PII/PHI       | Notes                    |
| ------------ | ---------------- | ------------- | ------------- | ------------------------ |
| Auth         | `/login`         | anonymous     | PII           | Real `AuthApi.login`     |
| Home         | `/`              | authenticated | —             | Logout clears tokens     |
| Students     | `/students`      | staff         | PII           | Cache-first repo         |
| Attendance   | `/attendance`    | staff         | PII           | Offline sync + geofence  |
| Institutions | `/institutions`  | staff         | —             |                          |
| Scholarships | `/scholarships*` | staff/student | financial PII | Needs RepositoryProvider |
| Health       | `/health`        | staff         | PHI           | Needs RepositoryProvider |
| Examinations | `/examinations*` | staff/student | PII           | Needs RepositoryProvider |
| Assessments  | `/assessments*`  | staff/student | PII           | Needs RepositoryProvider |
| Profile      | `/profile`       | authenticated | PII           |                          |

---

## 1. Functionality

| Item                                                                     | Pass     | Evidence                                                            |
| ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------- |
| Package rename `openemis_*` → `proctira_*`                               | ☑        | Dart imports + `proctira_api_client` entry                          |
| `AuthApi` + token models                                                 | ☑        | `packages/flutter-core/api-client/lib/src/api/auth_api.dart`        |
| Login uses real API (no pending tokens)                                  | ☑        | `login_screen.dart`                                                 |
| Bearer + tenant Dio interceptors                                         | ☑        | `injector.dart`                                                     |
| Repos registered (student/attendance/scholarship/health/exam/assessment) | ☑        | `injector.dart`                                                     |
| `MultiRepositoryProvider` for context.read screens                       | ☑        | `app/app.dart`                                                      |
| Scholarship apply provides `ScholarshipBloc`                             | ☑        | `scholarship_application_screen.dart`                               |
| Biometric unlocks stored tokens only                                     | ☑        | `login_screen.dart`                                                 |
| Auth token parse unit tests                                              | ☑        | `packages/flutter-core/api-client/test/auth_tokens_test.dart` (3/3) |
| `flutter analyze`                                                        | ☑        | info-only (6 infos, 0 errors/warnings) on this branch               |
| Device integration_test                                                  | ☐ waived | No emulator in agent; suite retained                                |
| `flutter test` (unit)                                                    | ☑        | 36/36 passed                                                        |

---

## 2. Security

| Check                                            | Pass | Evidence                      |
| ------------------------------------------------ | ---- | ----------------------------- |
| No hardcoded access tokens after login           | ☑    | login path uses `AuthApi`     |
| `X-Tenant-ID` on requests                        | ☑    | Dio interceptor               |
| Bearer on non-public auth paths                  | ☑    | Dio interceptor               |
| Logout clears secure storage (+ best-effort API) | ☑    | `AuthBloc` + `AuthApi.logout` |
| Refresh-on-401 best effort                       | ☑    | interceptor                   |

---

## 3. Residual risks / waivers

| Item                                         | Risk                                   | Owner       | Waiver date  |
| -------------------------------------------- | -------------------------------------- | ----------- | ------------ |
| Live login against auth-service in agent     | Medium — unit parse + wiring covered   | cloud-agent | 2026-09-05   |
| `integration_test/` on emulator              | Medium — suite present, no device here | cloud-agent | 2026-09-05   |
| Android applicationId still `org.openemis.*` | Low — branding leftover                | mobile      | 2026-09-05   |
| Deploy registry / image push                 | Infra — unrelated to mobile            | platform    | pre-existing |

---

## Done criteria

- [x] Auth no longer uses pending fake tokens
- [x] Bearer + tenant interceptors
- [x] Domain repos DI + RepositoryProviders
- [x] `flutter analyze` / unit tests green on this branch
- [x] Dated waivers for emulator live E2E

**Verdict:** ☐ Not ready · ☑ Ready with waivers · ☐ Enterprise production-ready

## 2026-09-06 uplift note

- `flutter test`: **36/36 passed**
- Integration tests on Linux: **blocked** (Ninja/CXX missing)
- Device PNGs: **none invented** — pack `/opt/cursor/artifacts/mobile-flutter-audit/` documents tests-only evidence
- Score residual: device visual IT still required for 10/10 mobile claim
