# Peer-gap closure — ordered slices (honest)

**Updated (UTC):** 2026-09-07  
**Rule:** One slice at a time · product/IA → build → UX/a11y/security as needed · test · release · **main tip CI** · no invented screenshots or fake “10/10”.  
**Skills map:** `docs/plans/ENTERPRISE_SKILLS_MAP.md`

## Shipped (do not re-open as missing)

| Area                                                        | Evidence                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Parent portal v1                                            | **PR #25 merged** — Family portal, messages, consents, sandbox fees |
| Campus comms / notifications / transport / hostel / library | Campus WS0–WS6 on main                                              |
| SIS timetable / master schedule / gradebook / board packs   | On main                                                             |
| #1 SIS gradebook harden                                     | **PR #27 merged**                                                   |
| #2 SIS master-schedule harden                               | **PR #28 merged**                                                   |
| #3 SIS timetable harden                                     | **PR #29 merged**                                                   |
| #4 Fees & finance v1                                        | **PR #30 merged** — plans, invoices, receipts, staff + parent UI    |
| #5 Health PHI vault                                         | **PR #31 merged**                                                   |
| #6 HR leave v1                                              | **PR #32 merged**                                                   |
| #7 Admissions CRM depth                                     | **PR #33 merged**                                                   |
| #8 Integrations live storage                                | **PR #36 merged** — `GET /api/v1/storage/health` (MinIO/S3)         |
| #9 LMS / LTI (plan only)                                    | **PR #34 merged** — `docs/plans/LMS_LTI_EPIC.md`                    |
| #10 Observability SLO pack                                  | **PR #35 merged** — probe-backed `/status`                          |

## Closure queue (reference — all slices closed)

| #   | Slice                          | Exit                                                                                      | External waivers OK                      |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | **SIS gradebook harden**       | SEC+TEST audits ☑                                                                         | Live IdP, device-farm, sealed crypto PDF |
| 2   | **SIS master-schedule harden** | Cross-tenant + publish audit                                                              | Live IdP                                 |
| 3   | **SIS timetable harden**       | Cross-tenant + attendance wire notes                                                      | iCal federation                          |
| 4   | **Fees & finance v1**          | Fee plans + invoices + payments + receipts (sandbox PSP) + staff UI + parent link         | Live PSP                                 |
| 5   | **Health PHI vault**           | PG-backed screenings/profile + SEC audit                                                  | Live IdP                                 |
| 6   | **HR leave (thin → v1)**       | Leave CRUD + approve                                                                      | Payroll deferred                         |
| 7   | **Admissions CRM depth**       | Waitlist + interview slots (no OCR yet)                                                   | Live apply/OCR                           |
| 8   | **Integrations live adapters** | One live storage connector (`/api/v1/storage/health`); SMS remains sandbox without Twilio | Live Twilio/SMS                          |
| 9   | **LMS / LTI**                  | Separate plan doc only                                                                    | Live LMS sandbox                         |
| 10  | **Observability SLO pack**     | Real health probes on status page                                                         | External Statuspage                      |

## Active slice

**None** — peer-gap closure queue slices **#1–#10** are closed on `main` (with dated external waivers only where listed).

## Honesty

- “Fully built” ≠ every peer feature forever; it means **documented residuals are either closed or dated external waivers**.
- Do not claim SSO/SCIM/device-farm/LMS product complete without evidence.
- Live Twilio/SMS, live PSP, live LMS vendor sandboxes, and external Statuspage remain waived until secrets/providers exist.
