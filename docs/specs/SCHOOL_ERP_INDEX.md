# School ERP specs index (token-cheap)

Single entry point. **Do not duplicate** phase bodies here — link only.

## Locked architecture
- One Postgres, **schema per domain**, bare UUID across boundaries.
- Charter: service ownership; no cross-service SQL joins/FKs.

## Module scope inventory
- [SCHOOL_ERP_MODULE_SCOPE.md](../SCHOOL_ERP_MODULE_SCOPE.md) — P3–P16 FULL; P18–P26 MVP scaffolded.
- [CHARTER_EXPANSION_SECTION5.md](../plans/CHARTER_EXPANSION_SECTION5.md) — P18–P26 wave plan + non-goals.

## Phase contracts (source of truth)
| Phase | Spec / evidence |
|-------|-----------------|
| 2 Auth | [PHASE_2_AUTH_SIGNOFF.md](../PHASE_2_AUTH_SIGNOFF.md) |
| 3 Institution | [PHASE_3_INSTITUTION_SIGNOFF.md](../PHASE_3_INSTITUTION_SIGNOFF.md) |
| 4 Student | [PHASE_4_STUDENT_SIGNOFF.md](../PHASE_4_STUDENT_SIGNOFF.md) |
| 5 Attendance | [PHASE_5_ATTENDANCE_SIGNOFF.md](../PHASE_5_ATTENDANCE_SIGNOFF.md) |
| 6 Assessment | [PHASE_6_ASSESSMENT_SIGNOFF.md](../PHASE_6_ASSESSMENT_SIGNOFF.md) |
| 7 Examination | [PHASE_7_EXAMINATION_SIGNOFF.md](../PHASE_7_EXAMINATION_SIGNOFF.md) |
| 8 Staff | [PHASE_8_STAFF_SIGNOFF.md](../PHASE_8_STAFF_SIGNOFF.md) |
| 9 Scholarship | [PHASE_9_SCHOLARSHIP_SIGNOFF.md](../PHASE_9_SCHOLARSHIP_SIGNOFF.md) |
| 10 Transport | [PHASE_10_TRANSPORT_SIGNOFF.md](../PHASE_10_TRANSPORT_SIGNOFF.md) |
| 11 Health | [PHASE_11_HEALTH_SIGNOFF.md](../PHASE_11_HEALTH_SIGNOFF.md) |
| 12 Workflow | [PHASE_12_WORKFLOW_SIGNOFF.md](../PHASE_12_WORKFLOW_SIGNOFF.md) |
| 13 Notification | [PHASE_13_NOTIFICATION_SIGNOFF.md](../PHASE_13_NOTIFICATION_SIGNOFF.md) |
| 14 Report | [PHASE_14_REPORT_SIGNOFF.md](../PHASE_14_REPORT_SIGNOFF.md) |
| 15 Survey | [PHASE_15_SURVEY_SIGNOFF.md](../PHASE_15_SURVEY_SIGNOFF.md) |
| 16 Registration | [PHASE_16_REGISTRATION_SIGNOFF.md](../PHASE_16_REGISTRATION_SIGNOFF.md) |
| 17 Flutter | [PHASE_17_FLUTTER_SIGNOFF.md](../PHASE_17_FLUTTER_SIGNOFF.md) |
| 9–16 Prisma wiring | [PHASE_9_16_PRISMA_WIRING_SIGNOFF.md](../PHASE_9_16_PRISMA_WIRING_SIGNOFF.md) |
| 18 Finance / fees | [PHASE_18_FINANCE_SIGNOFF.md](../PHASE_18_FINANCE_SIGNOFF.md) |
| 19 Timetable | [PHASE_19_TIMETABLE_SIGNOFF.md](../PHASE_19_TIMETABLE_SIGNOFF.md) |
| 20 Library | [PHASE_20_LIBRARY_SIGNOFF.md](../PHASE_20_LIBRARY_SIGNOFF.md) |
| 21 Hostel | [PHASE_21_HOSTEL_SIGNOFF.md](../PHASE_21_HOSTEL_SIGNOFF.md) |
| 22 Inventory | [PHASE_22_INVENTORY_SIGNOFF.md](../PHASE_22_INVENTORY_SIGNOFF.md) |
| 23 Canteen / MDM | [PHASE_23_CANTEEN_SIGNOFF.md](../PHASE_23_CANTEEN_SIGNOFF.md) |
| 24 Payroll | [PHASE_24_PAYROLL_SIGNOFF.md](../PHASE_24_PAYROLL_SIGNOFF.md) |
| 25 Alumni | [PHASE_25_ALUMNI_SIGNOFF.md](../PHASE_25_ALUMNI_SIGNOFF.md) |
| 26 LMS | [PHASE_26_LMS_SIGNOFF.md](../PHASE_26_LMS_SIGNOFF.md) |

## Runbooks (ops detail on demand)
- [docs/runbooks/](../runbooks/)

## UI references
- [redesign/](../../redesign/) — prefer over inventing layouts.

## Validate scripts
- `tools/scripts/validate-phase2-auth-ec3.sh`
- `tools/scripts/validate-phase3-institution-ec3.sh`
- `tools/scripts/validate-phase4-5-student-attendance-ec3.sh`
- `tools/scripts/validate-phase6-assessment-ec3.sh`
- `tools/scripts/validate-phase7-examination-ec3.sh`
- `tools/scripts/validate-phase8-staff-ec3.sh`
- `tools/scripts/validate-phase9-scholarship-ec3.sh`
- `tools/scripts/validate-phase10-transport-ec3.sh`
- `tools/scripts/validate-phase11-health-ec3.sh`
- `tools/scripts/validate-phase12-workflow-ec3.sh`
- `tools/scripts/validate-phase13-notification-ec3.sh`
- `tools/scripts/validate-phase14-report-ec3.sh`
- `tools/scripts/validate-phase15-survey-ec3.sh`
- `tools/scripts/validate-phase16-registration-ec3.sh`

## Token policy for agents
1. Start from this index.
2. Open **one** phase sign-off or **one** runbook.
3. Skip re-reading completed phases unless the change crosses their boundary.
