# ProctiraErp architecture context

## Runtime shape

ProctiraErp is a pnpm/Turborepo education platform. Its primary backend runtime is currently a **Fastify modular monolith**: `apps/api-gateway/src/domain-plugins.ts` mounts domain packages in process under `/api/v1`. `apps/api-gateway/src/app.ts` composes logging, metrics, CORS, rate limiting, health, OpenAPI, Keycloak/JWT authentication, tenant resolution, Redis idempotency, domain plugins, and fallback service proxying. Do not infer a deployed microservice merely from a standalone launcher or Kubernetes manifest.

Primary clients:

- `apps/web`: Next.js plus a React feature-shell; inspect which routing surface is active before changing a screen.
- `apps/mobile`: Flutter client with tenant-scoped caching/offline features but incomplete module parity.
- `apps/registration-portal`: public admissions/registration experience.
- `apps/admin-console`, `developer-portal`, `install-wizard`, `public-website`: platform support apps at varying depth.
- `apps/etl-worker`: standalone ETL API/worker, currently in-memory for pipeline state.

## Domain map

Gateway-mounted school/ERP contexts include auth directory/invites, institution, student/enrollment, staff, attendance, assessment/report cards, examination, scholarship, transport, health, workflow, notification, report, survey, registration, finance/fees, timetable, library, hostel, inventory, canteen, payroll, alumni, and LMS.

Other packages include tenant, billing, plugin, audit, policy, theme, custom fields, dashboards, data warehouse, developer portal, install, and ETL. Package existence does not imply durable gateway-mounted production behavior.

## Data architecture

- Canonical schema: `packages/shared/database/prisma/schema.prisma`.
- PostgreSQL uses service-owned schemas and tenant IDs on domain rows.
- RLS migrations and `withTenantTransaction` are the intended tenant-safe access path.
- Cross-domain references are commonly bare UUIDs by charter; cross-schema foreign keys and SQL joins are deliberately avoided.
- Reports and recipient expansion compose repositories and join UUIDs in memory.
- Redis supports rate limits, idempotency, and caches; it is not the source of record.
- Kafka/RabbitMQ/SQS abstractions exist, but broad domain publisher/consumer and transactional outbox wiring is not yet proven.

Consequences:

1. Every cross-domain reference needs application validation and orphan/reconciliation handling.
2. Cross-domain workflows require sagas/events/read models rather than pretending to be one database transaction.
3. RLS safety depends on queries occurring in the tenant-scoped transaction connection.
4. Async job rows are not useful without durable workers, leases, retries, DLQs, and operational visibility.

## Identity and authorization

Authentication is Keycloak-first with a JWT fallback, MFA routes, tenant claim resolution, session/refresh controls, and identity projection. `packages/shared/auth` contains RBAC concepts, but a universal deny-by-default permission hook on all gateway mutations is not established. Verify authorization for each route/service. Frontend `requiredPermissions` is navigation metadata, not security enforcement.

One React feature-shell provider, `apps/web/src/providers/AuthProvider.tsx`, is explicitly a stub. Determine whether a task traverses that shell or the Next.js authentication path; do not assume the existence of backend auth makes every UI authenticated.

## Deployment and operations

Local Compose provisions PostgreSQL/PostGIS, Redis, Kafka, RabbitMQ, MinIO, Keycloak, gateway, ETL, and web apps. Observability assets include Prometheus, Alertmanager, and Grafana. Kubernetes/Kustomize and Helm assets describe a more distributed target topology.

Known deployment inconsistencies:

- `.github/workflows/deploy.yml` references `infrastructure/helm/proctira-service`, but the audited chart is `infrastructure/helm/openemis-platform`.
- ETL exposes `/health`, while deployment probes were found targeting `/health/live` and `/health/ready`.
- ETL pipeline persistence is in memory despite database/queue environment configuration.
- Checked-in DR documentation is not proof that scheduled backups or restore drills run.

## Current high-risk gaps

1. Stub or duplicate UI/auth paths and placeholder core workflows.
2. Coarse/inconsistently proven backend authorization.
3. Silent memory fallbacks and partial durable workers/events.
4. No transactional outbox and limited demonstrated async processing.
5. Thin P18–P26 operational domains, often CRUD/list rather than full lifecycle.
6. Missing guardian/household/custody, student progression/discipline, HR leave/recruitment, GL/budget, procurement/vendor/assets capabilities.
7. Partial privacy, DSAR/consent, audit persistence, retention execution, and data governance.
8. CD/chart/probe drift and unverified backup/restore/security supply-chain controls.

## Evidence hierarchy

Use this order when sources conflict:

1. Active runtime composition and production configuration.
2. Executable service/repository/client code and migrations.
3. Automated tests that exercise production adapters and behavior.
4. Deployment manifests and run evidence.
5. Architecture/status documents.
6. Marketing claims, comments, names, and TODO labels.

Key repository references:

- `apps/api-gateway/src/app.ts`
- `apps/api-gateway/src/domain-plugins.ts`
- `packages/shared/database/prisma/schema.prisma`
- `apps/web/src/featureRegistry.ts`
- `docs/SCHOOL_ERP_MODULE_SCOPE.md`
- `docs/PRODUCTION_READINESS.md`
- `docs/ENTERPRISE_SIS_ERP_GAP_ANALYSIS.md`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `docker-compose.yml`
