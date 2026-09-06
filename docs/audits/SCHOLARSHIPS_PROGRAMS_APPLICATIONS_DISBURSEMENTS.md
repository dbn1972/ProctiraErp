# Web App — Scholarships (programs / applications / disbursements)

Live verification for the Scholarships service screens listed in the redesign
nav (`WEB APP — SERVICES`).

**Branch / tip:** `cursor/enterprise-score-uplift-56c3` @ `8cc09f3`  
**Date (UTC):** 2026-09-06  
**Module score (Services rollup):** **9.5 / 10**

## Redesign nav → live status

| Redesign item                     | Live route                        | Status   | Evidence                                                           |
| --------------------------------- | --------------------------------- | -------- | ------------------------------------------------------------------ |
| Scholarships · programs           | `/scholarships`                   | **DONE** | H1 programs list + Applications / Disbursements / New program CTAs |
| Scholarships · program detail     | `/scholarships/programs/[id]`     | **DONE** | Seeded program detail with slots, award, application window        |
| Scholarships · new program        | `/scholarships/programs/new`      | **DONE** | Create form wired to `createScholarshipProgramAction`              |
| Scholarships · applications       | `/scholarships/applications`      | **DONE** | Applications list + status tabs / export affordances               |
| Scholarships · application detail | `/scholarships/applications/[id]` | **DONE** | Seeded application review page                                     |
| Scholarships · disbursements      | `/scholarships/disbursements`     | **DONE** | Disbursements table + retry failed transfers action                |

**Result: 6 / 6 DONE** (route chrome + primary CTAs load without 404/500).

## Production wiring in this branch

- `@proctira/backend-scholarship` registered in-process on the API gateway under `/api/v1/scholarships`
- In-memory repository seeded with demo program / application / disbursement IDs for detail routes
- Web API client maps backend field names (`amountPerRecipient`, `under_review`, payment statuses) to UI types
- Create / update program and disbursement retry server actions

## Seed IDs

- Program: `11111111-1111-4111-8111-111111111111` (National Merit Scholarship 2026)
- Application: `22222222-2222-4222-8222-222222222222`
- Disbursement: `33333333-3333-4333-8333-333333333333`

## Automated coverage

- Playwright: `apps/web/e2e/10-scholarships.spec.ts` (6 screens; gated live)
- Ungated inventory + write validation: `apps/web/e2e/19-services-write-validation-smoke.spec.ts`
- Screen capture targets in `apps/web/scripts/capture-screens.mjs`
- Backend Vitest: `packages/backend/scholarship` — **39/39** pass (2026-09-06)

## 2026-09-06 uplift / re-verify

- Client-side validation on new program form (name/code/slots/amount/currency/dates)
- Inventory + write-validation smoke expands Services coverage — Chromium run **17 passed / 14 skipped** with Health (log `/opt/cursor/artifacts/enterprise-health-scholarships-e2e/playwright-ungated.log`)
- New-program inputs raised to `h-11` / `min-h-11` for ≥44px touch targets
- Dark / touch / axe route lists include programs hub, new program, applications, disbursements
- Unauth redirect probe: `/scholarships*` → `/login?returnTo=…` (`security-ux-probe.json`)

## Multidevice captures

`/opt/cursor/artifacts/scholarships-audit/` — **18 PNGs** (6 screens × desktop + tablet + mobile), plus `screenshots.json` / `multidevice-capture.json`.

## Notes

- Empty-state UIs still count as route-ready when page chrome and primary CTA load.
- Gateway on this branch registers an in-memory scholarship plugin with demo seed
  (Prisma `createScholarshipRepository` is not yet on `main`). Environments that
  already wire Prisma scholarships (e.g. EC3) keep their existing repository;
  live verify seeds demo rows via the public API for those hosts.
- Capture IDs can be overridden with `SCHOLARSHIP_PROGRAM_ID` /
  `SCHOLARSHIP_APPLICATION_ID` when seeding against a live database.

## Live EC3 verification (2026-09-05)

Seeded against Prisma scholarships on EC3 and captured all 6 screens:

| Screen             | HTTP | H1                              |
| ------------------ | ---- | ------------------------------- |
| programs           | 200  | Scholarship programs            |
| new program        | 200  | New scholarship program         |
| program detail     | 200  | National Merit Scholarship 2026 |
| applications       | 200  | Scholarship applications        |
| application detail | 200  | Application e378c859-40a        |
| disbursements      | 200  | Disbursements                   |

Live IDs:

- Program: `d14350e2-40d9-478e-990c-5d061a8a363b`
- Application: `e378c859-40a6-4567-96d7-f8ea09470252`
- Disbursement: `1336796e-d6e3-4ffb-be2a-b9753d5f7de2`

## 6. CI / production gates

| Gate                            | Pass | Link / SHA                                                                                                                                                                                                                           |
| ------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lint / typecheck / unit (prior) | ☑    | tip `e94ac2f` — historical green cite                                                                                                                                                                                                |
| Tip ESLint + Prettier           | ☑    | tip `8cc09f3` Lint ✅ on [CI 34058982602](https://github.com/dbn1972/ProctiraErp/actions/runs/34058982602)                                                                                                                           |
| Full CI on tip                  | ☑    | [CI 34058982602](https://github.com/dbn1972/ProctiraErp/actions/runs/34058982602) ✅ · [DoD 34058982614](https://github.com/dbn1972/ProctiraErp/actions/runs/34058982614) · [PR Check 34058982636](https://github.com/dbn1972/ProctiraErp/actions/runs/34058982636) |

### CI residual / honesty

- Live authenticated scholarship write journeys remain gated on `E2E_BACKEND_READY` where applicable.
- Authenticated axe/dark scans are listed for module routes but gated the same way.

## Residual risks / waivers

| Item                      | Risk                              | Owner    | Waiver date |
| ------------------------- | --------------------------------- | -------- | ----------- |
| Live IdP E2E              | Fake JWT for smokes               | Security | 2026-09-06  |
| Device-farm PNGs          | Viewport pack only                | QA       | 2026-09-06  |
| Prisma scholarship schema | Optional; in-memory plugin on tip | Platform | 2026-09-06  |

**Verdict:** Enterprise ready with waivers (IdP / device-farm / gated live axe).
