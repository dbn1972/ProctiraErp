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
