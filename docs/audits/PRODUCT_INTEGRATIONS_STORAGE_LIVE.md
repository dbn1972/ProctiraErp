# Product / security — Integrations live storage adapter (peer-gap #8)

**Updated (UTC):** 2026-09-07  
**Branch:** `cursor/integrations-storage-live-56c3`  
**Exit:** One live SMS **or** storage connector when secrets/env exist.

## What shipped

| Item                              | Evidence                                                       |
| --------------------------------- | -------------------------------------------------------------- |
| `GET /api/v1/storage/health`      | `apps/api-gateway/src/plugins/storage-health.ts`               |
| MinIO / S3 from `S3_*` env        | Compose already sets MinIO + `S3_*` for api-gateway            |
| HeadBucket + put/get/delete probe | `runStorageHealthProbe` (tenant-prefixed `system-health` keys) |
| Honest unconfigured               | HTTP 503 `mode: unconfigured` when keys missing                |
| Unit tests                        | `storage-health.test.ts`                                       |
| Install CLI expectation           | `tools/install-cli` already calls this path                    |

## Waivers

| Item                         | Status                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| Live Twilio / SMTP / FCM SMS | **Waived** — no vendor secrets in this environment; notification senders remain sandbox |
| AWS production IAM roles     | External                                                                                |
| Multi-provider matrix        | Deferred                                                                                |

## How to verify

1. Without `S3_*` → `GET /api/v1/storage/health` → 503 unconfigured.
2. With `docker compose` MinIO + gateway env → 200 `mode: live`, `roundTrip: true`.
3. `pnpm --filter @proctira/api-gateway test` includes storage-health cases.
