# Security — tenant namespaces for cache / queue / storage / events (W1-SEC-11)

**Module / slice:** `@proctira/cache` · `@proctira/events` · `@proctira/queue-abstraction` · `@proctira/storage`  
**Branch / tip:** `cursor/aud-w1-sec-11-tenant-namespaces-56c3`  
**Date (UTC):** 2026-09-14  
**Data classes:** shared infrastructure (PII / financial / PHI when domain payloads ride these buses)  
**Paired test audit:** unit — `tenant-scope.test.ts` (cache, events), queue `types.test.ts`, storage `tenant-namespace.test.ts`

---

## 0. Inventory

| Surface | AuthN | AuthZ | Data class | Notes |
| ------- | ----- | ----- | ---------- | ----- |
| Cache key builders + `CacheClient` | N/A | tenant key scope | cached domain | `t:` / `cfg:` / `lst:` / `tenant:` |
| Kafka topic / RabbitMQ queue+RK builders | N/A | tenant prefix | events/tasks | `tenant.{id}.{name}` |
| Queue abstraction `buildTenantName` | N/A | tenant prefix | jobs/events | shared adapters |
| Object storage keys | N/A | `tenants/{id}/` | files | shared bucket, key namespace |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Cache builders reject missing tenant | ☑ | `packages/shared/cache/src/__tests__/tenant-scope.test.ts` |
| CacheClient rejects unscoped keys in prod / when required | ☑ | same · `shouldRequireTenantScopedCacheKeys` |
| Events builders reject missing tenant + unscoped names | ☑ | `packages/shared/events/src/__tests__/tenant-scope.test.ts` |
| Queue `buildTenantName` rejects empty tenant / unscoped | ☑ | `packages/shared/queue-abstraction/src/__tests__/types.test.ts` |
| Storage builders reject missing tenant | ☑ | `tenant-namespace.test.ts` |
| Storage raw download/delete/list/signed URL fail closed in prod on unscoped keys | ☑ | `assertTenantScopedObjectKeyIfRequired` + tests |
| No secrets in git | ☑ | escape hatch documented only |

---

## 2. Findings

### P0

| ID | Finding | Fix |
| --- | ------- | --- |
| W1-SEC-11 | Tenant isolation for cache, queue, storage, and event namespaces was partly convention-based (helpers accepted empty tenant / unscoped names) | Fail-closed builders + production gates; tests reject unscoped names |

### P1 / P2

| ID | Sev | Finding | Fix / waiver |
| --- | --- | ------- | ------------ |
| | | | |

---

## 3. Sign-off

| Claim | Status |
| ----- | ------ |
| P0 cleared | ☑ |
| P1 cleared or waived | ☑ (none) |
| Safe to merge from security view | ☑ |

**Residual risks:**

- Object storage uses a **shared bucket** with key-level `tenants/{id}/` isolation (not per-tenant buckets). Bucket-level IAM separation remains an ops hardening option.
- Queue subscribe paths still accept a caller-supplied topic string for binding; publishers use `buildTenantName`, but a misconfigured subscriber pattern is not rewritten by the adapter (defense-in-depth residual).
- `ALLOW_UNSCOPED_TENANT_NAMESPACES=1` disables production fail-closed for cache keys and storage raw-key ops — emergency only; must never be set in normal production.
- CDN static (non-tenant) asset URLs remain intentionally unscoped; branding paths are separate from this finding.
- Search-index / report helpers outside these four packages are out of scope for this PR.
