# t05 concurrency and race tests

Cross-process HTTP races against a throwaway stack with **two gateway
processes** sharing Postgres and Redis (production runs replicas). The
in-package race tests (`payment-idempotency-race.test.ts`,
`payroll-concurrent-post.test.ts`, `bed-assignment.test.ts`,
`allocation-concurrency.test.ts`, `grade-entry-concurrency.test.ts`, ...) run
in one process; this suite checks the same contracts end to end.

## Run

```bash
~/bin/server-guard.sh
A="pnpm --filter @proctira/aitest aitest"
$A run t05-concurrency-races --out $P/t05-concurrency-races/run     # stack up -> suite -> stack down
AITEST_RACE_ROUNDS=100 $A run t05-concurrency-races --out <dir>    # more rounds locally
pnpm --filter @proctira/aitest test -- src/tracks/t05-concurrency-races   # unit tests (PR CI)
```

On a kept stack (`stack up --unit t05-concurrency-races --profile core --gateways 2`)
the suite can be rerun directly with `AITEST_STACK_STATE=<state.json>
npx vitest run --config vitest.aitest.config.ts src/tracks/t05-concurrency-races`
from `tools/aitest`. Every round creates its own invoice, section, exam, bed,
item or month, so reruns do not interfere.

Cadence: **nightly** (`suite.json`), through `.github/workflows/aitest-scheduled.yml`.
Races are probabilistic: a passing night is evidence, not proof. Each night
adds `AITEST_RACE_ROUNDS` (20) rounds per variant.

## How a round works

`race.ts` creates all `n` request promises behind one gate and opens it on a
`setImmediate`, so every request is in flight before any response arrives.
Requests alternate over gateway #1 and #2 (`spread`). After the round the
suite reads the outcome with SQL (bootstrap role, read-only session) and
checks two things, recorded as two cases per variant:

| Case                    | Asserts                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `race:<variant>`        | no duplicate rows, no lost update, balanced books (SQL)                                               |
| `race:<variant>:status` | winners get the documented 2xx, losers 409 (or the module's documented 422 refusal), never 5xx or 400 |

`race-rounds.json` in the output folder keeps every round's statuses and
entity ids; a failing case names its first failing round, so it can be
replayed with the same entities.

## Variants

| Area             | Variant                                                                                                                                                            | Correct outcome                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Duplicate submit | student, invoice, circular with one `Idempotency-Key` ×10; public registration ×5 (Host-resolved tenant, both gateways); 10 parallel student creates               | one row, one id in every 2xx, distinct admission numbers                                                      |
| Circular send    | send ×5                                                                                                                                                            | sent once, one delivery per channel and recipient                                                             |
| Fees             | same body key ×10; header key ×10; no key ×10; 10 quarter payments; bursar + accountant; bursar + linked guardian (portal); guardian on two sessions               | Σ payments ≤ total, exact payment count, one receipt per payment, payment journal debit = credit = Σ payments |
| Payroll          | same month ×5 (HR officer + principal); 3 parallel `?replace=true`                                                                                                 | one posted run and journal; one current run, one reversal per successful replace                              |
| Seats            | section capacity 5, 10 enrolments; same student ×5; rename with one `If-Match` ×5; exam room slot ×5; invigilator on two overlapping sessions; seating generate ×5 | exactly capacity enrolled, one winner, no double booking, one seat per candidate                              |
| Hostel           | 8 students → one bed; one student → 4 beds                                                                                                                         | one active assignment, bed flag matches                                                                       |
| Library          | 6 patrons → 1 copy; 10 patrons → 3 copies                                                                                                                          | open loans = copies, `available` 0, no copy lent twice                                                        |
| Marks            | gradebook new mark ×5 and existing mark ×6 (principal + admin); exam first entry ×5                                                                                | one row; audit edges form one chain (no two writes from the same prior score); one entry                      |

`compat:*` cases check preconditions the races depend on (seeded students
usable as exam candidates and hostel residents).

Not runnable through the API: hostel vacate + allocate interleaving (no
vacate route, PRC-M277). Payroll `replace=true` is reachable only after
AIT-T05-001 is fixed.

## Pending fixes

`pending-fixes.json` maps failing cases to findings in
`P/t05-concurrency-races/findings.csv`; they run and report `pending-fix`.
After a fix merges, apply `P/t05-concurrency-races/patches/<finding id>.patch`
(it removes the entries) and rerun the suite.
