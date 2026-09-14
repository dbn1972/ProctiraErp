# Kubernetes Manifests — ProctiraERP Unified Platform

This directory contains Kubernetes manifests for deploying the ProctiraERP platform using Kustomize.

## Topology (W1-OPS-16)

**Canonical (production / staging / development overlays):** in-process API gateway —
edge apps + `api-gateway` + `etl-worker`. Domain logic mounts inside the gateway.

**Non-prod / lab:** standalone domain Deployments under
`components/split-domain-services`, wired by `overlays/lab-split` only.
See `docs/DEPLOYMENT_TOPOLOGY.md`.

## Structure

```
k8s/
├── base/                          # Canonical manifests (no split-domain Deployments)
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── ingress.yaml
│   ├── kustomization.yaml
│   ├── api-gateway/               # API Gateway (port 3000) — in-process domains
│   ├── web/                       # Web frontend (port 3001)
│   ├── registration-portal/       # Registration portal (port 3002)
│   ├── etl-worker/                # ETL worker (port 3010)
│   ├── public-website/            # Public website (port 3003)
│   ├── admin-console/             # Admin console (port 3004)
│   ├── developer-portal/          # Developer portal (port 3005)
│   └── institution|student|…/     # YAML kept for lab component (not in base resources)
├── components/
│   ├── image-tag/                 # Shared kustomize images: pin (W1-OPS-08)
│   └── split-domain-services/     # NON-PROD opt-in domain Deployments (W1-OPS-16)
├── overlays/
│   ├── development/               # Dev overrides (single replicas, no HPA)
│   ├── staging/                   # Staging overrides
│   ├── production/                # Production overrides (PDBs, network policies)
│   └── lab-split/                 # Lab: base + split-domain-services
```

## Image tags (W1-OPS-08)

Container images use the `proctira/<service>` naming prefix consistently.

| Layer | Tag policy |
| ----- | ---------- |
| `base/**/deployment.yaml` | `proctira/<svc>:sha-pending` — explicit non-runnable default (never the mutable `latest` tag) |
| `components/image-tag` | Single kustomize `images:` list; CD rewrites every `newTag` |
| `overlays/*` | Include the image-tag component so staging/production never fall back to an unpinned mutable tag |

Update the shared pin:

```bash
cd infrastructure/k8s/components/image-tag
kustomize edit set image proctira/api-gateway=proctira/api-gateway:sha-<gitsha>
```

Regression gate: `./tools/scripts/check-no-latest-image-tags.sh` (also invoked from `helm-template-check.sh`).
Topology gate: `./tools/scripts/check-topology-canonical.sh` (W1-OPS-16).

## Deployment

### Prerequisites

- Kubernetes 1.27+
- kubectl with kustomize support
- NGINX Ingress Controller
- cert-manager (for TLS)

### Deploy to an environment

```bash
# Development / staging / production — canonical in-process topology
kubectl apply -k overlays/development/
kubectl apply -k overlays/staging/
kubectl apply -k overlays/production/

# Lab only — split-domain services
kubectl apply -k overlays/lab-split/
```

## Service Architecture

All backend services are Fastify-based and expose:

- `/health` — Liveness probe (is the process alive?)
- `/ready` — Readiness probe (is the service ready to accept traffic?)

### Deployment Strategy

All services use **RollingUpdate** with:

- `maxUnavailable: 0` — No pods are removed before new ones are ready
- `maxSurge: 1` — One extra pod is created during rollout

This ensures zero-downtime deployments.

### Horizontal Pod Autoscaling

Stateless API services have HPA configured with:

- CPU target: 70% utilization
- Memory target: 80% utilization
- Scale-up: 2 pods per 60s (stabilization: 60s)
- Scale-down: 1 pod per 120s (stabilization: 300s)

### Namespace-per-Tenant (Optional)

For multi-tenant isolation, deploy separate namespaces per tenant:

```bash
# Create tenant namespace
kubectl create namespace proctira-tenant-abc

# Apply base manifests to tenant namespace
kubectl apply -k base/ -n proctira-tenant-abc
```

## Port Assignments

| Service             | Container Port | Description                                      |
| ------------------- | -------------- | ------------------------------------------------ |
| api-gateway         | 3000           | API Gateway (canonical — in-process domains)     |
| web                 | 3001           | Web frontend (Next.js)                           |
| registration-portal | 3002           | Public registration                              |
| public-website      | 3003           | Marketing site                                   |
| admin-console       | 3004           | Platform admin                                   |
| developer-portal    | 3005           | Developer portal                                 |
| etl-worker          | 3010           | ETL pipeline worker                              |
| institution…report  | 3020–3028      | **Lab only** split-domain services (W1-OPS-16)   |
