# Peer-gap closure — ordered slices (honest)

**Updated (UTC):** 2026-09-07  
**Rule:** One slice at a time · product/IA → build → UX/a11y/security as needed → test → release → **main tip CI** · no invented screenshots or fake “10/10”.  
**Skills map:** `docs/plans/ENTERPRISE_SKILLS_MAP.md`

## Shipped (do not re-open as missing)

| Area                                                        | Evidence                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Parent portal v1                                            | **PR #25 merged** — Family portal, messages, consents, sandbox fees |
| Campus comms / notifications / transport / hostel / library | Campus WS0–WS6 on main                                              |
| SIS timetable / master schedule / gradebook / board packs   | On main (residuals remain — see queue)                              |
| #1 SIS gradebook harden                                     | **PR #27 merged**                                                   |
| #2 SIS master-schedule harden                               | **PR #28 merged**                                                   |

## Closure queue (one-by-one)

| #   | Slice                          | Why next                                                                      | Exit (fully Built w/ dated externals only)                                        | External waivers OK                      |
| --- | ------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | **SIS gradebook harden**       | Closable residuals: RBAC, cross-tenant deny, write audit, transcript PDF-lite | SEC+TEST audits ☑; tip CI; scoreboard residual text cleared for those items       | Live IdP, device-farm, sealed crypto PDF |
| 2   | **SIS master-schedule harden** | Cross-tenant + live write smoke + publish audit                               | Same pattern                                                                      | Live IdP                                 |
| 3   | **SIS timetable harden**       | Cross-tenant + attendance wire notes                                          | Same; calendar federation stays waived                                            | iCal federation                          |
| 4   | **Fees & finance v1**          | Peer gap still Thin                                                           | Fee plans + invoices + payments + receipts (sandbox PSP) + staff UI + parent link | Live PSP                                 |
| 5   | **Health PHI vault**           | Move non-counselling PHI off in-memory                                        | PG-backed screenings/profile + SEC audit                                          | Live IdP                                 |
| 6   | **HR leave (thin → v1)**       | Leave requests only (not full payroll)                                        | Leave CRUD + approve                                                              | Payroll deferred                         |
| 7   | **Admissions CRM depth**       | Beyond apply/track                                                            | Waitlist + interview slots (no OCR yet)                                           | Live apply/OCR                           |
| 8   | **Integrations live adapters** | Only when secrets exist                                                       | One live SMS or storage connector                                                 | —                                        |
| 9   | **LMS / LTI**                  | Large epic                                                                    | Separate plan                                                                     | —                                        |
| 10  | **Observability SLO pack**     | Probe-backed status                                                           | Real health probes on status page                                                 | —                                        |

## Active slice

**#3 SIS timetable harden** — branch `cursor/sis-timetable-harden-56c3`

| Prior               | Status                        |
| ------------------- | ----------------------------- |
| Parent portal v1    | **Merged** PR #25             |
| #1 Gradebook harden | **Merged** PR #27             |
| #2 Master-schedule  | **Merged** PR #28 @ `d7b57b1` |

## Honesty

- “Fully built” ≠ every peer feature forever; it means **documented residuals are either closed or dated external waivers**.
- Do not claim SSO/SCIM/device-farm/LMS complete without evidence.
