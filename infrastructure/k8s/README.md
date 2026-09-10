# Kubernetes Manifests — ProctiraERP Unified Platform

This directory contains Kubernetes manifests for deploying the ProctiraERP platform using Kustomize.

## Structure

```
k8s/
├── base/                          # Base manifests (shared across environments)
│   ├── namespace.yaml             # proctira namespace
│   ├── configmap.yaml             # Shared configuration
│   ├── ingress.yaml               # Ingress routing rules
│   ├── kustomization.yaml         # Kustomize base configuration
│   ├── api-gateway/               # API Gateway (port 3000)
│   ├── web/                       # Web frontend (port 3001)
│   ├── registration-portal/       # Registration portal (port 3002)
│   ├── etl-worker/                # ETL worker (port 3010)
│   ├── institution/               # Institution service (port 3020)
│   ├── student/                   # Student service (port 3021)
│   ├── staff/                     # Staff service (port 3022)
│   ├── assessment/                # Assessment service (port 3023)
│   ├── attendance/                # Attendance service (port 3024)
│   ├── examination/               # Examination service (port 3025)
│   ├── workflow/                   # Workflow service (port 3026)
│   ├── notification/              # Notification service (port 3027)
│   ├── report/                    # Report service (port 3028)
│   ├── public-website/            # Public website (port 3003)
│   ├── admin-console/             # Admin console (port 3004)
│   └── developer-portal/          # Developer portal (port 3005)
├── overlays/
│   ├── development/               # Dev overrides (single replicas, no HPA)
│   ├── staging/                   # Staging overrides
│   └── production/                # Production overrides (PDBs, network policies)
```

## Deployment

### Prerequisites

- Kubernetes 1.27+
- kubectl with kustomize support
- NGINX Ingress Controller
- cert-manager (for TLS)

### Deploy to an environment

```bash
# Development
kubectl apply -k overlays/development/

# Staging
kubectl apply -k overlays/staging/

# Production
kubectl apply -k overlays/production/
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

| Service             | Container Port | Description            |
| ------------------- | -------------- | ---------------------- |
| api-gateway         | 3000           | API Gateway / Router   |
| web                 | 3001           | Web frontend (Next.js) |
| registration-portal | 3002           | Public registration    |
| etl-worker          | 3010           | ETL pipeline worker    |
| institution         | 3020           | Institution management |
| student             | 3021           | Student lifecycle      |
| staff               | 3022           | Staff management       |
| assessment          | 3023           | Assessment & grading   |
| attendance          | 3024           | Attendance tracking    |
| examination         | 3025           | Examination management |
| workflow            | 3026           | Workflow engine        |
| notification        | 3027           | Notification service   |
| report              | 3028           | Report engine          |
