# Volume 3

System Design Specification

Reference architecture, service domains, data boundaries, and runtime design for the multi-tenant product platform.

Version 1.0
Prepared: 23 April 2026
Status: Draft baseline specification

## Purpose

This document provides a formal specification for the product area named in the title. It is intended to be used by product, design, engineering, security, operations, legal, partner, and customer-facing teams as an implementation and governance baseline.

## Document structure

1. Executive architecture summary
1. Architecture principles and scope
1. Reference logical architecture
1. Tenant isolation and trust boundaries
1. Core service domains
1. Service-to-service communication model
1. Data architecture and persistence rules
1. Adapter-based infrastructure architecture
1. Queue and eventing architecture
1. Search, cache, and object storage design
1. Deployment topologies and regional model
1. Observability, reliability, and SLO design
1. Scalability and cost guardrails
1. System risks, trade-offs, and architecture decisions

# 1. Executive architecture summary

The platform is designed as a multi-tenant, service-oriented enterprise product that can run as managed SaaS, private cloud, or self-hosted software. The approved baseline architecture uses bounded services, adapter-based infrastructure integration, strong tenant scoping, API-first composition, and asynchronous coordination through a governed messaging layer.

- Shared control-plane with tenant-aware domain services and explicit trust boundaries.
- Logical isolation by tenant across storage, cache, search, queues, audit, and analytics surfaces.
- Stable internal interfaces for adapters including MySQL/PostgreSQL, S3-compatible storage, Redis, and SQS/Kafka/RabbitMQ.
- No cross-service SQL joins; cross-domain composition occurs through APIs, events, read models, or reporting stores.
- Installable runtime with bootstrap flows for CDN, database, object storage, cache, and queue adapter selection.

# 2. Architecture principles and scope

- Primary principles
- Tenant isolation is non-negotiable.
- Core domain logic must remain independent from provider SDKs through adapters.
- Every service owns its own data, migrations, APIs, and observability.
- Every critical action must be auditable and observable.
- Extension capability must be safe, permissioned, and reversible.
- In scope
- Reference logical architecture and service domains.
- Persistence, queue, cache, search, and object storage design.
- Deployment topology for SaaS and installable editions.
- Reliability, scalability, and cost guardrails.
- Out of scope
- Detailed UI wireframes and copywriting.
- Commercial pricing tables.
- Vendor procurement details or legal contract language.

# 3. Reference logical architecture

The approved logical architecture contains five layers: experience layer, control plane, domain services, infrastructure adapters, and operations/security plane.

# 4. Tenant isolation and trust boundaries

- Every request must resolve tenant context before business logic executes.
- Tenant context must propagate through synchronous APIs, async events, caches, search indexes, audit trails, and support tooling.
- Search, analytics, and reporting layers must trim by tenant and authorization scope.
- Support and break-glass access are separate trust boundaries with explicit approval, duration, and audit requirements.
- Plugin execution, theme publishing, and background processing are separate execution boundaries and must never gain implicit platform-wide access.

# 5. Core service domains

The service map may evolve, but the baseline service ownership model is fixed enough to prevent uncontrolled coupling.

# 6. Service-to-service communication model

- Synchronous composition must use internal APIs or RPC under approved contracts.
- Asynchronous work must use the platform queue abstraction, not direct provider-specific logic in domain services.
- Read-heavy cross-domain use cases should use BFF aggregation or denormalized read models.
- Materialized reporting stores are the approved path for cross-domain analytics.
- Correlation IDs, tenant IDs, actor IDs, and request lineage must be preserved across all hops.

# 7. Data architecture and persistence rules

- Each service owns its own tables and migration lifecycle.
- Tables must be prefixed by service name to make ownership explicit.
- No SQL statement may join another service's tables directly.
- Cross-service references should be by external identifier, not shared foreign key coupling.
- All timestamps are stored in UTC; all entity states are explicit; every persistent entity needs lifecycle and deletion rules.

# 8. Adapter-based infrastructure architecture

Infrastructure dependencies are treated as pluggable adapters behind stable internal contracts. The core product must not encode business logic around provider-specific failure modes unless explicitly documented.

- Each adapter must have a schema, health check, timeout, retry policy, observability hooks, and contract test suite.
- Adapter switches must be explicit, documented, and governed; silent provider behavior drift is not acceptable.
- Unsupported adapters must fail safely at validation time rather than at runtime under customer load.

# 9. Queue and eventing architecture

- The platform must support command/job processing and domain event publication as distinct messaging patterns.
- Queue/topic naming must include environment, service domain, and event or job type.
- Async processing must support retries, dead-letter paths, poison message handling, replay strategy, and idempotent consumers.
- Plugin interaction with async workflows must occur only through approved extension hooks or event contracts.
- Queue adapter selection must not change core service business semantics.

# 10. Search, cache, and object storage design

- Cache keys must include service and tenant context and must be invalidated by the owning service only.
- Object storage must separate originals, derived artifacts, and temporary processing assets; lifecycle rules must be explicit.
- Search indexes and reporting stores must be treated as derived stores, never the system of record.
- High-risk content processing should be isolated from the main request path and routed through async workers.

# 11. Deployment topologies and regional model

- Reference deployments must define ingress, service mesh or equivalent trust boundaries, data stores, queue, cache, and backup flows.
- Regional deployment choices must document what remains region-local versus globally coordinated.
- Disaster recovery topologies must define RPO/RTO assumptions by edition.

# 12. Observability, reliability, and SLO design

- Every critical service must publish logs, metrics, traces, health endpoints, and ownership metadata.
- Each critical service must define SLIs for availability, latency, error rate, saturation, and queue backlog where applicable.
- Runbooks must describe dependencies, common failure modes, rollback steps, and escalation paths.
- Customer-impacting event classes must be standardized: degraded service, partial outage, full outage, tenant-specific incident, dependency outage.

# 13. Scalability and cost guardrails

- No feature may materially increase storage, indexing, or message fan-out cost without review.
- Hot-tenant and noisy-neighbor controls must exist for request paths, queues, and background workers.
- Capacity planning must cover auth load, storage growth, queue throughput, background concurrency, and plugin runtime usage.
- Cross-region transfer and self-hosted support burden must be treated as architectural costs, not only finance concerns.

# 14. System risks, trade-offs, and architecture decisions

## Tables

### Table 1

| Layer                     | Purpose                        | Key components                                                                        |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| Experience layer          | Human and machine entry points | Public website, product UI, admin console, developer portal, APIs, CLI                |
| Control plane             | Policy-aware orchestration     | API gateway, auth, routing, tenant context, configuration, entitlement checks         |
| Domain services           | Product capabilities           | Tenant, identity, billing, audit, workflow, document/domain services, plugins, themes |
| Infrastructure adapters   | Provider abstraction           | DB, object storage, cache, queue, email, KMS, search, CDN adapters                    |
| Operations/security plane | Reliability and trust          | Monitoring, alerting, logs, traces, SIEM, backups, key rotation, incident workflows   |

### Table 2

| Service  | Primary responsibility                            | Owned examples                                               |
| -------- | ------------------------------------------------- | ------------------------------------------------------------ |
| identity | Authentication, sessions, MFA, service identities | identity_users, identity_sessions, identity_service_accounts |
| tenant   | Tenant lifecycle, org hierarchy, configuration    | tenant_tenants, tenant_org_units, tenant_settings            |
| billing  | Plans, subscriptions, entitlements                | billing_subscriptions, billing_entitlements                  |
| audit    | Immutable event recording and export              | audit_events, audit_exports                                  |
| policy   | Authorization and policy evaluation               | policy_policies, policy_bindings                             |
| plugin   | Plugin lifecycle and registry                     | plugin_plugins, plugin_installs, plugin_permissions          |
| theme    | Theme tokens, assets, publish history             | theme_themes, theme_revisions                                |
| queue    | Messaging abstraction and delivery control        | queue_messages, queue_consumers, queue_dead_letters          |
| install  | Bootstrap state and adapter validation            | install_bootstrap_runs, install_adapter_configs              |

### Table 3

| Adapter domain        | Baseline support                       | Default posture                                         |
| --------------------- | -------------------------------------- | ------------------------------------------------------- |
| Database              | MySQL, PostgreSQL                      | Choose at install time; contract-tested                 |
| Object storage        | S3 and S3-compatible                   | Tenant-aware object namespaces                          |
| Cache                 | Redis                                  | Central cache and selected async helper functions       |
| Queue                 | SQS, Kafka, RabbitMQ                   | Selected at install time through queue abstraction      |
| Search                | OpenSearch/Elasticsearch or equivalent | Optional per edition; provider hidden behind search API |
| CDN                   | Configurable CDN front door            | Required for public/static asset delivery               |
| Email / notifications | SMTP and provider adapters             | Non-core business logic behind notification interfaces  |
| Secrets / KMS         | Cloud KMS or secret manager adapters   | Security-sensitive runtime integration                  |

### Table 4

| Topology                   | Use case                                       | Key notes                                                            |
| -------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| Managed SaaS single region | Default standard customers                     | Shared platform services with strong logical isolation               |
| Managed SaaS multi-region  | Regional data residency and premium resilience | Region-bound data planes and coordinated control-plane               |
| Private cloud              | Customer-managed cloud account                 | Same service model with stricter operator boundary                   |
| Self-hosted                | Customer-controlled runtime                    | Install guide, compatibility matrix, and upgrade discipline required |

### Table 5

| Decision area      | Recommended default                              | Trade-off                                                          |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------ |
| Service boundaries | Strict per-domain ownership                      | More integration orchestration but less accidental coupling        |
| Adapter model      | Provider-neutral internal contracts              | Slightly more abstraction cost, far better portability             |
| Queue abstraction  | Supported adapters behind one internal interface | Need careful contract tests to avoid semantic drift                |
| Installability     | Bootstrap-driven with validation                 | Longer setup surface, much stronger operator experience            |
| Plugins            | Sandboxed extension model                        | Some limits on raw flexibility, better security and supportability |
