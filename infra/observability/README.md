# ProctiraERP Observability Stack

Self-contained Prometheus, Alertmanager, and Grafana configuration for the
ProctiraERP Unified Platform. Backed by the metrics that every service exports
through `@proctira/observability` (`GET /metrics`).

## What's in here

```
infra/observability/
├── prometheus.yml                    # Scrape config + rule_files + alerting
├── alerts/
│   ├── availability.yml              # 5xx rate, ServiceDown
│   ├── latency.yml                   # P95 / P99 alerts
│   ├── error_rate.yml                # Multi-window multi-burn-rate budget
│   ├── queue_lag.yml                 # Async queue lag
│   └── critical_journeys.yml         # Journey burn (auth / parent portal)
├── alertmanager.yml.tpl              # Routing tree template (PagerDuty / Slack / Email)
├── render-alertmanager.sh            # envsubst renderer → alertmanager.yml (git-ignored)
├── grafana/
│   ├── provisioning/
│   │   ├── datasources.yml
│   │   └── dashboards.yml
│   └── dashboards/
│       ├── service-overview.json
│       ├── slo-tracking.json
│       ├── tenant-overview.json
│       └── dependencies.json
├── docker-compose.observability.yml  # Brings the whole stack up
└── README.md                         # This file
```

## Running locally

```bash
docker compose -f infra/observability/docker-compose.observability.yml up -d
```

Open:

- Prometheus → http://localhost:9090
- Alertmanager → http://localhost:9093
- Grafana → http://localhost:3050 (admin / admin)

The compose stack joins the `proctira` Docker network used by the main
`docker-compose.yml` / `infrastructure/docker/docker-compose.services.yml` so
that Prometheus can reach `api-gateway:3000`, `etl-worker:3010` and the
standalone `*-service:302x` containers. Override with environment variables
when running standalone:

```bash
OBSERVABILITY_NETWORK=mynet \
OBSERVABILITY_NETWORK_EXTERNAL=true \
docker compose -f infra/observability/docker-compose.observability.yml up
```

## What is (and is not) collected — honest scope (G-725)

| Signal  | Status              | Where                                                                                                                                                                                                                |
| ------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metrics | Live                | `@proctira/observability` → `/metrics` on api-gateway, etl-worker and the 9 standalone backend services; Prometheus scrapes only those targets                                                                       |
| Logs    | Live                | Pino JSON to stdout (`@proctira/logging`), request-id correlated; ship with your platform's log agent                                                                                                                |
| Alerts  | Live                | `alerts/*.yml` → Alertmanager; receivers rendered from env (below)                                                                                                                                                   |
| Traces  | **Not implemented** | No OpenTelemetry SDK/exporter is wired. `x-request-id` is propagated gateway → domain plugins for log correlation only. Tracked as a follow-up in the gap audit; do not set expectations of span data in dashboards. |

Next.js apps (web, portals, admin console) expose `/api/health` but no
`/metrics`; they are observed through the gateway's `http_*` series and
availability probes. Any scrape job pointing at them would be permanently down,
so none exists.

## Alertmanager receivers from the environment

`alertmanager.yml` is **generated**, never committed. `render-alertmanager.sh`
substitutes these variables into `alertmanager.yml.tpl`:

| Variable                     | Required | Effect when unset                                    |
| ---------------------------- | -------- | ---------------------------------------------------- |
| `ALERT_EMAIL_TO`             | yes      | renderer exits 1                                     |
| `ALERT_SMTP_FROM`            | no       | `alertmanager@localhost`                             |
| `ALERT_SMTP_SMARTHOST`       | no       | `localhost:25`                                       |
| `PAGERDUTY_INTEGRATION_KEY`  | no       | `severity=critical` routes to email (warning logged) |
| `SLACK_WEBHOOK_URL`          | no       | `severity=warning` routes to email                   |
| `SLACK_SECURITY_WEBHOOK_URL` | no       | `team=security` routes to email                      |

The compose stack runs the renderer in the `alertmanager-config` init container;
in Kubernetes run the same script in an init container writing to an emptyDir
that Alertmanager mounts as `/etc/alertmanager`.

```bash
ALERT_EMAIL_TO=ops@example.org PAGERDUTY_INTEGRATION_KEY=... \
  sh infra/observability/render-alertmanager.sh
```

## Validating configs

`observability-config.yml` runs these on every change to this directory:

```bash
promtool check config infra/observability/prometheus.yml
promtool check rules infra/observability/alerts/*.yml
ALERT_EMAIL_TO=ci@example.org sh infra/observability/render-alertmanager.sh \
  infra/observability/alertmanager.yml.tpl /tmp/alertmanager.yml
amtool check-config /tmp/alertmanager.yml
```

## Defining new SLIs

1. Add a metric in `@proctira/observability` (Counter / Histogram / Gauge).
2. Emit it from the relevant service.
3. Add a scrape job in `prometheus.yml` if the service is new.
4. Add an alert rule under `alerts/` and reference a runbook URL.
5. Add a panel to the appropriate Grafana dashboard JSON.

## Runbooks

Per-service runbooks live in `docs/runbooks/`. Each alert rule's
`runbook_url` annotation points at one of these documents.

Critical journey SLO table: `docs/observability/SLO_CRITICAL_JOURNEYS.md` (G-502).
