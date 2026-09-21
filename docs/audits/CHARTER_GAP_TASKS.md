# Charter gap tasks — tracking file

Single tracker for the gaps found by grading `main` against the five specification
volumes in `docs/multitenant/`. Findings and evidence live in:

- `CHARTER_CONFORMANCE_VOL1_VOL2_2026-09-21.md`
- `CHARTER_CONFORMANCE_VOL3_VOL4_VOL5_2026-09-21.md`
- `TASKLIST_GAP_CLOSURE_2026-09-21.md` (pre-existing T-items)

**Baseline tip:** `main` = `12705129`

## Working rules

One gap, one branch, one PR, reviewed and merged before the next is started. Update
the Status and PR columns in the same PR that does the work, so this file never
claims something the branch has not delivered.

Status vocabulary: `OPEN` · `IN PROGRESS` · `PARTIAL` · `FULLY_CLOSED` ·
`BLOCKED` · `NEEDS DECISION` · `EXTERNALLY_UNVERIFIED`

A gap moves to `FULLY_CLOSED` only with executable evidence — a command, a named
test, or an observed runtime behaviour. Not "looks right".

## Agent-fixable, unblocked

Ordered by leverage, not by size.

| ID  | Gap                                                 | Spec                        | Status | Branch | PR  |
| --- | --------------------------------------------------- | --------------------------- | ------ | ------ | --- |
| T11 | `db/sql` cannot be applied to an empty database     | V1 §16 §43; V3 §11          | `OPEN` | —      | —   |
| V10 | 6 API domains absent as governed surfaces           | V4 §5, Table 2              | `OPEN` | —      | —   |
| V9  | Error envelope inconsistent (`retryable` in 1 file) | V4 §6                       | `OPEN` | —      | —   |
| V3  | MySQL offered but cannot work                       | V1 §17.1 §14.4 §33.3; V2 T6 | `OPEN` | —      | —   |
| V8  | No first-party SDK                                  | V4 §9; V1 §22.2             | `OPEN` | —      | —   |
| V5  | Hardcoded UI copy, 8 of 9 fees pages                | V1 §11.5 §46                | `OPEN` | —      | —   |
| V6  | No email/notification delivery adapter              | V2 T6; V3 T3                | `OPEN` | —      | —   |
| T6  | `VALIDATE CONSTRAINT` under FORCE RLS needs a gate  | —                           | `OPEN` | —      | —   |
| T4  | Zero statutory/interop implementation               | —                           | `OPEN` | —      | —   |

### T11 — WITHDRAWN, not a defect

**Status:** `NOT_A_DEFECT`. This was my error and is retracted.

I reported that `db/sql` could not be applied to an empty database, having seen the
chain halt at `065_tenant_timezone_foundation.sql`. The cause was that I skipped
`prisma migrate deploy`. `db/README.md:28` mandates the order **Prisma →
apply-sql.sh**, and CI performs exactly that.

Tested on a clean database following the documented order:

```
prisma migrate deploy   -> All migrations have been successfully applied
apply-sql.sh            -> Domain SQL apply complete (applied=111) , 0 errors
```

`065` is a no-op on the supported path. Prisma creates `tenants.timezone` as
`is_nullable=NO DEFAULT 'UTC'`, so its `ADD COLUMN IF NOT EXISTS` skips, no row can
be NULL, and the `SET NOT NULL` is already satisfied. The backfill never needs to see
rows, so the FORCE RLS blindness does not arise here at all.

Confirmed with the fix **disabled**, so the pass is not an artefact of a change.

**What this invalidates.** Anything previously described as "blocked by T11" was not
blocked. The isolation, integrity and resilience items under "cannot be measured yet"
are gated only by T1, and `db/sql` can be applied from empty via the documented path.

**What survives.** The underlying mechanism is still real and independently proved:
a migrator subject to FORCE RLS sees zero rows (`UPDATE 0` versus `UPDATE 1` with a
tenant GUC bound), and a constraint validation scan under it marks a constraint valid
over data it never read — demonstrated with a planted orphan row while fixing 098.
That is T6, which stands on its own evidence and is narrower than T11 claimed.

**Lesson recorded deliberately:** I asserted a migration-chain defect without first
following the repository's own documented apply order, then proposed rewriting the
migration framework to fix it. The check that would have caught this was reading
`db/README.md` before running the chain.

### V10 — do `service-accounts` first

`service-accounts` and `org-units` have zero gateway references. Take
`service-accounts` first: V4 §4 and V5 §3 both require scoped machine identities, and
V4 §11's sandbox and non-production credential path depends on it.

`/api/v1/queue/*` is second in value — V5 §6 requires queue replay and redrive to be
audited and V3 §12 requires backlog observability, neither of which has a surface.

## Needs a decision before work can start

| ID     | Question                                                      | Why it cannot be an engineering call                                                                                                                                | Status           |
| ------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **V4** | Do cross-service FKs stay, or does W1-DATA-06 go?             | V3 §7 and V1 §19.6 forbid shared FK coupling; W1-DATA-06 requires a validated `tenant_id` FK on every tenant table. #342 added 23 at explicit request, live-proved. | `NEEDS DECISION` |
| V1     | Table naming and ownership — 5 of 8 prefixes have zero tables | Remediation direction depends entirely on V4                                                                                                                        | `BLOCKED` by V4  |
| V7     | 0 of 22 named tables exist                                    | Same as V1 — same underlying model                                                                                                                                  | `BLOCKED` by V4  |
| V2     | `control_plane_documents` owned by three services             | The P0 fix is partly independent and can proceed; full ownership split depends on V4                                                                                | `PARTIAL`        |

**Recommendation on V4:** exempt the tenant reference in §19.6 and record the
exemption. Tenant identity is platform infrastructure rather than a peer service, so
the coupling the clause guards against does not really apply, and it preserves
integrity that is already proven. The alternative — withdrawing the gate and
reverting 23 constraints — removes real referential integrity to satisfy a clause
aimed at a different problem.

**Scale note, stated plainly.** V1, V2 and V7 are not three bugs. They are one
architectural gap: the specifications describe strict per-service table ownership,
and this codebase has a shared-document control plane plus 244 largely unprefixed
tables. Full conformance is a re-platforming of the persistence layer — it would
touch the migration chain, the drift gate and every repository class. The pragmatic
path is to freeze the pattern for new services, fix the one place it actively causes
harm (V2, which is also the P0), and treat full conformance as a roadmap item with
explicit sign-off.

## Not fixable by an agent

| ID  | Gap                                   | Why                                                                                         | Owner                     |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------- |
| T1  | No container image has ever published | `REGISTRY_USERNAME` / `REGISTRY_PASSWORD` absent. `W1-OPS-15` correctly refuses to skip.    | Whoever owns the registry |
| T7  | `main` has no branch protection       | Merge policy decision, repo-wide                                                            | Repository owner          |
| T2  | Fee collection cannot transact        | Which PSP, on what commercial contract                                                      | Business                  |
| T3  | 5 untracked backend stubs             | On this machine only; may be someone's work in progress                                     | Their author              |
| V3b | Implementing MySQL properly           | Needs a replacement for `ROW LEVEL SECURITY`, which the whole §6.4 isolation model rests on | Architecture              |

On T7: do **not** enable auto-merge while no required checks exist. With none
configured it would merge as soon as conflicts clear, without waiting for any gate —
worse than the current state.

## Cannot be measured yet

| ID  | Area                                                                          | Blocked by                     |
| --- | ----------------------------------------------------------------------------- | ------------------------------ |
| V11 | V5 §7 resilience — backups, restore tests, DR drills, SLOs                    | T1, T11                        |
| V11 | V5 §4 tenant boundaries in cache, search, queues, analytics, backups, exports | T11                            |
| —   | V1 §28 performance and availability NFRs                                      | T1                             |
| —   | V1 §38 SLO/SLI/runbook coverage                                               | T1                             |
| —   | V1 §35 threat model and abuse case catalog                                    | document review                |
| —   | V1 §42 compliance evidence artefacts                                          | document review                |
| —   | V1 §11.4 WCAG 2.1 AA                                                          | screen review + assistive tech |
| —   | V1 §13 / §14 public legal and trust pages                                     | not examined                   |

These are `unverified`, not compliant. Several are large enough to change the overall
picture, and V5 §4 in particular covers six isolation layers where only storage has
been proved.
