# Gap closure tasklist — 2026-09-21

Tip audited: `main` = `4d4706cd`. Open pull requests at time of writing: 0.

Produced by re-running `docs/audits/templates/MODULE_DEEP_EVALUATION_PROMPT.md` and
`docs/audits/templates/UAT_READINESS_VERIFICATION_PROMPT.md` against the tip, then
merging the result with the items already recorded in
`PENDING_WORK_LEDGER_2026-09-21.md`.

Findings are classified `implemented` / `partial` / `absent` / `unverified`;
remediations `FULLY_CLOSED` / `PARTIAL` / `OPEN` / `REGRESSED` /
`EXTERNALLY_UNVERIFIED`. Where a claim is not closed, it is not marked closed.

Each task states **how it breaks**, because the prompt is explicit that missing
code, missing UI, missing provider and missing verification need different fixes and
must not be conflated.

---

## T1 — Registry credentials absent; nothing can be deployed

`absent` / `OPEN` · blocked on a credential · **owner action required**

Every release run fails at `Prepare Deployment`:

```
::error::W1-OPS-15: Production deploy requires REGISTRY_USERNAME and
         REGISTRY_PASSWORD — refusing silent skip.
```

The control is behaving correctly — it refuses to skip quietly. **Breaks on missing
configuration, not missing code.**

This also answers UAT Part C question 1, "Is anything deployed?" — **no**. No
container image has been published, so UAT cannot begin on any shared environment.

**Done when** both secrets exist and one `Release` run reaches a non-skipped,
successful `Build & Push`.

---

## T2 — Fee collection cannot transact

`absent` / `OPEN` · **breaks on missing provider**

Confirmed at tip: **zero** payment-service-provider adapters anywhere in
`packages/backend` or `apps/api-gateway/src` — searched `razorpay`, `stripe`,
`payu`, `paytm`, `cashfree`, `ccavenue`, `billdesk`.

The ledger side is real and was live-proved earlier (double-entry balance,
isolation, money typing, concurrency). What is missing is the money movement, so the
Part A fee lifecycle **breaks at `collection`**:

```
structure → assignment → invoice → [COLLECTION BREAKS] → receipt → refund → arrears
```

This is UAT Part C question 2. A fee UAT without a transacting provider tests
bookkeeping, not fee collection.

**Done when** one PSP is integrated behind the existing ledger with a sandbox
transaction proved end to end, including refund and reconciliation.

---

## T3 — Five backend capabilities exist only as untracked local stubs

`absent` / `OPEN` · **breaks on missing code** · newly surfaced by this pass

These directories exist on the working machine but are **not in git**:

| Package                      | Entries | In git | Mounted in gateway |
| ---------------------------- | ------- | ------ | ------------------ |
| `packages/backend/payroll`   | 2       | no     | no                 |
| `packages/backend/finance`   | 1       | no     | no                 |
| `packages/backend/alumni`    | 1       | no     | no                 |
| `packages/backend/canteen`   | 1       | no     | no                 |
| `packages/backend/inventory` | 1       | no     | no                 |

Because they are untracked they are absent from CI, absent from any image, and
absent from the mount matrix. A directory listing suggests these capabilities exist;
the repository contains nothing.

Consequence for Part A: the staff lifecycle **breaks at `payroll`**:

```
recruit → onboard → attendance → leave → appraisal → [PAYROLL ABSENT]
```

They are also why `gateway-mount-matrix.test.ts` fails locally while passing in CI —
the test enumerates `packages/backend/*` from disk.

**Do not delete them without checking with their author.** They may be somebody's
work in progress on this machine.

**Done when** each is either committed with a real implementation and a mount-matrix
entry, or removed so the filesystem stops implying a capability that does not exist.

---

## T4 — No statutory or interoperability output exists

`absent` / `OPEN` · **breaks on missing code** · re-verified at this tip

Word-boundary counts, repo-wide versus implementation surface:

| Standard  | Repo-wide | `packages/backend` + `apps/api-gateway/src` |
| --------- | --------- | ------------------------------------------- |
| UDISE     | 22        | **0**                                       |
| LTI       | 49        | **0**                                       |
| SCORM     | 25        | **0**                                       |
| DIKSHA    | 5         | **0**                                       |
| OneRoster | 5         | **0**                                       |
| Ed-Fi     | 5         | **0**                                       |
| APAAR     | 4         | **0**                                       |
| NDEAR     | 4         | **0**                                       |
| CEDS      | 4         | **0**                                       |
| xAPI      | 5         | **0**                                       |

Every count is docs, plans, marketing copy or a UI label. The LTI and SCORM totals
look substantial but resolve entirely to `docs/plans/` and `docs/audits/` —
`LMS_LTI_EPIC.md`, scorecards, FRS documents. **No implementation exists for any
standard.**

The previously-reported dead "Export UDISE" button was removed in #336, so the
specific instance of an affirmative claim with no handler behind it is
`FULLY_CLOSED`. The underlying absence is not.

**Board verdict for Part B:** "board" is **not an implemented product surface**.
A `boards` table exists; affiliation lifecycle, statutory returns, board-level
examination conduct and consolidated cross-school analytics do not.

**Done when** one return format is implemented end to end — generation, validation
against the published spec, submission artefact, and a test that fails if the
artefact drifts. One real format beats ten aspirational mentions.

---

## T5 — P0 control-plane document isolation, step 2 of 3

`partial` / `PARTIAL` · see `SEC_CONTROL_PLANE_DOCUMENT_ISOLATION.md`

Structural cause, from the live catalog:

```
control_plane_documents_pkey  PRIMARY KEY (collection, id)
```

`tenant_id` is not in the key, so ids are one global namespace and an unscoped
`get(id)` returns the row whichever tenant owns it. `withPlatformScope` binds
`app.platform_admin='1'`, which the policy accepts as a full escape.

Landed: #338 (optional `DocumentScope`), #357 (two call sites scoped on evidence,
two documented as genuinely unscopable).

Outstanding, verified at tip:

- the bind is still unconditional — `pg-document-store.ts:80`
- **32 call sites** to classify: `tenant` 17, `billing` 11, `api-gateway` 4
- **nine collections cannot be classified from data** (empty on the evaluation
  database): `billing.plans`, `billing.entitlements`, `tenant.tenants`,
  `tenant.domains`, `tenant.usage`, `tenant.roles`, `tenant.users`,
  `tenant.settings`, `tenant.branding_drafts`

`billing.plans` and `tenant.tenants` read as platform-owned by name. **Do not
classify from names.** That heuristic already failed once here: "route `auth.*` to
`{tenantId}`" would have broken `auth.keycloak_tenants`, which is platform-owned
(6 rows, 0 with a `tenant_id`).

**Order matters.** Making the bind conditional before the 32 sites are classified
fails closed on reads that are correct today.

**Done when** all 32 sites pass an explicit scope, `scope` is required, the bind is
conditional, and a live test shows a tenant-B-scoped read of a tenant-A document
returning zero rows through `PgDocumentCollection`.

**Separate follow-up:** put `tenant_id` in the primary key. While ids are global,
two tenants cannot hold the same logical id — a second write upserts over the first.

---

## T6 — Unsafe constraint-validation pattern in 10 migrations

`partial` / `OPEN` · latent hazard · **no current data is mis-validated**

Under `FORCE ROW LEVEL SECURITY` the tenant policy applies to the owner, so a
validation scan runs under it. With no `app.tenant_id` bound the policy denies, the
scan sees zero rows, and `VALIDATE CONSTRAINT` succeeds without reading anything —
leaving `convalidated = true` over unchecked data. Proved while fixing 098: one
planted orphan, `VALIDATE` returned success.

Validate without lifting `FORCE`:

```
068  071  072  074  076  080  082  086  093  097
```

093's targets are confirmed `relforcerowsecurity = true`. Handled correctly:
**096** (which predates the 098 fix), **098**, **100**.

**Measured, not assumed:** every validated single-column FK on a FORCE-RLS table was
scanned as superuser with `session_replication_role = replica` so all rows were
visible — **0 violations**. The mechanism exists; the data is clean.

**Correction to an earlier claim:** 090 was named as suspect. It contains no
`VALIDATE CONSTRAINT` and is unaffected.

**Done when** a W1-DATA gate rejects `VALIDATE CONSTRAINT` on a FORCE-RLS table
unless the file lifts and restores `FORCE` in the same transaction, as 100 does. The
10 historical files are checksum-locked — prefer a forward-only migration over
editing them.

---

## T7 — `main` has no branch protection

`absent` / `OPEN` · **owner action required**

No required status checks and no required reviews. `mergeable_state` reports
`unstable` while anything is pending, but the merge path is never blocked.

This makes `task-branch-pr-workflow`'s "merge only after required checks pass and a
reviewer approves" unenforceable. It is what allowed several merges this session to
land with `Integration Tests` still running — the gate that caught both the vacuous
FK validation and a seed-dependent fixture that no other check saw.

**Do not enable auto-merge while required checks are absent.** With none configured
it would merge as soon as conflicts clear, without waiting for any gate — worse than
the current state.

**Done when** `Integration Tests`, `Type Check`, `Lint`, `CI Aggregate (Required)`
and the W1-DATA gates are required, plus at least one review.

A worktree named `chore/GOV-team-governance-enforcement` exists at
`/home/ec2-user/ProctiraErp-team-governance` with no commits beyond `main`. It may
be a start on this. Review before removing.

---

## T8 — #356's image-build fix is unproven in CI

`implemented` / `EXTERNALLY_UNVERIFIED`

#356 fixed four Next image builds failing on
`Definition for rule '@typescript-eslint/no-unused-vars' was not found`. Cause: app
`.eslintrc.json` files set `@typescript-eslint` rules without declaring the plugin
and relied on ESLint cascading to the repo-root config, which the Dockerfile never
copies.

Verified by running the real Docker builds: all four compile, and `admin-console`
emits the same unused-variable warning the host does, confirming the rule is active
rather than skipped.

**Not confirmed in CI.** `Build & Push` is path-gated by `detect-services`; merges
since #356 touched only `apps/mobile/**`, so it reported `skipped`.

**Done when** a merge touching `apps/**` produces a non-skipped successful
`Build & Push`. Gated behind T1.

---

## T9 — Institution assignment feature is inert

`partial` / `OPEN` · **breaks on missing UI/API**

#341 resolves `institutions[]` per request from active staff assignments, with the
additional-charge and expiry cases live-proved. Nothing populates `staff.user_id` or
manages assignment rows, so in practice the resolver always returns empty.

**Done when** an admin surface can link a login to a staff record and create, amend
and end assignments, with the expiry path exercised.

---

## T10 — Unverified and partially-verified module findings

`unverified` / `OPEN`

- `FEES-AUTHZ-01`, `UX-01`, `OPS-02` — never verified either way.
- 8 of 9 fees pages have no i18n for display copy. Currency formatting was fixed in
  #337 (locale-derived, no hardcoded `en-IN`); the copy was not.

**Done when** each is either proved or restated as a real finding with evidence.

---

## Closed by this session, recorded so they are not re-opened blindly

`FULLY_CLOSED`, each with live evidence as `proctira_app` (NOSUPERUSER/NOBYPASSRLS):

| Finding                                                    | Evidence                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 23 tenant tables had no FK to `tenants`                    | #342 — all 23 `uuid` with validated FKs; FK rejects a nonexistent tenant, accepts a real one |
| W1-DATA-02 residual: 56 policies raised instead of denying | #340                                                                                         |
| `institutions: []` hardcoded in `verify.ts`                | #341                                                                                         |
| FK validated vacuously under FORCE RLS in 098              | orphan planted → `VALIDATE` fails; `relforcerowsecurity` still true after rollback           |
| Dead "Export UDISE" button                                 | #336                                                                                         |
| Hardcoded `en-IN` fees currency                            | #337                                                                                         |
| Audit hash-chain tamper evidence                           | #331                                                                                         |
| Privacy legal hold blocks deletion                         | #332                                                                                         |
| Admissions tenant isolation                                | #327                                                                                         |
| main's red gitleaks gate                                   | #333                                                                                         |

UAT Part C partial credit, for accuracy: self-serve primitives **do** exist —
tenant provisioning (`provisioning.ts`), invites, role assignment — and student
import exists with an Excel parser and duplicate detector. PHI safety improved
materially: all 23 formerly-text tables now carry validated tenant FKs. None of that
makes UAT possible while T1 and T2 stand.

---

## What this pass cannot determine

Per Part D of the prompt, and stated rather than glossed:

- Whether any environment is actually running. Nothing here was observed serving
  traffic; all structural claims come from a local evaluation database.
- Whether a real school's data imports cleanly. The import code exists; no
  production-shaped dataset was run through it.
- Whether the nine unclassifiable document collections are tenant- or
  platform-owned. They are empty locally, and guessing is what T5 warns against.
- Whether UI flows are usable. No screens were exercised; no captures were reviewed.

---

## Suggested order

1. **T1** — secrets. Cheapest, unblocks every deployment claim and T8.
2. **T7** — branch protection. Stops the merge-while-red pattern recurring.
3. **T5** — the P0. Highest security value; needs a populated environment to classify
   the nine collections honestly.
4. **T6** — the validate gate. Small, and prevents the hazard reappearing.
5. **T3** — decide the five stubs: build them or delete them.
6. **T2**, **T4** — the two genuine product absences, each a project.
7. **T9**, **T10** — as capacity allows.
