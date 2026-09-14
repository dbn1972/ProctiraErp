# Security — W1-SEC-11 COMPLETE (tenant namespaces)

**Module / slice:** `@proctira/cache` · `@proctira/events` · `@proctira/queue-abstraction` · `@proctira/storage`  
**Branch / tip:** `cursor/w1-sec-11-namespaces-complete-56c3` @ `f668725fa85dbf0182401deafd840d9b75edf5dc`
**Date (UTC):** 2026-09-14  
**Prior status:** PARTIAL (`docs/audits/SEC_W1_SEC_11_TENANT_NAMESPACES.md` / `#217`) — builders + CacheClient/storage raw-key gates landed; queue **subscribe/consume** still accepted caller-supplied unscoped topics  
**Data classes:** shared infrastructure (PII / financial / PHI when domain payloads ride these buses)  
**Paired tests:**  
- cache — `packages/shared/cache/src/__tests__/tenant-scope.test.ts`  
- events — `packages/shared/events/src/__tests__/tenant-scope.test.ts`  
- queue — `packages/shared/queue-abstraction/src/__tests__/tenant-scope.test.ts` · `types.test.ts`  
- storage — `packages/shared/storage/src/__tests__/tenant-namespace.test.ts`

---

## 0. Inventory

| Surface | AuthN | AuthZ | Data class | Notes |
| ------- | ----- | ----- | ---------- | ----- |
| Cache key builders + `CacheClient` | N/A | tenant key scope | cached domain | `t:` / `cfg:` / `lst:` / `tenant:` — builders always fail closed; client fail-closed in prod |
| Kafka topic / RabbitMQ queue+RK builders (`@proctira/events`) | N/A | tenant prefix | events/tasks | `tenant.{id}.{name}` via `buildTenantPrefixedName` |
| Queue abstraction publish + **subscribe/consume** | N/A | tenant prefix | jobs/events | `buildTenantName` + `assertTenantScopedSubscribeTopic` on all adapters |
| Object storage keys | N/A | `tenants/{id}/` | files | shared bucket, key namespace; raw ops fail-closed in prod |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Cache builders reject missing tenant | ☑ | `tenant-scope.test.ts` (cache) |
| CacheClient rejects unscoped keys in prod | ☑ | `shouldRequireTenantScopedCacheKeys` + client assert |
| Events builders reject missing tenant + unscoped names | ☑ | `tenant-scope.test.ts` (events) |
| Queue `buildTenantName` rejects empty tenant / unscoped | ☑ | `types.test.ts` |
| Queue **subscribe/consume** rejects unscoped topics | ☑ | Kafka / RabbitMQ / SQS / memory adapters + `tenant-scope.test.ts` |
| Storage builders reject missing tenant | ☑ | `tenant-namespace.test.ts` |
| Storage raw download/delete/list/signed URL fail closed in prod | ☑ | `assertTenantScopedObjectKeyIfRequired` |
| Missing/unscoped fails closed in prod (all four channels) | ☑ | prod defaults + reject-path tests; hatch documented |
| No secrets in git | ☑ | `ALLOW_UNSCOPED_TENANT_NAMESPACES` escape hatch only |

---

## 2. Findings

### Closed this slice (PARTIAL → COMPLETE)

| ID | Was | Fix |
| --- | --- | --- |
| W1-SEC-11 residual | Subscribe/consume accepted caller topic strings without asserting `tenant.{id}…` shape | `assertTenantScopedSubscribeTopic` on kafka / rabbitmq / sqs / in-memory adapters |
| W1-SEC-11 residual | COMPLETE evidence pack missing | This document + tip SHA |

### Residuals (honest, non-blocking)

| ID | Sev | Finding | Fix / waiver |
| --- | --- | ------- | ------------ |
| residual | P2 | Object storage uses a **shared bucket** with key-level `tenants/{id}/` isolation (not per-tenant buckets) | Ops hardening: optional per-tenant buckets / IAM |
| residual | P2 | `ALLOW_UNSCOPED_TENANT_NAMESPACES=1` disables fail-closed for cache keys, storage raw-key ops, and queue subscribe asserts | Emergency only; must never be set in normal production |
| residual | P2 | CDN static (non-tenant) asset URLs remain intentionally unscoped | Out of scope; branding paths separate |
| residual | P2 | Search-index / report helpers outside these four packages | Out of scope for W1-SEC-11 |

---

## 3. Sign-off

| Claim | Status |
| ----- | ------ |
| PARTIAL → COMPLETE | ☑ |
| Shared helpers enforce key/topic/prefix construction (not convention-only) | ☑ |
| Missing/unscoped tenant fails closed in prod | ☑ |
| Reject-path tests for cache / queue / storage / events | ☑ |
| Safe to merge from security view | ☑ with residuals documented |

**Residual risks:** Shared-bucket storage IAM and emergency namespace hatch remain ops concerns. Platform workers may subscribe to `tenant.#` or `tenant.*.…` (still under the `tenant.` namespace); bare `#` / unscoped names are rejected.
