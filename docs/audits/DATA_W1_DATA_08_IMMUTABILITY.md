# DATA — W1-DATA-08 immutability (audit archive + transcript authenticity)

**Module / slice:** Control-plane audit archive + SIS transcript issuances  
**Branch / tip:** `cursor/aud-w1-data-08-immutability-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** SQL contract + live Postgres negative proofs (when `DATABASE_URL`)

## Finding

Immutability controls remained incomplete for **audit archives** and **transcript authenticity**:
`audit_log_archive` had hash-chain columns (028) but no append-only mutate guard / privilege
narrowing; ISSUED `transcript_issuances` were append-only after 053 but still accepted inserts
without first-class checksum/signature material.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Migration | `db/sql/069_audit_archive_transcript_authenticity.sql` | Archive append-only + REVOKE; `signature_hmac`; ISSUED INSERT authenticity trigger; soft CHECK `NOT VALID` |
| Prior hardening | `db/sql/053_immutability_privileges.sql` | Unchanged — transcript UPDATE/DELETE + REVOKE on ledger/audit/transcript |
| App wiring | `packages/backend/gradebook/**` | Persist `signatureHmac` on issue |
| Static tests | `tools/tenant-isolation-tests/src/unit/immutability-privileges.test.ts` | 053 + 069 contract |
| Live tests | `packages/shared/database/src/immutability-privileges.live.test.ts` | Forbidden UPDATE/DELETE; ISSUED insert without authenticity fails |

## Invariants

1. `audit_log_archive` is INSERT-only; UPDATE/DELETE raise append-only; `proctira_app` cannot UPDATE/DELETE/TRUNCATE/TRIGGER.
2. `transcript_issuances` remains UPDATE/DELETE blocked (053); ISSUED INSERT requires `checksum_sha256` and `signature_hmac` as 64-char hex (069).
3. Corrections remain append-only: issue a new version (INSERT), never mutate prior ISSUED rows.

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Soft CHECK `transcript_issuances_issued_authenticity_chk` is `NOT VALID` — pre-069 ISSUED rows without `signature_hmac` are not backfilled or force-validated | **Closed in `076` / `DATA_W1_DATA_08_COMPLETE.md`** |
| HMAC uses app signing secret (`SIS_BOARD_EXPORT_SIGNING_SECRET` / `JWT_SECRET`), not a PKI / CA-sealed PDF signature | **Closed for transcripts in `076` + dedicated `TRANSCRIPT_SIGNING_*` (CA-sealed PDF remains non-goal)** |
| Superuser / table-owner can still disable triggers; defense relies on migrator vs `proctira_app` role split (050) | **Accepted** (same as 053) |
| Active `audit_log_entries` DELETE under `app.audit_archival='1'` remains the only archival move path | **By design** (022) |
| `grade_change_audit` and other module audit tables not in this slice | **Out of scope** |

## Apply / verify

```bash
# apply numbered SQL including 069 (psql / db apply tooling — not Prisma)
# static:
pnpm --filter @proctira/tenant-isolation-tests exec vitest run --config vitest.config.ts src/unit/immutability-privileges.test.ts
# live (requires DATABASE_URL as proctira_app against migrated DB):
pnpm --filter @proctira/database exec vitest run src/immutability-privileges.live.test.ts
```

## Rollback

Forward-fix only: drop trigger/function/constraint/column via a follow-up migration if needed.
Do not re-grant UPDATE/DELETE on `audit_log_archive` to `proctira_app`.

## Sign-off

**Data claim:** Certified w/ waivers (residuals above).
