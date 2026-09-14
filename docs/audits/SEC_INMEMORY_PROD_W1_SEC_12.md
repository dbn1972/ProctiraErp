# Security — production in-memory persistence refuse (W1-SEC-12)

**Module / slice:** `@proctira/database` persistence policy + readiness  
**Branch / tip:** `cursor/aud-w1-sec-12-inmemory-prod-56c3`  
**Date (UTC):** 2026-09-14  
**Data classes:** all durable domain stores (PII / financial / PHI when modules load)  
**Paired test audit:** unit — `persistence-policy.test.ts`, `readiness-probe.test.ts`, gateway `health.test.ts`

---

## 0. Inventory

| Surface                         | AuthN | AuthZ | Data class | Notes                                      |
| ------------------------------- | ----- | ----- | ---------- | ------------------------------------------ |
| Repository factories (memory)   | N/A   | N/A   | domain     | `assertInMemoryFallbackAllowed` gate       |
| Readiness `/health/ready`       | probe | N/A   | ops        | fail-closed when Postgres required         |
| Env `ALLOW_IN_MEMORY_IN_PRODUCTION` | N/A | N/A | ops     | obsolete; ignored loudly in production     |

---

## 1. Controls

| Check                                                         | Pass | Evidence |
| ------------------------------------------------------------- | ---- | -------- |
| Production refuses in-memory without DATABASE_URL             | ☑    | `persistence-policy.test.ts` |
| Former escape hatch `ALLOW_IN_MEMORY_IN_PRODUCTION=1` ignored | ☑    | throws + `console.error` once per domain |
| Readiness stays not-ready when escape set in production       | ☑    | `readiness-probe.test.ts`, `health.test.ts` |
| `.env.example` honesty                                        | ☑    | documents flag as removed / do-not-set     |

---

## 2. Findings

### P0

| ID        | Finding                                                              | Fix |
| --------- | -------------------------------------------------------------------- | --- |
| W1-SEC-12 | `ALLOW_IN_MEMORY_IN_PRODUCTION` permitted non-durable prod persistence | Removed escape; production always refuses; loud log if flag still set |

### P1 / P2

| ID  | Sev | Finding | Fix / waiver |
| --- | --- | ------- | ------------ |
|     |     |         |              |

---

## 3. Sign-off

| Claim                            | Status   |
| -------------------------------- | -------- |
| P0 cleared                       | ☑        |
| P1 cleared or waived             | ☑ (none) |
| Safe to merge from security view | ☑        |

**Residual risks:**

- Operators with the obsolete env var still in manifests will see loud errors and failed readiness until `DATABASE_URL` is set — intentional fail-closed.
- Rate-limit / idempotency still have their own narrowly scoped Redis-related emergency flags (`ALLOW_IN_MEMORY_RATE_LIMIT` / `ALLOW_IN_MEMORY_IDEMPOTENCY`); those are out of scope for W1-SEC-12 (domain persistence only).
