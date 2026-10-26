# Wave 0 ledger triage — group 1 summary

- Baseline: `4c7fb8fe` (`docs/ledger-triage-wave0`, frozen origin/main). 113 input rows, 113 output rows, each once, in input order.
- Output: `work/triage-group-1.json`. Logs and the row scratch file: `logs/triage-g1/` (`rows.jsonl` is assembled by `build.py`).
- Data source: ledger title, notes and evidence only. The xlsx is absent, so `fix_steps`, `acceptance` and `needs` are null. STALE needed a visible tip fix for the whole title/notes plus a passing targeted test that I ran. NEEDS_DECISION follows the manifest `triage_policy`: an unresolved owner decision in DECISION_REGISTER.md or the row notes.
- No CSV edits, no commits, no installs, no turbo-wide runs. `~/bin/server-guard.sh` exited 0 before each of the 12 targeted test runs, and every run exited 0. Logs are `logs/triage-g1/*-tests.log` and `guard-*.log`.

## Triage result counts

| triage_result     | count | proposed CSV change                                                                                                                                                              |
| ----------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STALE             | 4     | → FULLY_CLOSED: PRC-L421, PRC-L434, PRC-L439, PRC-L513                                                                                                                           |
| DUPLICATE         | 1     | PRC-M067 → DUPLICATE of PRC-M132 (same file and endpoint; M132 is the surviving row)                                                                                             |
| PARTIAL_CONFIRMED | 56    | → PARTIAL, notes get a met/unmet line. 12 of these move OPEN→PARTIAL: L195, L223, L228, L236, L253, L408, L597, M005, M147, M155, M330, M568. The other 44 were already PARTIAL. |
| STILL_OPEN        | 52    | none                                                                                                                                                                             |

## Eligibility counts (rows staying OPEN/PARTIAL)

| eligibility           | count                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| BLOCKED_FOR_APPROVAL  | 43                                                                                                              |
| NEEDS_DECISION        | 32                                                                                                              |
| ELIGIBLE_LOW          | 18 — L096, L224, L228, L253, L255, L262, L530, M147, M254, L172, L240, L244, L270, L407, L413, L435, M144, M489 |
| ELIGIBLE_MEDIUM       | 4 — L140, L141, L466, M134                                                                                      |
| SCHEMA_BATCH          | 6 — L299, M335, L036, L097, L464, M482                                                                          |
| INFRA_BATCH           | 5 — L223, M005, M568, L216, L263                                                                                |
| CLAIMED               | 0 (no group-1 id is in the manifest claimed list)                                                               |
| n/a (STALE/DUPLICATE) | 5                                                                                                               |

## Reviewer attention

- **Contradiction with the D6 PR body.** The PR #634 body lists PRC-L421 and PRC-L439 as "left OPEN (live/backend surface)". At tip, the only code behind each was deleted SPA code: `CrossBoardTransferDashboard.tsx`, and `SettingsGeneral.tsx` with its 34 `settings.general.*` keys. A grep finds no remaining surface, and the D6 closure guard (`dead-internal-links.test.ts`) passes. I proposed STALE for both. Please confirm before applying.
- **PRC-L434** is also closed by removal. The hand-typed "Document ID" field was in the deleted `RegistrationWizard.tsx`. The server-side storage/AV residual stays with PRC-M330.
- **PRC-L513** was already fixed in #536 (`useId` ids, column name kept in the sort label). The ledger note was written later and is out of date.
- **Ledger notes are out of date for several rows**, where tip code already does what the notes call deferred: L048 (leave from records, template scale), L054, L228, L236 (CSV route), L253 (sw.js VM tests), L466, L545, M330, M489 (gateway auth-fallback tests). These are PARTIAL_CONFIRMED, not closed, because a named residual is still open.
- **PRC-M155** overlaps PRC-M290 (PR #654, NEEDS_DECISION). Coordinate before fixing.

## Rows I could not complete

- **PRC-M254: probably already fixed, but I couldn't verify it.** `make_clients.sh` now exits 1, and the Dart BaseApi/fromJson/contract tests exist. There is no dart or flutter toolchain on this host, so those tests did not run. Only the TS gateway contract test ran (exit 0). The row stays OPEN until `dart test` evidence exists.
- **PRC-L407: residual not located.** The tabs half is gone (`HealthRecord.tsx` deleted by D6). I could not find the "duplicate-resolution radios" at tip or in the pre-D6 tree. The row is ELIGIBLE_LOW with no `expected_files` and needs the original audit location.
- **Mobile rows (L006, L007, L011, M039, M468, M470, L213, L211, M031): evidence-only.** Flutter tests were not run. None of these rows is proposed for closure.
