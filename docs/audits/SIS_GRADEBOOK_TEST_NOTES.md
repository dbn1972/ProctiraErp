# SIS Gradebook — test notes (WS3 + harden)

**Module:** Gradebook / transcripts  
**Branch:** `cursor/sis-gradebook-harden-56c3`  
**Date (UTC):** 2026-09-07  
**Artifacts:** `/opt/cursor/artifacts/sis-gradebook-audit/` · transcript PDF-lite under `SIS_TRANSCRIPT_DIR`

## Inventory

| Screen                | Route                          | Ungated smoke                              |
| --------------------- | ------------------------------ | ------------------------------------------ |
| Institution gradebook | `/institutions/[id]/gradebook` | `e2e/23-gradebook-inventory-smoke.spec.ts` |
| Student records       | `/students/records`            | same                                       |

## Unit / domain

- `pnpm --filter @proctira/backend-gradebook test` — GPA + service + **RBAC + cross-tenant + audit + pdf-lite**

## Harden evidence (this branch)

| Check                                                 | Status |
| ----------------------------------------------------- | ------ |
| Teacher can enter grades; cannot issue transcript     | ☑ unit |
| Registrar can issue transcript                        | ☑ unit |
| Cross-tenant list empty                               | ☑ unit |
| Audit on upsert + issue                               | ☑ unit |
| Transcript `artifactUri` → `transcript.pdf-lite.html` | ☑ unit |

## Residuals

- Authenticated Playwright E2E gated on `E2E_BACKEND_READY`
- Multidevice / device-farm
- Live IdP
- Crypto-sealed PDF (non-goal)
