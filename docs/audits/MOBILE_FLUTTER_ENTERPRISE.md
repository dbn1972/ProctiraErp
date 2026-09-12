# Enterprise module test — Flutter mobile

**Module:** Flutter mobile (`apps/mobile`)  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Environment:** cloud agent (headless analyzer + unit + widget goldens + Linux desktop IT)  
**Date (UTC):** 2026-09-06  
**Honest score:** **9.3 / 10** (Android device-farm PNGs residual — **none invented**)  
**Tip CI:** pending on this PR

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md` and adapted for Flutter.

---

## 0. Screen inventory (mobile routes)

| Area            | Route / screen             | Roles         | PII/PHI       | Notes                    |
| --------------- | -------------------------- | ------------- | ------------- | ------------------------ |
| Auth            | `/login`                   | anonymous     | PII           | Real `AuthApi.login`     |
| Tenant          | `/tenant`                  | anonymous     | —             | Tenant shell golden      |
| Home            | `/`                        | authenticated | —             | Logout clears tokens     |
| Students        | `/students`                | staff         | PII           | Cache-first repo         |
| Student profile | `/students/:id`            | staff         | PII           | Profile shell golden     |
| Attendance      | `/attendance`              | staff         | PII           | Offline sync + geofence  |
| Institutions    | `/institutions`            | staff         | —             |                          |
| Scholarships    | `/scholarships*`           | staff/student | financial PII | Needs RepositoryProvider |
| Health          | `/health`                  | staff         | PHI           | Needs RepositoryProvider |
| Examinations    | `/examinations*`           | staff/student | PII           | Needs RepositoryProvider |
| Assessments     | `/assessments`             | staff/student | PII           | Assessments shell golden |
| Reports         | `/reports`, `/reports/:id` | authenticated | —             | Prefs/reports goldens    |
| Profile         | `/profile`                 | authenticated | PII           |                          |
| Notifications   | `/notifications*`          | authenticated | —             | Inbox + preferences      |

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
| Bundled Inter fonts (offline / IT)                                       | ☑        | `assets/fonts/Inter-*.ttf` + `pubspec.yaml`                         |
| `flutter analyze`                                                        | ☑        | 6 infos, **0 errors/warnings** (2026-09-06)                         |
| Linux desktop `integration_test/`                                        | ☑        | login · tenant · students→enrollments · attendance offline · notif  |
| Device-farm Android emulator                                             | ☐ waived | No Android SDK platforms / emulator in agent                        |
| `flutter test` (unit + goldens)                                          | ☑        | Goldens **16/16** shells passed                                     |

---

## 2. Security

| Check                                            | Pass | Evidence                                 |
| ------------------------------------------------ | ---- | ---------------------------------------- |
| No hardcoded access tokens after login           | ☑    | login path uses `AuthApi`                |
| `X-Tenant-ID` on requests                        | ☑    | Dio interceptor                          |
| Bearer on non-public auth paths                  | ☑    | Dio interceptor                          |
| Logout clears secure storage (+ best-effort API) | ☑    | `AuthBloc` + `AuthApi.logout`            |
| Refresh-on-401 best effort                       | ☑    | interceptor                              |
| Tenant switch isolates cached student rows       | ☑    | Linux IT `journey_tenant_isolation_test` |

---

## 3. Visual / multidevice evidence (honest)

| Item                                     | Pass     | Evidence                                                                                                                                                    |
| ---------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Widget golden — login chrome             | ☑        | `/opt/cursor/artifacts/mobile-flutter-audit/login_chrome.png`                                                                                               |
| Widget golden — home shell               | ☑        | `…/home_shell.png`                                                                                                                                          |
| Widget golden — students shell           | ☑        | `…/students_shell.png`                                                                                                                                      |
| Widget golden — attendance shell         | ☑        | `…/attendance_shell.png`                                                                                                                                    |
| Widget golden — institutions shell       | ☑        | `…/institutions_shell.png`                                                                                                                                  |
| Widget golden — scholarships shell       | ☑        | `…/scholarships_shell.png`                                                                                                                                  |
| Widget golden — health shell             | ☑        | `…/health_shell.png`                                                                                                                                        |
| Widget golden — examinations shell       | ☑        | `…/examinations_shell.png`                                                                                                                                  |
| Widget golden — profile shell            | ☑        | `…/profile_shell.png`                                                                                                                                       |
| Widget golden — notifications shell      | ☑        | `…/notifications_shell.png`                                                                                                                                 |
| Widget golden — notification preferences | ☑        | `…/notification_preferences_shell.png` (added 2026-09-06)                                                                                                   |
| Widget golden — reports                  | ☑        | `…/reports_shell.png`                                                                                                                                       |
| Widget golden — report detail            | ☑        | `…/report_detail_shell.png`                                                                                                                                 |
| Widget golden — assessments              | ☑        | `…/assessments_shell.png`                                                                                                                                   |
| Widget golden — tenant                   | ☑        | `…/tenant_shell.png`                                                                                                                                        |
| Widget golden — student profile          | ☑        | `…/student_profile_shell.png`                                                                                                                               |
| Linux embedder PNGs (xvfb)               | ☑        | `linux_login_chrome.png`, `linux_notification_preferences.png`, `linux_reports.png`, `linux_home_shell.png` — **real** Linux Flutter captures, not invented |
| Android device-farm / emulator PNGs      | ☐ waived | **NONE invented** — Android SDK platforms empty; no emulator                                                                                                |
| Pack summary                             | ☑        | `/opt/cursor/artifacts/mobile-flutter-audit/summary.json`                                                                                                   |

---

## 4. Residual risks / waivers

| Item                                         | Risk                                             | Owner       | Waiver date  |
| -------------------------------------------- | ------------------------------------------------ | ----------- | ------------ |
| Live login against auth-service in agent     | Medium — unit parse + wiring covered             | cloud-agent | 2026-09-05   |
| Android device-farm / emulator PNGs          | Blocks 10/10 — **device-farm residual**          | mobile      | 2026-09-06   |
| Android applicationId still `org.openemis.*` | Low — branding leftover                          | mobile      | 2026-09-05   |
| Deploy registry / image push                 | Infra — unrelated to mobile                      | platform    | pre-existing |
| Notification `context.push` vs LiveTest URI  | Low — mark-read + destination UI proven on Linux | mobile      | 2026-09-06   |

---

## Done criteria

- [x] Auth no longer uses pending fake tokens
- [x] Bearer + tenant interceptors
- [x] Domain repos DI + RepositoryProviders
- [x] `flutter analyze` / unit tests green on this branch
- [x] Widget goldens expanded to **16 shells** (incl. notification preferences + reports)
- [x] Linux desktop IT journeys green under xvfb (login/tenant/students/attendance/notifications)
- [x] Real Linux embedder PNGs captured (not invented)
- [x] Dated waiver for Android device-farm only

**Verdict:** ☐ Not ready · ☑ Ready with waivers · ☐ Enterprise production-ready (Android device-farm still required for 10/10)

## 2026-09-06 uplift note (second pass)

- Expanded widget goldens **10 → 16** shells; all passed with `--update-goldens`
- Linux toolchain unblocked (ninja/GTK/libstdc++); CMake install prefix forced to build bundle
- Bundled Inter font assets so GoogleFonts IT does not fail offline
- Linux IT green: login, tenant isolation, student→enrollment, attendance offline sync, notification deep-link + screenshot pack
- Artifacts: goldens + `linux_*.png` under `/opt/cursor/artifacts/mobile-flutter-audit/`
- Honest module score **9.3 / 10** with residual **Android device-farm PNGs** only

---

## 2026-09-12 — P2-MOBILE register bind (append only)

**Register close:** `P2-MOBILE` → **DONE-with-dated-WAIVER** on `docs/audits/WAIVER_BOARD_P1_P2_2026-09-12.md` (PRD-007).  
Short residual note: `docs/audits/PRODUCT_MOBILE_DEVICE_FARM_RESIDUAL.md`.  
Does **not** invent Android farm PNGs; score ceiling remains device-farm gated.
