# E2E gate matrix

**Env:** `E2E_BACKEND_READY=1` enables live gateway write/inventory suites. Ungated specs assert shells, redirects, and client validation only.

| Spec | Gate |
| ---- | ---- |
| `01-login-and-create-student.spec.ts` | E2E_BACKEND_READY |
| `02-attendance.spec.ts` | E2E_BACKEND_READY |
| `03-assessment-and-report-card.spec.ts` | E2E_BACKEND_READY |
| `04-transfer-and-workflow.spec.ts` | E2E_BACKEND_READY |
| `05-bulk-import.spec.ts` | E2E_BACKEND_READY |
| `06-language-and-rtl.spec.ts` | E2E_BACKEND_READY |
| `07-tenant-isolation.spec.ts` | E2E_BACKEND_READY |
| `08-public-tracking.spec.ts` | Always on (shell / client) |
| `09-error-boundary-recovery.spec.ts` | E2E_BACKEND_READY |
| `09-route-permission-coupling.spec.ts` | Mixed (ungated + gated describes) |
| `10-scholarships.spec.ts` | E2E_BACKEND_READY |
| `11-health.spec.ts` | E2E_BACKEND_READY |
| `12-workflows.spec.ts` | E2E_BACKEND_READY |
| `13-insights-system.spec.ts` | Mixed (ungated + gated describes) |
| `14-insights-system-inventory-smoke.spec.ts` | Always on (shell / client) |
| `14b-insights-write-validation-smoke.spec.ts` | Always on (shell / client) |
| `14c-insights-live-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `15-overview-people-inventory-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `15b-staff-write-validation-smoke.spec.ts` | Always on (shell / client) |
| `15c-staff-assignment-appraisal-validation-smoke.spec.ts` | Always on (shell / client) |
| `15d-student-write-validation-smoke.spec.ts` | Always on (shell / client) |
| `16-institutions-inventory-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `17-health-inventory-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `17b-health-counselling-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `17c-module-a11y-smoke.spec.ts` | E2E_BACKEND_READY |
| `18-workflows-inventory-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `19-examinations-inventory-smoke.spec.ts` | Always on (shell / client) |
| `19-services-write-validation-smoke.spec.ts` | Always on (shell / client) |
| `20-attendance-inventory-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `20-notifications-transport-inventory-smoke.spec.ts` | Always on (shell / client) |
| `20b-attendance-write-validation-smoke.spec.ts` | Always on (shell / client) |
| `20c-notifications-prefs-write-smoke.spec.ts` | E2E_BACKEND_READY |
| `21-assessments-inventory-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `21-campus-comms-hostel-library-inventory-smoke.spec.ts` | Always on (shell / client) |
| `21b-assessments-write-validation-smoke.spec.ts` | Always on (shell / client) |
| `21c-campus-comms-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `21d-campus-hostel-library-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `22-parent-portal-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `22-timetable-inventory-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `23-gradebook-inventory-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `23-master-schedule-inventory-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `24-visual-regression.spec.ts` | Always on (shell / client) |
| `25-platform-surfaces-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `26-lms-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `27-academics-setup-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `34-examinations-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `35-admin-console-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `36-audit-integrity-dsar-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `37-scholarship-decision-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `38-academic-calendar-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `39-fees-structures-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `40-portals-academic-visibility-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `41-admissions-crm-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `42-gradebook-workflow-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `43-curriculum-coverage-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `44-students-360-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `45-exam-ops-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `46-reports-bi-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `46-reports-real-exports-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `47-lms-depth-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `48-library-ops-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `49-hostel-ops-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `50-timetable-generation-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `51-attendance-ops-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `52-staff-hr-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `53-communication-circulars-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `54-transport-ops-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `5x-pipelines-write-smoke.spec.ts` | Mixed (ungated + gated describes) |
| `a11y-axe.spec.ts` | Mixed (ungated + gated describes) |
| `dark-mode-parity.spec.ts` | Mixed (ungated + gated describes) |
| `loading-skeleton-cls.spec.ts` | E2E_BACKEND_READY |
| `rtl-arabic.spec.ts` | E2E_BACKEND_READY |
| `touch-target-minimum.spec.ts` | Mixed (ungated + gated describes) |

## Notes

- Prefer HS256 cookies (`setupGatewayTenantSession` / `createSignedJwt`) for gated writes so gateway `jwtVerify` accepts without live IdP secrets.
- Tip CI Integration Tests run ungated by default; the dedicated E2E backend-ready job sets `E2E_BACKEND_READY`.
- New write smokes (e.g. `5x-pipelines-write-smoke`) must document both lanes.
