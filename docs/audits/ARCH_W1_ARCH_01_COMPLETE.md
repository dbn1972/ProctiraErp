# ARCH — W1-ARCH-01 COMPLETE (developer-portal durable persistence)

**Module / slice:** `@proctira/backend-developer-portal` + gateway mount  
**Branch / tip:** `cursor/w1-arch-01-persist-complete-56c3` @ `PENDING`  
**Date (UTC):** 2026-09-14  
**Prior status:** PARTIAL (`#111` / `055` — API keys only; hybrid left accounts/webhooks/deliveries in process memory)  
**Paired finding:** Developer portal persists important state in memory, bypassing fail-closed persistence

---

## Finding (PARTIAL → COMPLETE)

| Was | Residual after `#111` | Closed this slice |
| --- | --------------------- | ----------------- |
| In-memory developer-portal repo | API keys on Postgres (`055`); everything else memory | Accounts, webhooks (secret digests), deliveries on Postgres (`089`) |
| Production could still serve memory for non-key state when `DATABASE_URL` set | Hybrid memory for secrets/accounts | Factory always wires durable store when URL set; pool-null → `assertPostgresRepositoryAvailable` |
| Weak prod refusal proof for this package | Shared policy existed | Package tests prove `NODE_ENV=production` refuses memory without `DATABASE_URL` |

---

## Done when

| Criterion | Evidence |
| --------- | -------- |
| Important state uses durable store in production posture | `HybridDeveloperPortalRepository` + `PgApiKeyStore` + `PgDeveloperPortalDurableStore`; SQL `055` + `089` |
| Production refuses memory-only fallback | `assertInMemoryFallbackAllowed` / `assertPostgresRepositoryAvailable` in `create-developer-portal-repository.ts` |
| Tests prove persistence + prod refusal | `pg-durable-store.test.ts`, `pg-api-key-store.test.ts` |
| Audit tip SHA + residuals | this file |
| SQL ≥089 if needed | `db/sql/089_developer_portal_durable_state.sql` |

---

## Inventory

| Surface | Persistence | Notes |
| ------- | ----------- | ----- |
| API keys | Postgres `developer_portal_api_keys` (055) | Hash-at-rest; tenant RLS; platform-scope hash lookup |
| Developer accounts | Postgres `developer_portal_accounts` (089) | Platform-admin RLS |
| Webhooks | Postgres `developer_portal_webhooks` (089) | `secret_hash` only; tenant RLS |
| Webhook deliveries | Postgres `developer_portal_webhook_deliveries` (089) | Tenant via webhook; durable queue publisher separate (W2-JOB-07) |
| Sandboxes / marketplace / docs / ratings / analytics / submissions | In-memory residual | Non-security catalog surfaces; documented |

Factory: `createDeveloperPortalRepository()` — `DATABASE_URL` ⇒ hybrid PG durable core; unset + non-prod ⇒ shared in-memory; production without URL ⇒ throw.

---

## Evidence

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Restart durability (mock pool) for accounts/webhooks/deliveries | ☑ | `pg-durable-store.test.ts` |
| Webhook secret digest-only at rest | ☑ | `readRawWebhookSecretHash` assertion |
| API key digest-only (prior) | ☑ | `pg-api-key-store.test.ts` |
| Prod refusal without `DATABASE_URL` | ☑ | `NODE_ENV=production` factory throw |
| URL set + pool null refuses memory | ☑ | `assertPostgresRepositoryAvailable` path |
| Privilege catalog includes new tables | ☑ | `db/runtime-table-privileges.json` (`dml`) |
| Mount matrix honesty | ☑ | `GATEWAY_MOUNT_MATRIX.md` / `G812_PG_COVERAGE.md` |

```bash
pnpm --filter @proctira/backend-developer-portal test
pnpm check:runtime-table-privileges
```

---

## Residuals

1. **Marketplace / docs / sandboxes / submissions / ratings / analytics** remain process-memory when `DATABASE_URL` is set (hybrid delegate). Not authZ secrets; product can fund later SQL if needed.
2. **Live IdP-backed key mint** from `apps/developer-portal` UI still demo/local-validation only (prior P0-11 residual).
3. **Webhook replay nonce store** uses Redis in production (already fail-closed); not part of the PG durable tables.
4. **Tip CI on merge** — branch push only; do not claim main green from this doc alone.
5. Catalog backfill for unrelated tables (`guardian_custody_restrictions`, privacy job tables, `transcript_signing_keys`) included so W1-DATA-11 gate stays green with `089`.

---

## Sign-off

| Claim | Status |
| ----- | ------ |
| W1-ARCH-01 PARTIAL → COMPLETE | ☑ |
| Important developer-portal state durable under production posture | ☑ |
| Production memory-only refused | ☑ |
| Safe to merge from architecture view | ☑ |

**Arch claim:** Closed — security-critical developer-portal state (keys, accounts, webhooks, deliveries) is Postgres-backed when configured; production refuses silent memory fallback.
