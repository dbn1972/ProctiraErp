# Wave 0 ledger triage — group 2 summary

- Baseline: `4c7fb8fec961b49a8a7b70c05d22ebe30ad18e20` (worktree W = `.agents/worktrees/ledger-triage-wave0`)
- Rows: 116 in, 116 out (each once) — `work/triage-group-2.json`
- Builder and decision sources: `logs/triage-g2/build.py`, `logs/triage-g2/decisions-0{1,2,3}.json`
- xlsx Fix steps / Acceptance / Needs were null for every row (spreadsheet absent per `triage-manifest.json`). Rows were judged against the ledger title and notes only, which is why most code-landed rows are PARTIAL_CONFIRMED rather than STALE.
- `<W>` in `tests_run` commands means the worktree root. Every test command was preceded by a passing `~/bin/server-guard.sh`.

## Triage result counts

| Result | Count |
|---|---|
| STALE | 3 |
| DUPLICATE | 0 |
| PARTIAL_CONFIRMED | 22 |
| STILL_OPEN | 91 |

STALE (proposed FULLY_CLOSED, each with a targeted passing test I ran):

| Id | Evidence | Test (exit) |
|---|---|---|
| PRC-L209 | etl-worker auth hook + verified tenant binding (`apps/etl-worker/src/server.ts:92-108`, `auth.ts:110-126`) | etl-worker `auth.test.ts` + `server.test.ts` 26/26 (0) |
| PRC-M211 | envelope secrets 113, fan-out creates deliveries, mandatory fail-closed signing (`developer-portal-service.ts:660-673,709-740`) | developer-portal webhook suites 24/24 (0); gateway wiring 3/3 (0) |
| PRC-L389 | e2e harness fail-closed by default (`tools/scripts/run-e2e-backend-ready.sh:24-28,59-63,124-130`) | `node --test tools/scripts/run-e2e-backend-ready.test.mjs` 6/6 (0) |

M211 caveat (also in its note): fan-out only runs when `WEBHOOK_FANOUT_EVENTS` is set, and migration 113 was not applied to a live DB. A reviewer may downgrade it to PARTIAL if acceptance needs fan-out on by default.

PARTIAL_CONFIRMED: 21 OPEN→PARTIAL and 1 PARTIAL with refreshed notes (L380). 17 of them are db rows whose fixes landed in PR #650 (`ffd48b49`, migrations 240-250 and seed fixes) after the 2026-10-11 notes; #650 only reconciled M209 in the ledger. These rows are not STALE for two reasons. Their behavioural tests are `*.live.test.ts` and need Postgres (DATABASE_URL is unset here), and most still have sub-steps from the title that are unmet. The others are L375, L380, L460, M311, M530 and M559, where part of the fix exists at tip even though the ledger note says "not addressed".

## Eligibility counts (rows staying OPEN/PARTIAL: 113)

| Eligibility | Count |
|---|---|
| ELIGIBLE_LOW | 17 |
| ELIGIBLE_MEDIUM | 8 |
| SCHEMA_BATCH | 26 |
| INFRA_BATCH | 29 |
| BLOCKED_FOR_APPROVAL | 33 |
| NEEDS_DECISION | 0 (no xlsx Needs column; owner-decision rows from ledger notes, e.g. M209/M623/M624/L565, are BLOCKED_FOR_APPROVAL with the boundary named) |
| CLAIMED | 0 (no group-2 id appears in `claimed-and-decision.json`) |

ELIGIBLE_LOW: L099, L100, L101, L187, L300, L301, L302, L375, L376, L453, L461, L462, L467, L497, L554, L556, L581.
ELIGIBLE_MEDIUM: M408, M409, M410, M419, M551, M553, M593, M614.

## Tests run

| Command | Exit | Log |
|---|---|---|
| `pnpm -C <W> --filter @proctira/etl-worker exec vitest run src/auth.test.ts src/server.test.ts` | 0 | `logs/triage-g2/L209-etl-worker.log` |
| `pnpm -C <W> --filter @proctira/backend-developer-portal exec vitest run src/webhook-fanout.wiring.test.ts src/webhook-signing-secrets.test.ts src/webhook-signature.test.ts src/webhook-outbox-delivery.test.ts` | 0 | `logs/triage-g2/M211-devportal.log` |
| `pnpm -C <W> --filter @proctira/api-gateway exec vitest run src/webhook-signing-secrets-wiring.test.ts` | 0 | `logs/triage-g2/M211-gateway.log` |
| `node --test tools/scripts/run-e2e-backend-ready.test.mjs` | 0 | `logs/triage-g2/L389-run-e2e.log` |
| `pnpm -C <W> exec vitest run tools/scripts/__tests__/apply-sql-guards.test.ts` | 0 | `logs/triage-g2/L380-apply-sql-guards.log` |
| `pnpm -C <W> --filter @proctira/backend-audit exec vitest run src/audit-service.test.ts` | 0 | `logs/triage-g2/L295-audit-service.log` |

## Not completed / not verified

- All rows were triaged; none are incomplete.
- Live-PG tests added by PR #650 (`*.live.test.ts` for 240-249) were not run because no database is available. Those rows stay PARTIAL.
- No DUPLICATE was proposed. M195, M208 and L095 share a root cause (composite tenant FKs), and so do L091 and L294 (RLS policy shape), but they cover different tables or defects and all of them are still open.
- No CSV, source, or git state was changed. `git status` shows only the untracked task directory.
