# Public Website Runbook

## Overview

Marketing / landing pages and tenant-branded public site. Mostly static with edge caching.

| Field         | Value                                                                              |
| ------------- | ---------------------------------------------------------------------------------- |
| Service slug  | `public-website`                                                                   |
| Default port  | `3032`                                                                             |
| Owner team    | Frontend Engineering                                                               |
| Slack channel | #proctira-frontend                                                                 |
| On-call group | `public-website-oncall`                                                            |
| Source        | `packages/backend/../apps/public-website` (or `apps/public-website` if applicable) |

## Dependencies

Upstream services and infrastructure required for `public-website` to operate:

- CDN
- theme (branding)

If any of the above are unhealthy, expect cascading failures here. Check
their dashboards before declaring `public-website` itself the root cause.

## Service Level Objectives

| SLI            | SLO                        | Window  | Alert rule                            |
| -------------- | -------------------------- | ------- | ------------------------------------- |
| Availability   | 99.9% successful (non-5xx) | 30d     | `ServiceErrorRateHigh`, `ServiceDown` |
| Latency (P95)  | < 500 ms                   | 5m      | `ServiceP95LatencyHigh`               |
| Latency (P99)  | < 2 s                      | 5m      | `ServiceP99LatencyHigh`               |
| Error budget   | burn rate < 14.4x          | 1h / 5m | `ErrorBudgetBurnFast`                 |
| CPU saturation | < 85% of one core          | 5m      | `ProcessCPUHigh`                      |
| Memory         | < 90% of heap              | 5m      | `ProcessMemoryHigh`                   |

## Common Failure Modes

### 1. Elevated 5xx error rate

- **Symptom**: `ServiceErrorRateHigh` / `ServiceErrorRateCritical` firing.
- **Likely cause**: downstream dependency outage, recent deploy, or DB
  connection exhaustion.
- **Remediation**:
  1. Check the _Service Overview_ Grafana dashboard for the spike onset.
  2. Correlate with recent deploys (`git log --since=1h`).
  3. Inspect logs in Loki / pino with `service="public-website"`.
  4. If a recent deploy is implicated, follow **Rollback** below.

### 2. Latency regression

- **Symptom**: `ServiceP95LatencyHigh` firing while error rate is normal.
- **Likely cause**: slow dependency (DB, queue), saturated event loop,
  or noisy neighbour tenant.
- **Remediation**:
  1. Use the _Tenant Overview_ dashboard to identify a hot tenant.
  2. Check the _Dependencies_ dashboard for DB / queue latency.
  3. Consider scaling out additional replicas while you investigate.

### 3. Service down (scrape failing)

- **Symptom**: `ServiceDown` firing; `up{service="public-website"}` is 0.
- **Likely cause**: process crashed, network partition, or container OOM.
- **Remediation**:
  1. `kubectl get pods -l app=public-website` (or `docker compose ps`).
  2. Inspect the most recent crash log.
  3. If OOM, follow **Memory saturation** below.
  4. If hard-down, restart the deployment and capture a heap dump first
     when feasible.

### 4. Memory saturation / OOM

- **Symptom**: `ProcessMemoryHigh` then `ServiceDown`.
- **Likely cause**: leak after a recent change, oversized payloads, or
  unbounded cache growth.
- **Remediation**:
  1. Capture a heap snapshot (`kill -SIGUSR2 <pid>` for Node).
  2. Restart to recover; file a follow-up incident.
  3. Roll back if a recent deploy is implicated.

### 5. CPU / event-loop saturation

- **Symptom**: `ProcessCPUHigh` or `EventLoopLagHigh`.
- **Likely cause**: hot-loop in code, sync I/O, large synchronous JSON
  parse / serialize.
- **Remediation**:
  1. Capture a CPU profile (`node --prof` or `clinic flame`).
  2. Throttle the offending tenant via the api-gateway rate limit override.
  3. Scale horizontally while diagnosing.

## Rollback Procedure

1. Identify the last known good image tag from the deployment history
   (Argo CD / `kubectl rollout history deployment/public-website`).
2. `kubectl rollout undo deployment/public-website` (or pin the image tag in the
   compose file and `docker compose up -d public-website`).
3. Confirm `up{service="public-website"} == 1` and that error rate has dropped
   in Grafana.
4. Open a post-incident ticket in the `public-website` repo with the offending
   commit range.

## Escalation

| Step | Action                                              | Time-to-page |
| ---- | --------------------------------------------------- | ------------ |
| 1    | Primary on-call (`public-website-oncall` PagerDuty) | Immediately  |
| 2    | Secondary on-call                                   | +15 min      |
| 3    | Team lead, Frontend Engineering                     | +30 min      |
| 4    | Engineering manager + Incident Commander            | +60 min      |
| 5    | CTO bridge (P1 incidents only)                      | +90 min      |

Coordination happens in #proctira-frontend. Use `/incident declare`
in Slack to spin up a dedicated incident channel for P1/P2 events.

## References

- Dashboards
  - [Service Overview](https://grafana.proctira.org/d/proctira-service-overview)
  - [SLO Tracking](https://grafana.proctira.org/d/proctira-slo-tracking)
  - [Tenant Overview](https://grafana.proctira.org/d/proctira-tenant-overview)
  - [Dependencies](https://grafana.proctira.org/d/proctira-dependencies)
- Alert definitions: `infra/observability/alerts/`
- Source: `packages/backend/../apps/public-website/`
- Charter: Section 38 (SLO, SLI, Service Operations)
