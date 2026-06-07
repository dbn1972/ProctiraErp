# ProctiraERP Platform Helm Chart

Helm chart for deploying the ProctiraERP Unified Platform on Kubernetes.

## Prerequisites

- Kubernetes 1.25+
- Helm 3.10+
- NGINX Ingress Controller (for ingress)
- cert-manager (for TLS)
- metrics-server (for HPA)

## Installation

```bash
# Development
helm install proctira ./proctira-platform -f values-development.yaml -n proctira-dev --create-namespace

# Staging
helm install proctira ./proctira-platform -f values-staging.yaml -n proctira-staging --create-namespace

# Production
helm install proctira ./proctira-platform -f values-production.yaml -n proctira --create-namespace
```

## Upgrade

```bash
helm upgrade proctira ./proctira-platform -f values-production.yaml -n proctira
```

## Key Features

### Zero-Downtime Deployments (Req 20.5)
All services use a rolling update strategy with `maxUnavailable: 0` and
`maxSurge: 1`, ensuring at least the current number of pods remain available
during deployments.

### Horizontal Pod Autoscaling (Req 20.3)
Stateless API services (api-gateway, web, etl-worker) have HPA configured
to scale based on CPU and memory utilization. Scale-up is aggressive (60s
stabilization) while scale-down is conservative (300s stabilization) to
prevent flapping.

### Multi-Tenancy
The chart supports namespace-per-tenant isolation via the `multiTenancy`
values section. Tenant subdomains are resolved by the API Gateway and
routed through the shared ingress.

### Pod Disruption Budgets
Critical services have PDBs configured to ensure minimum availability
during voluntary disruptions (node drains, cluster upgrades).

## Configuration

See `values.yaml` for the full list of configurable parameters.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.domain` | Platform domain | `proctira.io` |
| `global.environment` | Environment name | `production` |
| `apiGateway.replicaCount` | API Gateway replicas | `2` |
| `apiGateway.autoscaling.enabled` | Enable HPA | `true` |
| `apiGateway.autoscaling.maxReplicas` | Max HPA replicas | `10` |
| `web.replicaCount` | Web frontend replicas | `2` |
| `ingress.enabled` | Enable ingress | `true` |
| `secrets.existingSecret` | Use pre-created secret | `""` |

## Secrets Management

For production deployments, use one of:
- [external-secrets-operator](https://external-secrets.io/) — syncs from AWS Secrets Manager, Vault, etc.
- [sealed-secrets](https://sealed-secrets.netlify.app/) — encrypted secrets in Git

Set `secrets.existingSecret` to the name of your pre-created Secret resource.
