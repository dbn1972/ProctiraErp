# Product / ops — Observability SLO pack (peer-gap #10)

**Updated (UTC):** 2026-09-07  
**Branch:** `cursor/observability-slo-pack-56c3`  
**Exit:** Real health probes on the public status page (not an invented all-green board).

## What shipped

| Item                       | Evidence                                                                    |
| -------------------------- | --------------------------------------------------------------------------- |
| Probe helpers + unit tests | `apps/public-website/src/lib/status-probes.ts` (+ `.test.ts`)               |
| `/status` uses env probes  | `STATUS_PROBE_WEB_URL` / `_API_` / `_AUTH_`                                 |
| Compose defaults           | `docker-compose.yml` → web `/api/health`, gateway `/health`, `/health/live` |
| Env documentation          | `.env.example` (blank = honest prelaunch outside compose)                   |
| E2E honesty                | Smoke keeps prelaunch unless `STATUS_E2E_EXPECT_PROBED=1`                   |

## Honest residuals / waivers

| Item                                                             | Status                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| External Statuspage / Instatus incident feed                     | Waived — page still says “Incident feed not connected” |
| SMS / DBT / Reports rows                                         | Remain **Not monitored** (no probe URLs)               |
| Grafana / Prometheus burn-rate SLOs under `infra/observability/` | Separate stack; not this slice’s exit                  |
| Live multi-region probes                                         | External                                               |

## How to verify

1. Unset `STATUS_PROBE_*` → `/status` shows `data-mode=prelaunch`.
2. `docker compose up` public-website (with web + api-gateway) → probes hit in-network health endpoints → `data-mode=probed`.
3. `pnpm --filter @proctira/public-website test` — status-probes unit tests.
