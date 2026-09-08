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
├── alertmanager.yml                  # Routing tree (PagerDuty / Slack / Email)
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
`docker-compose.yml` so that Prometheus can reach `auth:3001`, `student:3003`,
etc. Override with environment variables when running standalone:

```bash
OBSERVABILITY_NETWORK=mynet \
OBSERVABILITY_NETWORK_EXTERNAL=true \
docker compose -f infra/observability/docker-compose.observability.yml up
```

## Validating configs

If you have the Prometheus tooling installed locally:

```bash
promtool check config infra/observability/prometheus.yml
promtool check rules infra/observability/alerts/*.yml
amtool check-config infra/observability/alertmanager.yml
```

Otherwise, the compose stack will refuse to start if any file is invalid.

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
