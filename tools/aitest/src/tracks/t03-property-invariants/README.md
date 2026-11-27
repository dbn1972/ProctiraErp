# t03 property-based invariants (money and grades)

Random sequences of real backend operations run against a live, throwaway
Postgres. Every invariant is checked after every command, and each violated
invariant is shrunk to a minimal reproduction with fast-check.

| Domain    | Backend under test (same wiring as the package `*.live.test.ts`)                                                          | Commands                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fees      | `FeesService` + `PgFeesRepository` + `SandboxPaymentAdapter`                                                              | plan, ad-hoc / plan / structure invoice (instalments), payment (full, part, over, idempotency key, replay), refund per payment, credit note, write-off, void, concession request / approve / reject, scholarship netting (new, carry-over, replay), netting reversal, bank reconciliation file (exact, wrong amount, unknown invoice, repeated line, line from an earlier file, re-import), dues and refundable reports |
| payroll   | `StaffHrService` + `PgStaffHrStore`, `StaffService` + `PrismaStaffRepository`, unpaid leave from `PgStaffLeaveRepository` | add staff with contract, attendance (present, absent, half day, leave), approved unpaid leave (month-crossing), offboard, post month, replace month; random `PAYROLL_PRORATION` and `PAYROLL_LOP_DIVISOR` per run; months include February 2024 (leap)                                                                                                                                                                  |
| grades    | `AssessmentService` + `ResultService` (Prisma repositories), `GradebookService` + `PgGradebookRepository`                 | grading scheme create / update (valid or perturbed bands), assessment items, results, subject grade; gradebook marks (with matching, contradicting or unknown letters), workflow transitions, GPA, report cards; a random contiguous gradebook scale per run                                                                                                                                                            |
| promotion | `AcademicCalendarService.rollover` over the tenant-bound Prisma client                                                    | enrol into a grade/section, withdraw, retain, rollover (dry run or real) over a random 1-4 grade ladder with 1-2 sections per grade                                                                                                                                                                                                                                                                                     |

Every sequence uses a fresh random tenant, so runs are independent and need no
cleanup inside the throwaway database. A read-only pass checks the same fee and
grade invariants on the seeded Sunrise tenant (`seed:*` cases).

## Invariants (case id `prop:<domain>:<invariant>`)

- fees: `ledger-balanced`, `ar-equals-outstanding`, `cash-equals-net-collected`,
  `revenue-equals-recognised`, `invoice-equals-lines`, `paid-within-face`,
  `refund-within-paid`, `receipt-matches-payment`, `status-consistent`,
  `netting-within-disbursement`, `recon-matches-once`, `reports-match-ledger`.
- payroll: `net-equals-gross-minus-deductions`, `deductions-within-gross`,
  `proration-matches-policy`, `lop-matches-policy`, `no-double-lop`,
  `run-totals-balance`, `posted-once-per-month`, `idempotent-repost`, `eligibility`.
- grades: `scheme-contiguous`, `subject-average`, `grade-matches-scale`,
  `scheme-frozen-after-results`, `entry-grade-matches-scale`, `workflow-transitions`,
  `gpa-matches-scale`, `report-card-published-only`.
- promotion: `promotion-follows-ladder`, `promotion-once`, `graduation-terminal-only`,
  `summary-matches`, `dry-run-no-writes`.
- every domain: `model-agreement` (the service accepts exactly what the rules
  allow) and `no-unexpected-error` (plus one `no-unexpected-error:<Command>`
  case per command that crashed, so a known crash never hides a new one).

The expected results are re-implemented from the documented rules
(`fees-model.ts`, `payroll-model.ts`, `grades-model.ts`, `promotion-live.ts`
headers); they do not call the production helpers they check.

"An invoice equals the sum of its lines": invoices have no line items in this
code. The check is that the stored amount equals the issued amount minus its
credit-note, write-off, concession and netting lines, and that a structure
equals the sum of its instalments.

## Run

```bash
~/bin/server-guard.sh
pnpm --filter @proctira/aitest aitest run t03-property-invariants --out <dir>   # stack up (db) -> suite -> stack down
AITEST_NUM_RUNS=500 AITEST_SEED=777 pnpm --filter @proctira/aitest aitest run t03-property-invariants
AITEST_DOMAINS=fees,payroll ...                                                  # subset of domains
pnpm --filter @proctira/aitest test -- src/tracks/t03-property-invariants          # unit tests (PR CI)
```

Environment: `AITEST_NUM_RUNS` (suite default 300), `AITEST_SEED` (default: time
based, printed in every case detail), `AITEST_SHRINK_MS` (time budget per
shrink, suite default 120000), `AITEST_DOMAINS`. Outputs in `<out>`:
`results.md` / `results.json`, `findings.csv` (one candidate row per violated
invariant), `property-runs.json` (runs, commands, violations per domain) and
`counterexamples/<case>.json` (shrunk commands, seed, path, replay path,
reproduction line).

Reproduce one case exactly (one run, the shrunk sequence):

```bash
AITEST_FOCUS=prop:fees:ar-equals-outstanding AITEST_SEED=<seed> AITEST_PATH=<path> \
  AITEST_REPLAY_PATH=<replayPath> pnpm --filter @proctira/aitest aitest run t03-property-invariants
```

## Cadence

Nightly (`suite.json`): 300 sequences per domain on the `db` profile take about
10-20 minutes including shrinking, which is too slow for PR CI but cheap enough
to catch money and grade regressions every day. The unit tests of the models,
checkers and runner run in PR CI with the rest of `@proctira/aitest`.

## Known defects

`pending-fixes.json` lists cases that currently fail with their finding id. They
still run and are reported `pending-fix`; when one starts passing it is reported
`fixed-pending-restore`. After the fix merges, apply
`P/t03-property-invariants/patches/<finding>.patch` (it removes the entry) and
rerun the suite. A violation that needs a rare sequence may be missed by one
nightly run; confirm a `fixed-pending-restore` with the reproduction line above
before restoring.
