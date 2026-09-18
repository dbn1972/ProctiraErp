# ProctiraERP per-service Helm chart

Used by `.github/workflows/deploy.yml` as release `proctira-<service.name>`.
Domain packages mount in-process on the API gateway; standalone domain-service
charts are not the canonical production path.

## Dry-run (CI)

```bash
helm template proctira-api-gateway ./infrastructure/helm/proctira-service \
  --set service.name=api-gateway \
  --set image.repository=ghcr.io/proctira/api-gateway \
  --set image.tag=sha-test \
  --set environment=staging \
  -f ./infrastructure/helm/proctira-service/values-staging.yaml
```

Platform umbrella chart: `../proctira-platform` (formerly openemis-platform
path).

## Topology (W1-OPS-16)

`deploy.yml` installs canonical services via this chart (`api-gateway`, edge
apps, `etl-worker`). Domain packages mount **in-process** on the gateway. Split
service lab artifacts are documented in `docs/DEPLOYMENT_TOPOLOGY.md`.

## Atomic deploy + rollback (W1-OPS-09)

The supported ship mode is a single-wave RollingUpdate (`maxUnavailable: 0`)
with Helm `--atomic --wait`. See
[`docs/runbooks/deploy-rollback.md`](../../../docs/runbooks/deploy-rollback.md).
A failed release automatically rolls back. Manual rollback uses
`.github/workflows/rollback.yml`; its dry run defaults to true.

Optional canary annotations are controller hooks only and remain disabled by
default:

```bash
helm template proctira-api-gateway ./infrastructure/helm/proctira-service \
  --set progressiveDelivery.canary.enabled=true \
  --set progressiveDelivery.canary.weight=10 \
  --set service.name=api-gateway
```

## Authenticated metrics scraping (W1-SEC-07)

Production and staging use a direct pod scrape contract that matches the
Fastify plugin:

- application binding: `0.0.0.0:<service.targetPort>` (3000 by default);
- scrape annotation: `prometheus.io/path=/metrics` and the same target port;
- application authentication: `METRICS_BEARER_TOKEN` from Kubernetes Secret
  `proctira-metrics`, key `token`;
- scraper authentication: the same external-secret value is replicated into
  the `monitoring` namespace and mounted read-only in Prometheus at
  `/etc/prometheus/secrets/proctira-metrics/token`;
- network admission: only pods in namespace `monitoring` with label
  `app.kubernetes.io/name=prometheus` may reach the metrics port through the
  scrape-specific NetworkPolicy peer.

The checked-in Prometheus job uses that exact `credentials_file`. Secret values
must never be placed in Helm values, annotations, or Git. Configure the secret
in each workload namespace and the monitoring namespace before rollout. A
missing workload Secret prevents the pod from starting; a missing Prometheus
mount causes scrapes to fail rather than making metrics public.

`METRICS_PUBLIC=1` is a local/development escape hatch only. The application
rejects it at startup under `NODE_ENV=production`, and Helm refuses a production
manifest that sets it in `.Values.env`. Production rendering also fails when
the bearer Secret reference, NetworkPolicy, scraper selector, or fixed
`/metrics` path is absent.

The gateway ignores `X-Forwarded-For`, `Forwarded`, and similar headers by
default. Set `TRUSTED_PROXY_CIDRS` only to exact reverse-proxy socket peers that
must supply client IPs. Direct Prometheus pod scrapes do not need proxy trust;
they authenticate with the bearer token. Never configure blanket
`trustProxy=true`.

Token rotation is coordinated: update the external secret in workload and
monitoring namespaces, roll/reload Prometheus and workloads, then verify target
health. A short scrape gap is safer than falling back to public mode. Live
Secret replication, Prometheus volume mounts, pod labels, and successful target
health remain cluster-level deployment checks; repository rendering cannot
prove them.

## Hardening + availability (G-724)

Every release renders a non-root, read-only-rootfs pod (`runAsUser: 1001`, all
capabilities dropped, `RuntimeDefault` seccomp, `/tmp` emptyDir), a dedicated
ServiceAccount with token automount off, and `PORT=<targetPort>`. Probe paths
come from `serviceProfiles[<service.name>].healthPath` (`/api/health` for Next.js
apps, `/health` otherwise).

| Object                    | Values key                    | dev | staging | production |
| ------------------------- | ----------------------------- | --- | ------- | ---------- |
| HorizontalPodAutoscaler   | `autoscaling.enabled`         | off | off     | 3–12 pods  |
| PodDisruptionBudget       | `podDisruptionBudget.enabled` | off | on      | on         |
| NetworkPolicy (in+egress) | `networkPolicy.enabled`       | off | on      | on         |
| topologySpreadConstraints | `topologySpreadConstraints`   | —   | —       | zone+host  |
| ExternalSecret (ESO)      | `externalSecret.enabled`      | off | off     | opt-in     |

Enable ESO-managed application secrets per cluster:

```bash
helm upgrade --install proctira-api-gateway ./infrastructure/helm/proctira-service \
  -f ./infrastructure/helm/proctira-service/values-production.yaml \
  --set service.name=api-gateway \
  --set externalSecret.enabled=true \
  --set externalSecret.secretStoreRef.name=<ClusterSecretStore>
```

The Deployment mounts `proctira-api-gateway-env` via `envFrom`; the chart never
contains secret values. Pre-existing application Secrets can be listed under
`envFromSecrets`. The dedicated `proctira-metrics` Secret is referenced by key
so its value is never rendered. `./tools/scripts/helm-template-check.sh` and
`.github/workflows/helm-template.yml` assert these contracts without a cluster.
