# DATA — W1-DATA-08 COMPLETE (transcript authenticity backfill + dedicated keys)

**Module / slice:** SIS transcript issuances authenticity (close PARTIAL → COMPLETE)  
**Branch / tip:** `cursor/w1-data-08-transcript-complete-56c3` @ `f38c245f9ce7084fee2523d2a1e6651f7d2ffef4`  
**Date (UTC):** 2026-09-14  
**Environment:** SQL contract + unit tests; live Postgres proofs when `DATABASE_URL`

## Finding (residual after 069)

| Residual                                                                                                                                   | Status before this PR |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| Soft CHECK `transcript_issuances_issued_authenticity_chk` remained `NOT VALID`; pre-069 ISSUED rows could lack `signature_hmac` / checksum | Open                  |
| HMAC reused `SIS_BOARD_EXPORT_SIGNING_SECRET` / `JWT_SECRET` / hardcoded dev fallback                                                      | Open                  |

Prior partial audit: `docs/audits/DATA_W1_DATA_08_IMMUTABILITY.md`.

## Scope (this PR)

| Artifact     | Path                                                                    | Notes                                                                             |
| ------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Migration    | `db/sql/076_transcript_authenticity_complete.sql`                       | `transcript_signing_keys`; backfill ISSUED; VALIDATE CHECK; `signing_key_id` FK   |
| App signing  | `packages/backend/gradebook/src/signed-download.ts`                     | Dedicated `TRANSCRIPT_SIGNING_*` only; fail-closed; per tenant/institution derive |
| Issue path   | `packages/backend/gradebook/src/gradebook-service.ts` + schemas         | Persist key provenance in metadata; optional `institutionId`                      |
| Static tests | `tools/tenant-isolation-tests/src/unit/immutability-privileges.test.ts` | 076 contract                                                                      |
| Unit tests   | `packages/backend/gradebook/src/signed-download.test.ts`                | Fail-closed + no JWT reuse                                                        |
| Live tests   | `packages/shared/database/src/immutability-privileges.live.test.ts`     | CHECK `convalidated`; registry columns                                            |
| Docs         | `db/README.md`, `.env.example`, this file                               | Operator contract                                                                 |

## Invariants

1. Every `status = 'ISSUED'` row has 64-hex `checksum_sha256` + `signature_hmac`; CHECK is **VALID** (not merely `NOT VALID`).
2. Pre-076 ISSUED gaps are migrator-backfilled (append-only trigger disabled only for that UPDATE), sealed with `legacyAuthenticitySeal` metadata when HMAC was synthesized.
3. New issues sign with dedicated rotated KMS/PKI-backed material: `TRANSCRIPT_SIGNING_SECRET` derived as `HMAC(secret, transcript:v1:{tenant}:{institution|tenant})`, keyed by `TRANSCRIPT_SIGNING_KMS_KEY_REF` / `TRANSCRIPT_SIGNING_KEY_ID`.
4. Missing dedicated secret **fail-closes in production** (throws `TranscriptSigningKeyMissingError`, HTTP 503 `TRANSCRIPT_SIGNING_KEY_MISSING` with an actionable message). Production also requires `TRANSCRIPT_SIGNING_KMS_KEY_REF`. Outside production, a missing secret uses a process-local ephemeral HMAC key generated at gradebook startup (see the amendment below).
5. `TRANSCRIPT_SIGNING_SECRET` must not equal `JWT_SECRET` or `SIS_BOARD_EXPORT_SIGNING_SECRET`; KMS ref must not alias those env names.
6. `transcript_signing_keys` stores **refs only** (never raw JWT/board secrets); RLS + no DELETE for `proctira_app`.

## Apply / verify

```bash
# apply numbered SQL including 076 (psql / tools/scripts/apply-sql.sh — not Prisma)
bash tools/scripts/apply-sql.sh

# spot: CHECK must be validated
psql "$MIGRATOR_DATABASE_URL" -c \
  "SELECT conname, convalidated FROM pg_constraint
   WHERE conname = 'transcript_issuances_issued_authenticity_chk';"
# expect convalidated = t

# static
pnpm --filter @proctira/tenant-isolation-tests exec vitest run \
  --config vitest.config.ts src/unit/immutability-privileges.test.ts

# unit (dedicated signing)
pnpm --filter @proctira/backend-gradebook exec vitest run src/signed-download.test.ts

# live (DATABASE_URL = proctira_app against DB with 076)
pnpm --filter @proctira/database exec vitest run src/immutability-privileges.live.test.ts
```

## Non-goals / residuals (honesty)

| Residual                                                                                                                                                          | Status                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Legacy backfill seals use deterministic `digest(...)` (not re-HMAC under live KMS) so historical rows satisfy the CHECK without needing production secrets in SQL | **Accepted** — new ISSUED rows use dedicated keys; metadata marks legacy seals  |
| Full AWS KMS Sign API / HSM PKCS#11 driver not embedded in gradebook (operators unwrap material into `TRANSCRIPT_SIGNING_SECRET` or wire a sidecar)               | **Accepted** — registry + env contract is the fail-closed control plane         |
| Board-export download tokens may still fall back to JWT/dev secrets                                                                                               | **Out of scope** — separate artifact path; transcript path isolated             |
| Superuser can disable triggers; defense relies on migrator vs `proctira_app`                                                                                      | **Accepted** (same as 053/069)                                                  |
| CA-sealed PDF / X.509 over the PDF bytes                                                                                                                          | **Non-goal** — authenticity is HMAC over canonical checksum with dedicated keys |

## Dev / non-production amendment (2026-09-27)

Sunrise demo issuance stayed at `transcript_issuances = 0` when `TRANSCRIPT_SIGNING_SECRET` was unset, and the thrown error was not mapped to an API body (Fastify hid it as a generic 500).

| Environment                     | Behavior                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV=production`           | No key is generated. Missing `TRANSCRIPT_SIGNING_SECRET` or `TRANSCRIPT_SIGNING_KMS_KEY_REF` logs an error at gradebook startup and `POST /gradebook/transcripts/issue` returns **503** `TRANSCRIPT_SIGNING_KEY_MISSING` with the env names in `message`. The Student Records issue form renders that message.                                                          |
| local / development / test / CI | If `TRANSCRIPT_SIGNING_SECRET` is unset, gradebook generates **one ephemeral in-memory HMAC key per process** at startup (`randomBytes`, not a file, not committed). A warning is logged. Issuances are stamped `kmsKeyRef=dev:ephemeral-in-memory` and `signingKeyId=transcript-dev-ephemeral`. The key is not JWT/board-export material and does not survive restart. |

Operator contract remains in `.env.example` and `db/README.md`. No private key is stored in git.

## Rollback

Forward-fix only. Do not re-mark the authenticity CHECK `NOT VALID`. Do not re-introduce JWT/board-export fallbacks into transcript signing.

## Sign-off

**Data claim:** Certified w/ waivers (residuals above).  
**W1-DATA-08 status:** **COMPLETE** (PARTIAL closed).
