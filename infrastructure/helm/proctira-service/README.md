# ProctiraERP per-service Helm chart

#

# Used by `.github/workflows/deploy.yml`:

# helm upgrade --install "proctira-${SERVICE}" ./infrastructure/helm/proctira-service ...

#

# Deployment name is always `proctira-<service.name>` so kubectl rollout status

# matches deploy.yml expectations.

## Dry-run (CI)

```bash
helm template proctira-api-gateway ./infrastructure/helm/proctira-service \
  --set service.name=api-gateway \
  --set image.repository=ghcr.io/proctira/api-gateway \
  --set image.tag=sha-test \
  --set environment=staging \
  -f ./infrastructure/helm/proctira-service/values-staging.yaml
```

Platform umbrella chart: `../proctira-platform` (formerly openemis-platform path).

## Hardening + availability (G-724)

Every release renders a non-root, read-only-rootfs pod (`runAsUser: 1001`,
all capabilities dropped, `RuntimeDefault` seccomp, `/tmp` emptyDir), a
dedicated ServiceAccount with token automount off, and `PORT=<targetPort>`
injected so Fastify and Next standalone images listen on the probed port.
Probe paths come from `serviceProfiles[<service.name>].healthPath`
(`/api/health` for the Next.js apps, `/health` otherwise).

| Object                    | Values key                    | dev | staging | production |
| ------------------------- | ----------------------------- | --- | ------- | ---------- |
| HorizontalPodAutoscaler   | `autoscaling.enabled`         | off | off     | 3–12 pods  |
| PodDisruptionBudget       | `podDisruptionBudget.enabled` | off | on      | on         |
| NetworkPolicy (in+egress) | `networkPolicy.enabled`       | off | on      | on         |
| topologySpreadConstraints | `topologySpreadConstraints`   | —   | —       | zone+host  |
| ExternalSecret (ESO)      | `externalSecret.enabled`      | off | off     | opt-in     |

Enable ESO-managed secrets per cluster:

```bash
helm upgrade --install proctira-api-gateway ./infrastructure/helm/proctira-service \
  -f ./infrastructure/helm/proctira-service/values-production.yaml \
  --set service.name=api-gateway \
  --set externalSecret.enabled=true \
  --set externalSecret.secretStoreRef.name=<ClusterSecretStore>
```

The Deployment then mounts `proctira-api-gateway-env` via `envFrom`; the chart
never contains secret values. Pre-existing Secrets can be listed under
`envFromSecrets`. `./tools/scripts/helm-template-check.sh` (and
`.github/workflows/helm-template.yml`) assert these objects render for staging
and production on every chart change.
