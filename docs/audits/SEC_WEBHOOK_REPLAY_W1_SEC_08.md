# Security — Webhook HMAC replay protection (W1-SEC-08)

**Module / slice:** `@proctira/backend-developer-portal` webhook signing  
**Branch / tip:** `cursor/aud-w1-sec-08-webhook-replay-56c3`  
**Date (UTC):** 2026-09-14  
**Data classes:** operational / partner integration (webhook secrets)  
**Paired test audit:** unit — `webhook-signature.test.ts`, `crypto-keys.test.ts`

---

## 0. Inventory

| Route / API | AuthN | AuthZ | Data class | Notes |
| ----------- | ----- | ----- | ---------- | ----- |
| Outbound webhook delivery (`processQueuedDelivery`) | N/A (server→partner) | Tenant-scoped webhook entity | partner secret | Signs body with timestamp + nonce |
| Partner verify helper (`verifyWebhookSignatureSecure`) | HMAC + skew + nonce | Replay store | partner secret | Fail-closed in production without store |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Signed timestamp header | ☑ | `x-proctira-timestamp` via `createWebhookSignatureHeaders` |
| Skew tolerance window | ☑ | `WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS` (300s); expired → `expired` |
| Nonce / replay cache | ☑ | `MemoryWebhookReplayStore` / `RedisWebhookReplayStore` (SET NX EX) |
| Fail-closed when store unavailable in prod | ☑ | Missing/throwing store → `replay_store_unavailable` |
| Timing-safe HMAC compare | ☑ | `verifyWebhookSignature` |
| No secrets in git | ☑ | Test secrets only |

---

## 2. Findings

### P0

| ID | Finding | Fix |
| --- | ------- | --- |
| W1-SEC-08 | Webhook HMAC lacked timestamp, skew, and nonce replay protection | Sign `timestamp.nonce.payload`; verify skew + claim nonce; fail closed in prod |

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

- Multi-replica receivers must inject a shared Redis (or equivalent) replay store; in-memory is single-process only.
- Production hosts that call `verifyWebhookSignatureSecure` without a store will correctly reject all deliveries until Redis is wired.
- Partners must update receivers to read `x-proctira-timestamp` / `x-proctira-nonce` and HMAC over `timestamp.nonce.body` (breaking change from payload-only HMAC).
