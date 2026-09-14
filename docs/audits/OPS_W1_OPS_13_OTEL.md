# W1-OPS-13 — Application-level OpenTelemetry distributed tracing

**Finding:** No application-level OpenTelemetry distributed tracing. Severity
medium, disposition confirmed.

**Branch:** `cursor/aud-w1-ops-13-otel-56c3`  
**Date (UTC):** 2026-09-14  
**Skill gate:** enterprise-release-ops (Definition of Ship — ops honesty)

## Remediation

| Surface | Change |
| --- | --- |
| `@proctira/observability` | `initTracing` — Node tracer provider, W3C Trace Context + Baggage propagation, HTTP auto-instrumentation, OTLP/HTTP exporter when endpoint set; **fail-safe no-op** when unset |
| Fastify | `tracingPlugin` SERVER spans + `http.route`; registered by `observabilityPlugin` (so gateway, etl-worker, and standalone backends inherit hooks) |
| Entry points | `apps/api-gateway/src/server.ts`, `apps/etl-worker/src/server.ts` call `initTracing` before listen and `shutdownTracing` on SIGINT/SIGTERM |
| Env / compose | `.env.example` documents `OTEL_EXPORTER_OTLP_*`; root `docker-compose.yml` pass-through for gateway + etl-worker |
| Helm | `config.tracing` + ConfigMap keys; `OTEL_SERVICE_NAME` on api-gateway / etl-worker |
| Docs | `infra/observability/README.md`, `docs/PRODUCTION_READINESS.md` §6.4 |
| Readiness CLI | Honest messaging: endpoint set ≠ collector proven |
| Tests | `packages/shared/observability/src/tracing.test.ts` — registration, span hooks, W3C inject/extract, noop when unset |

### Enablement contract

| Condition | Behaviour |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` set | OTLP/HTTP export enabled (unless `TRACING_ENABLED=false`) |
| Endpoint unset (local/dev default) | No-op tracer provider; span APIs safe; **no network** |
| Collector down / misconfigured | Exporter fail-safe (SDK retry); process does not crash on export errors |

## Evidence (unit / smoke)

```bash
pnpm --filter @proctira/observability test
```

Expected: `tracing.test.ts` passes (noop mode, test exporter span creation, Fastify HTTP SERVER span, propagation).

## Tip SHA

```
1690786720da4ed3fb60f72ea0fbefbe8ad4067f
```

Remediation commit (OTLP wiring): `df78be9fc5789c7c8143b485360ca7ef9f16967b`.

## Proven vs not proven (honest)

| Claim | Status |
| --- | --- |
| Tracer provider bootstrap + registration hooks exist in-app | **Proven** (unit/smoke) |
| W3C context inject/extract | **Proven** (unit) |
| Fastify HTTP SERVER span creation | **Proven** (unit inject) |
| Fail-safe no-op when OTLP unset | **Proven** (unit) |
| Env/docs/Helm/compose wire `OTEL_EXPORTER_OTLP_*` | **Proven** (repo artifacts) |
| Live OTLP collector ingest in a production cluster | **Not proven** — this PR does not deploy or verify a collector |
| Next.js / Flutter client-side tracing | **Out of scope** |
| Tip CI green on merge commit / main follow-up | **Not claimed here** — verify after PR CI |

## Residual risks

- Global OTEL API allows one `register()` per process; tests use `trace.disable()` — production entrypoints register once at boot.
- `@opentelemetry/instrumentation-http` registration is process-global; duplicate `initTracing` calls are idempotent for the happy path.
- Standalone lab compose (`infrastructure/docker/docker-compose.services.yml`) inherits tracing via `observabilityPlugin` but does not add compose env pass-through in this change (canonical prod = in-process gateway).
- Operators must supply a real collector URL and scrape/UI pipeline; empty Helm `config.tracing.otlpEndpoint` keeps production pods on no-op until configured.
