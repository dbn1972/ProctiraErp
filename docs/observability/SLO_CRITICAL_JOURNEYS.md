# ProctiraERP — Critical journey SLOs (G-502)

**Date:** 2026-09-08  
**Scope:** Minimal SLO contract linking Prometheus alert rules under
`infra/observability/alerts/` to critical product journeys and runbooks.

## Journey SLOs

| Journey                      | SLI                                            | Target (30d) | Alert rules                           | Runbook                        |
| ---------------------------- | ---------------------------------------------- | ------------ | ------------------------------------- | ------------------------------ |
| Auth / login                 | Non-5xx rate on `auth` + `api-gateway`         | 99.9%        | `availability.yml` ServiceErrorRate\* | `docs/runbooks/auth.md`        |
| Parent portal messaging/fees | Non-5xx on `api-gateway` parent-portal routes  | 99.5%        | `availability.yml`, `latency.yml`     | `docs/runbooks/api-gateway.md` |
| Master schedule publish      | Non-5xx + P95 &lt; 2s on timetable write paths | 99.5% / P95  | `latency.yml`, `error_rate.yml`       | `docs/runbooks/institution.md` |
| Fees invoice / sandbox pay   | Non-5xx on fees + parent-portal fee pay        | 99.5%        | `availability.yml`, `error_rate.yml`  | `docs/runbooks/billing.md`     |
| Health counselling write     | Non-5xx on health module                       | 99.5%        | `availability.yml`                    | `docs/runbooks/health.md`      |
| Platform deploy / rollouts   | Deployment availability (`up` scrape)          | 99.9%        | `availability.yml` ServiceDown        | `docs/runbooks/api-gateway.md` |

## Alert → runbook wiring

Alert annotations already emit `runbook_url` pointing at
`https://runbooks.proctira.org/services/{{ $labels.service }}.md`. Local mirrors
live in `docs/runbooks/`. Keep both in sync when adding module journeys.

## Compose validation

```bash
docker compose -f infra/observability/docker-compose.observability.yml up -d
# Optional when promtool is installed:
promtool check rules infra/observability/alerts/*.yml
```

## Residual

- Per-route Prometheus label for `/api/v1/parent-portal/*` vs `/api/v1/fees/*`
  still coarse (service-level only).
- PagerDuty / Statuspage remain waived (G-506) until accounts exist.
