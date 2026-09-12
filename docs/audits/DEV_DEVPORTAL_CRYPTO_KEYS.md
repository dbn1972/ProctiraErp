# Enterprise module development — Developer portal crypto keys (P0-11)

**Capability / module:** Developer portal · API key CSPRNG + webhook HMAC-SHA256  
**Branch / tip:** `cursor/devportal-crypto-keys-56c3`  
**Date (UTC):** 2026-09-12  
**Peer parity target:** Partner-style API keys (`oem_<hex>`) and `sha256=<hmac>` webhook signatures with timing-safe verify  
**Tasks:** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` (P0-11 — parent owns checklist status; this file is evidence only)

## 0. Product contract

| Item                 | Content                                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement | Backend developer-portal mints API keys with Node `randomBytes`, stores SHA-256 digests, and signs/verifies webhook payloads with `createHmac` + `timingSafeEqual` — no Math.random / stub HMAC. |
| In scope             | `generateApiKey`, `hashApiKey`, `generateWebhookSignature`, `verifyWebhookSignature`; unit tests (generate / verify / reject tampered); revoke path already present                              |
| Explicit non-goals   | Live partner / IdP key mint from the Next developer-portal UI; outbound webhook delivery to real partner endpoints; durable vault-backed secret storage; claiming production partner integrations |
| Roles                | Developer account holders (API keys / webhooks); staff IdP mint remains residual                                                                                                                |
| Sandbox honesty      | UI demo form remains local-validation only (“Live key issuance is not connected”); crypto is real in `@proctira/backend-developer-portal`                                                       |

Screen / API inventory:

| Nav / surface              | Route / package                                      | API / helpers                                                                 | Storage                         | Secrets              |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------- | -------------------- |
| Backend developer-portal   | `packages/backend/developer-portal`                  | create/revoke/validate API keys; create webhook (secret hash); HMAC helpers   | In-memory repo (sandbox)        | Raw key once at mint |
| Developer portal UI (demo) | `apps/developer-portal` `/dashboard` api-key demo    | Client validate only                                                          | N/A                             | None minted live     |

## 1. Domain model

No new SQL. Key material remains `ApiKeyEntity.keyHash` / `WebhookEntity.secretHash` (digests only). Crypto helpers live in `developer-portal-service.ts`.

## 2. API / services

| Check                                      | Done | Evidence                                                                 |
| ------------------------------------------ | ---- | ------------------------------------------------------------------------ |
| API key CSPRNG (`randomBytes`)             | ☑    | `generateApiKey()` → `oem_` + 32 hex                                     |
| Key hash SHA-256                           | ☑    | `hashApiKey()` → `sha256:<64 hex>`                                       |
| Webhook HMAC-SHA256                        | ☑    | `generateWebhookSignature()` → `sha256=<64 hex>`                         |
| Timing-safe verify + tamper reject         | ☑    | `verifyWebhookSignature()` + `crypto-keys.test.ts`                       |
| Revoke                                     | ☑    | `revokeApiKey` + existing service tests                                  |
| No new heavy deps                          | ☑    | Node built-in `node:crypto` only                                         |

## 3. UI

No UI change. Dashboard demo keeps honesty copy that live issuance is not connected.

## 4–6. Integration / observability / residual

- Existing create → validate → revoke flows continue to use the new hash (digest format length changed; in-memory stores only — no migration).
- Residual: dedicated rotate endpoint (create + revoke is sufficient today); live IdP-backed mint from `apps/developer-portal`; tip CI on merge; parent TASKS status flip.

## Exit (this slice)

- [x] Replace non-crypto simulation with Node crypto
- [x] Tests: generate + verify + reject tampered signatures
- [x] DEV note (this file)
- [ ] Tip CI green on merge commit (release gate — not claimed here)
- [ ] Live partner integrations (explicit non-goal)
