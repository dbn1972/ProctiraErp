# Security — Prometheus /metrics guard + cardinality (W1-SEC-07)

**Module / slice:** `@proctira/observability` Fastify plugin  
**Branch / tip:** `cursor/aud-w1-sec-07-metrics-56c3`  
**Date (UTC):** 2026-09-14  
**Data classes:** operational (process + HTTP series; may leak route/status topology)  
**Paired test audit:** unit — `metrics-access.test.ts`, `fastify-plugin.test.ts`

---

## 0. Inventory

| Route / API    | AuthN                                                         | AuthZ                         | Data class   | Notes                                |
| -------------- | ------------------------------------------------------------- | ----------------------------- | ------------ | ------------------------------------ |
| `GET /metrics` | Bearer (`METRICS_BEARER_TOKEN`) / allowlist / loopback        | Application guard (W1-SEC-07) | operational  | Fail-closed in production when unset |

---

## 1. Controls

| Check                                   | Pass | Evidence |
| --------------------------------------- | ---- | -------- |
| Unauthenticated → 401/403 in production | ☑    | Remote IP denied when no token/allowlist; `fastify-plugin.test.ts` |
| Bearer / allowlist accept               | ☑    | `authorizeMetricsAccess` + plugin inject tests                     |
| Cross-tenant IDOR blocked (API)         | N/A  | Metrics no longer label raw `tenant_id`                            |
| No secrets/tokens in git or client logs | ☑    | Token only via env; `.env.example` placeholder                     |
| Cardinality bounded                     | ☑    | `tenant_id` removed from `http_requests_total` labels              |
| Input validation / abuse basics         | ☑    | Timing-safe bearer compare; loopback/IP normalize                  |

---

## 2. Findings

### P0

| ID        | Finding                                            | Fix |
| --------- | -------------------------------------------------- | --- |
| W1-SEC-07 | Unauthenticated `/metrics` + unbounded `tenant_id` | Guard + drop `tenant_id` from default HTTP labels |

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

- Operators must set `METRICS_BEARER_TOKEN` (or allowlist) for in-cluster Prometheus scrapes when `NODE_ENV=production` — loopback-only otherwise.
- `METRICS_PUBLIC=1` re-opens the endpoint by design; must not be set in production.
- Network-layer ACL (NetworkPolicy / scrape-only Service) remains defense-in-depth outside this app guard.
- Default HTTP metrics still label `route` templates (bounded by registered routes, not tenant count).
