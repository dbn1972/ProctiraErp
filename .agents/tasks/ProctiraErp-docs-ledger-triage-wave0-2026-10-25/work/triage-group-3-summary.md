# Wave 0 ledger triage — group 3 summary

- Tip: `4c7fb8fe` (worktree `.agents/worktrees/ledger-triage-wave0`, read-only; no CSV/source edits, no commits).
- Input: `work/group-3-input.json` — 111 rows (76 OPEN, 35 PARTIAL; 54 low, 57 medium). No group-3 row is claimed by an in-flight PR.
- Output: `work/triage-group-3.json` (111 rows, each exactly once). Logs: `logs/triage-g3/`.
- The xlsx is absent, so fix_steps/acceptance/needs were null for every row. Triage used ledger title/notes, tip code, and `DECISION_REGISTER.md`.

## Triage result counts

| triage_result     | count                                               |
| ----------------- | --------------------------------------------------- |
| STALE             | 0                                                   |
| DUPLICATE         | 0                                                   |
| PARTIAL_CONFIRMED | 15 (8 OPEN→PARTIAL, 7 PARTIAL with corrected notes) |
| STILL_OPEN        | 96 (68 OPEN, 28 PARTIAL; no CSV change)             |

No row met the STALE bar. PRC-M014 was the closest: the tip code resolves the stated defect, but no test covers the core post-commit path (the original 2xx is kept with `x-audit-status: deferred`), so it stays PARTIAL.

## Eligibility counts

| eligibility          | count | ids                                                                                                                                     |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| ELIGIBLE_LOW         | 14    | L143 L164 L165 L204 L333 L397 L447 L448 L478 L480 L483 L486 L580 L598                                                                   |
| ELIGIBLE_MEDIUM      | 7     | M014 M183 M343 M463 M604 M609 M631 (M014/M183/M463/M631 are test-only)                                                                  |
| SCHEMA_BATCH         | 12    | L086 L107 L144 L286 L529 L569 L576 M184 M325 M389 M462 M626                                                                             |
| INFRA_BATCH          | 3     | M012 M366 M612                                                                                                                          |
| BLOCKED_FOR_APPROVAL | 57    | auth/authz, tenant isolation, privacy, finance/PSP, audit, SSRF/sandbox, API-contract and dependency boundaries; see `boundary` per row |
| NEEDS_DECISION       | 18    | L145 L166 L450 L481 L488 L494 L578 M008 M016 M190 M310 M387 M388 M465 M529 M600 M605 M610                                               |
| CLAIMED              | 0     |                                                                                                                                         |

## PARTIAL_CONFIRMED rows (stale "not addressed" notes corrected by tip evidence)

| id   | old     | met at tip                                                      | still unmet                                                   |
| ---- | ------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| L136 | OPEN    | erasure transitions CAS / FOR UPDATE                            | legal-hold release and correction transitions read-then-write |
| L494 | OPEN    | postgres adapter + prod fail-closed                             | no service consumes search-index                              |
| M013 | OPEN    | placeholder removed, 4xx not audited, fees atomic patterns      | other domains still post-hoc body-hash audit                  |
| M014 | OPEN    | no 503 rewrite after commit; pre-handler pre-check; retry queue | no regression test for post-commit 2xx + deferred header      |
| M026 | OPEN    | single-row reads; atomic Group PATCH deltas                     | Users/Groups list still full directory scan                   |
| M183 | OPEN    | MFA, refresh, auth-plugin, Keycloak authenticate/logout tests   | invite routes and local login/logout HTTP tests               |
| M602 | OPEN    | in-process vm sandbox refuses untrusted code                    | worker sandbox still node:vm in worker_threads                |
| M628 | OPEN    | no wildcard, https-only, metadata/private blocked               | redirects followed without re-validation                      |
| L204 | PARTIAL | 501 when no import worker                                       | demo path lacks TypeBox schema                                |
| L339 | PARTIAL | tenant_id predicate on all PG report queries                    | x-tenant-id header fallback                                   |
| M022 | PARTIAL | instances/approvals SQL-paged                                   | definitions list and approval-decider lookup capped at 200    |
| M463 | PARTIAL | concurrency/actor/worker-wiring tests                           | no PG-backed concurrency test                                 |
| M497 | PARTIAL | body identity ignored, host tenant, server-side phone           | gateway wires no resolvePrimaryAuth, so OTP send always 401   |
| M587 | PARTIAL | fail-closed parser gate, RelayState, InResponseTo, replay cache | no signature-verifying parser shipped                         |
| M589 | PARTIAL | verified-email linking, browser-bound cookie, one-time ticket   | process-local state stores                                    |

## Tests run (all exit 0; `~/bin/server-guard.sh` exit 0 before each batch, `guard-1..4.log`)

- plugin sandbox security + in-process (40), `plugin-sandbox-tests.log`
- gateway: audit-precheck (4), mutation-audit (15), audit-mount (4), scim (5), workflow-paging (3), insights-ui-plugin (16, 1 PG-gated skip), `gateway-*.log`
- auth: mfa-routes (6), M183 coverage set (58), external-providers (32), `auth-*.log`
- privacy service + erasure guard (37), search-index (9), workflow M463 set (16)

DATABASE_URL was unset, so the PG-only paths (privacy CAS SQL, report store, workflow guard SQL) are backed by code evidence, not by a PG test run.

## Notes for follow-up

- Coordinate PRC-M012 with PRC-M524 (infrastructure, PARTIAL). PR #649 added only an empty `TRUSTED_PROXY_CIDRS` placeholder, so M012 is not a duplicate.
- L145, M008 and M465 map to DECISION_REGISTER groups 3 and 9. Survey, custom-field, plugin and policy rows depend on the parked-package mount decision (L166, L450, L578).
- Several ledger notes dated 2026-10-11 say "not addressed", but the fixes landed earlier in PRs #540, #543, #552 and #590. The PARTIAL_CONFIRMED notes record the actual state at tip.
- No rows were left incomplete.
