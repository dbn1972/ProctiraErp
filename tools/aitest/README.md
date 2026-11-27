# @proctira/aitest

Shared harness for the AI test program: throwaway stacks, synthetic tenants,
tokens, API and screen inventories, snapshots, results and findings. Each
track owns `src/tracks/<unit>/`; everything shared lives in `src/foundation/`
(import from `@proctira/aitest` or `../../foundation/index.js`).

Live suites never run in PR CI. PR CI runs only the unit tests
(`src/**/*.test.ts`). Live suites are `*.aitest.ts` (vitest) or
`*.aitest.spec.ts` (Playwright), started by `aitest run`, scheduled by
`.github/workflows/aitest-scheduled.yml`.

## Commands

```bash
pnpm --filter @proctira/aitest test        # unit tests (PR CI)
pnpm --filter @proctira/aitest typecheck
pnpm --filter @proctira/aitest lint

A="pnpm --filter @proctira/aitest aitest"
$A stack up --unit <unit> --profile none|db|core|full [--gateways 0|1|2] \
   [--web web,admin-console] [--keycloak] [--workers etl-worker,exam-document-worker] \
   [--node-env production] [--no-seed] [--port-base N --project proctira-aitest-x]
$A stack status --unit <unit>
$A stack down --unit <unit>                 # containers, volumes, processes, state
$A run <suite-id> [--unit <unit>] [--out <dir>] [--keep-stack] [--reuse-state-file <state.json>]
$A suites [--cadence nightly|weekly] [--json]
node tools/aitest/bin/list-suites.mjs --cadence nightly   # workflow matrix (no deps)
```

`stack up` prints `AITEST_STACK_STATE=<state.json>` and the port map, never a
secret. Run `~/bin/server-guard.sh` before heavy commands; the harness also
calls it (via `serverGuard`) before stack up, each service start and each
suite run, and waits while the host is saturated.

## Profiles

| Profile | Containers                                              | Host services                                              |
| ------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| `none`  | none                                                    | none (scanners, mutation testing)                          |
| `db`    | postgres                                                | none by default                                            |
| `core`  | postgres, redis                                         | gateway (1 by default, `--gateways 2` for races and chaos) |
| `full`  | + kafka, rabbitmq, minio (+ keycloak with `--keycloak`) | gateway(s), optional workers                               |

Web apps (`--web`) are built once per worktree and git sha under a host-wide
build lock and served with `next start` on `http://localhost:<port>`.
With `--keycloak` the gateway runs in Keycloak (RS256) mode and refuses HS256
tokens; use `keycloakPasswordGrant` there.

Every stack: schema by `prisma migrate deploy` + `tools/scripts/apply-sql.sh`
(`APPLY_SEEDS=1 APPLY_STRICT_FKS=1`, the CI e2e path), then the synthetic seed
(`seed/seed.ts`) and the fixture manifest (`fixtures.json`).

## Ports

Each unit owns one 50-port block in 34000-34999 (`UNIT_PORT_BASES`). Offsets:
postgres +0, redis +1, kafka +2, rabbitmq +3/+4, minio +5/+6, keycloak +7,
gateway +10/+11, etl-worker +12, exam-document-worker +13, web +20,
registration-portal +21, public-website +22, admin-console +23,
developer-portal +24, install-wizard +25, track-local +30..+39.
The block lies inside Linux's default ephemeral range, so the harness waits for
a port that an outgoing connection briefly holds and retries a lost bind; the
scheduled workflow reserves 34000-34999 on its runner.

## Safety rules

- Compose runs only through `stack/compose.ts`: project `proctira-aitest-*`
  only, both compose files and the generated env file always injected,
  `system`/`prune` refused. Never run raw `docker kill/stop/rm` or a global prune.
- Secrets are generated per stack into `<stateDir>/<project>/aitest.env`
  (mode 600) and reach processes only through env or request bodies.
- Synthetic data only. `aitest-tenants.sql` raises unless
  `proctira.allow_aitest_seed=on` (set by the seeder for one psql connection).
- Never point the harness at `proctira-uatenv`, `proctira-staging-*` or
  `proctira-erp-*`. Remove each stack when done (`stack down`; `run` does it).

## Suites and cadence

Declare suites in `src/tracks/<unit>/suite.json` (object or array; see
`suite/spec.ts`). `cadence` is `["nightly"]`, `["weekly"]`, both, or `"script"`
with a reason. The scheduled workflow picks them up from disk.

| Suite                       | Cadence          | Profile         |
| --------------------------- | ---------------- | --------------- |
| `foundation-smoke`          | nightly + weekly | core            |
| `foundation-keycloak-smoke` | weekly           | full + keycloak |

## Results, findings and pending fixes

Write through `ResultsRecorder` (`results.json` + `results.md`) and
`FindingsWriter` (`findings.csv`, ids `AIT-T<NN>-<seq>`) into `AITEST_OUT_DIR`.
Committed tests assert only correct behaviour. When a generated case fails
because of a product defect:

1. Record the finding; add `"<case id>": "<finding id>"` under `cases` in
   `src/tracks/<unit>/pending-fixes.json`. The case keeps running and reports
   `pending-fix` (it does not fail the job).
2. Save the unchanged diff that removes that entry (or restores a hand-written
   assertion) as `patches/<finding id>.patch` in the track's program folder and
   check it with `git apply --check`.
3. After the fix merges, the case reports `fixed-pending-restore`; apply the
   patch so the case is enforced again.
