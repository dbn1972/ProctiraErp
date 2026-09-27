# Enterprise mobile Flutter checklist

**Slice:** Parent portal linked children (home, messages, consents, fees)  
**Branch / tip:** `cursor/mobile-parent-children-570e`  
**Date (UTC):** 2026-09-27  
**Paired web audit (if any):** web parent home already lists children via `GET /parent-portal/children`

Copy of `docs/audits/templates/ENTERPRISE_MOBILE_FLUTTER_CHECKLIST.md`.

---

## 1. Surfaces

| Route / shell | Staff / parent | Notes |
| ------------- | -------------- | ----- |
| `/parent` | Parent | Lists linked children (name, class), selected-child state |
| `/parent/messages` | Parent | Threads for `studentId` query |
| `/parent/consents` | Parent | Consents for `studentId` query |
| `/parent/fees` | Parent | Invoices for `studentId` query |
| `/` HomeScreen | Staff | Unchanged |

## 2. Pillars

| Check                                     | Pass | Evidence |
| ----------------------------------------- | ---- | -------- |
| Auth login + Bearer + tenant header       | ☐    | Client methods take no tenant id. Session Dio interceptor still attaches Bearer and `X-Tenant-ID` from the signed-in tenant, same as other mobile APIs. |
| DI / repos registered for touched domains | ☑    | `ParentPortalRepository` in `injector.dart` and `OpenEmisApp` |
| `flutter analyze` clean                   | ☑    | `flutter analyze` in `apps/mobile` on Flutter 3.47.5 / Dart 3.13.4: no issues |
| Unit / golden tests for changed shells    | ☑    | `flutter test` 81 passed (repository, home loading/empty/list/error, existing goldens unchanged) |
| Integration journey or dated waiver       | ☐    | Waiver 2026-09-27: no device/emulator integration in this cloud VM. |
| Parent mode does not break staff shells   | ☑    | `/` still builds `HomeScreen`. Attendance files not edited. |
| Device-farm / real-device PNGs or waiver  | ☐    | Waiver 2026-09-27: Linux VM only. Not a device-farm claim. |
| No hardcoded tokens                       | ☑    | No tokens added |

## 3. Residuals / waivers

| Item | Owner | Risk |
| ---- | ----- | ---- |
| Device-farm PNGs | Mobile | Linux widget tests are not Android/iOS captures |
| Decide-consent and pay-invoice actions | Mobile | List endpoints are wired. Write actions are out of this slice; APIs exist |
| Name/class when student or timetable reads fail | Mobile | UI shows "Name unavailable" / "Class unavailable" |
| Scholarship document upload | Mobile | Left disabled. No upload API |

## 4. Sign-off

**Native claim:** ☑ Not ready

This slice is a thin parent client plus widget coverage. It is not mobile-ready and not device-farm certified.
