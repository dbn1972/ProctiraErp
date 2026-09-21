# Pending work ledger — 2026-09-21

State at `main` = `4d4706cd`. Open pull requests: **0**. Remote branches: `origin/main` only.

This records what is _not_ done, with the evidence for each claim and what would
close it. Everything here was checked against the tip or a live database on the date
above; re-verify before acting, per the repository baseline rule on dated audits.

Ordered by consequence, not effort.

---

## 1. BLOCKED — no container images can be published

**Status:** `OPEN`, blocked on a credential this repository does not hold.

`Prepare Deployment` fails on every release run:

```
::error::W1-OPS-15: Production deploy requires REGISTRY_USERNAME and
         REGISTRY_PASSWORD — refusing silent skip.
```

`REGISTRY_USERNAME` and `REGISTRY_PASSWORD` are not configured as repository
secrets. This is the W1-OPS-15 control working as intended — it fails the workflow
rather than skipping quietly — so it is **not a bug to fix in code**. Nothing can
deploy until the secrets exist.

**Done when:** both secrets are set, and one `Release` run reaches `Build & Push`
with a non-skipped, successful conclusion.

**Cannot be done by an agent.** Requires whoever owns the registry account.

---

## 2. P0 control-plane document isolation — step 2 of 3 complete

**Status:** `PARTIAL`. See `SEC_CONTROL_PLANE_DOCUMENT_ISOLATION.md` for the full
analysis; this is the outstanding remainder.

Structural cause, confirmed against the live catalog:

```
control_plane_documents_pkey  PRIMARY KEY (collection, id)
```

`tenant_id` is not in the key, so document ids are one global namespace. An
unscoped `get(id)` returns the row whichever tenant owns it, and
`withPlatformScope` binds `app.platform_admin='1'`, which that table's policy
accepts as a full escape.

Landed so far: #338 added the optional `DocumentScope`; #357 scoped the two call
sites that live data could justify and documented two that cannot be scoped at all.

**Still open, verified at tip:**

- The escape is still unconditional — `pg-document-store.ts:80`:

  ```
  await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
  ```

  This is acceptance criterion 2 of the audit, and it is not met.

- **32 unscoped call sites remain** to classify:

  | Area                                      | Sites |
  | ----------------------------------------- | ----- |
  | `packages/backend/tenant`                 | 17    |
  | `packages/backend/billing`                | 11    |
  | `apps/api-gateway` (platform-admin-store) | 4     |

- **Nine collections cannot be classified from data** — they are empty on the
  evaluation database: `billing.plans`, `billing.entitlements`, `tenant.tenants`,
  `tenant.domains`, `tenant.usage`, `tenant.roles`, `tenant.users`,
  `tenant.settings`, `tenant.branding_drafts`.

  `billing.plans` and `tenant.tenants` read as platform-owned by name, but guessing
  either way either breaks a feature or leaves a hole. Settle them from a populated
  environment or from the write paths — **not from the name.** A plausible-sounding
  rule already proved wrong once here: "route `auth.*` to `{tenantId}`" would have
  broken `auth.keycloak_tenants`, which is platform-owned (6 rows, 0 with a
  tenant_id).

**Order matters.** Making the bind conditional before the 32 sites are classified
will fail closed on reads that are correct today.

**Done when:** all 32 sites pass an explicit scope, `scope` is a required
parameter, the `app.platform_admin` bind is conditional, and a live test shows a
tenant-B-scoped read of a tenant-A document returning zero rows through
`PgDocumentCollection` — not raw SQL.

**Separate follow-up, not part of step 3:** the primary key itself. While ids are
global, two tenants cannot hold the same logical id — a second write upserts over
the first. Adding `tenant_id` to the key is its own migration.

---

## 3. Unsafe constraint-validation pattern in 10 migrations

**Status:** `OPEN` as a latent hazard. **No current data is mis-validated.**

Under `FORCE ROW LEVEL SECURITY` the tenant policy applies to the table owner too,
so Postgres runs an FK/CHECK validation scan under it. With no `app.tenant_id`
bound the policy denies, the scan sees zero rows, and `VALIDATE CONSTRAINT`
succeeds without comparing anything — leaving `convalidated = true` over data it
never read. Proven while fixing 098: one planted orphan row, `VALIDATE` returned
success.

Migrations that validate without lifting `FORCE`:

```
068  071  072  074  076  080  082  086  093  097
```

093's two target tables are confirmed `relforcerowsecurity = true`
(`developer_portal_webhooks`, `developer_portal_webhook_deliveries`).

Handled correctly, for reference: **096** (2 validates, 2 lifts) — so the safe
pattern predates the 098 work — plus **098** and **100**.

**Correcting an earlier claim in this session's notes:** 090 was named as
suspect. It contains **no** `VALIDATE CONSTRAINT` at all and is not affected.

**Measured, not assumed:** a scan of every validated single-column FK on a
FORCE-RLS table, run as superuser with `session_replication_role = replica` so all
rows were visible, found **0 violations**. The mechanism is present; the data
happens to be clean. So this is a hazard to gate, not an integrity incident.

**Done when:** a W1-DATA gate rejects `VALIDATE CONSTRAINT` in a migration
touching a FORCE-RLS table unless the file lifts and restores `FORCE` in the same
transaction — the pattern 100 uses. Re-validating the 10 historical files is
optional given the clean scan, but they are checksum-locked, so prefer a
forward-only follow-up migration over editing them.

---

## 4. #356's image-build fix is unproven in CI

**Status:** `EXTERNALLY_UNVERIFIED`.

#356 fixed four Next image builds failing on
`Definition for rule '@typescript-eslint/no-unused-vars' was not found`. Root
cause: the app `.eslintrc.json` files set `@typescript-eslint` rules without
declaring the plugin, and relied on ESLint cascading up to the repo-root config —
which the Dockerfile never copies.

Verified by running the real Docker builds locally: all four compile, and
`admin-console` emits the same `'Badge' is defined but never used` warning the host
does, confirming the rule is genuinely active rather than skipped.

**Not yet confirmed in CI.** `Build & Push` is path-gated by `detect-services`, and
the merges since #356 touched only `apps/mobile/**`, so it reported `skipped`.

**Done when:** a merge touching `apps/**` produces a non-skipped, successful
`Build & Push`. Note this is also gated behind item 1 — without registry
credentials the job cannot fully succeed regardless.

---

## 5. `main` has no branch protection

**Status:** `OPEN`.

Checked via the API: **no required status checks and no required reviews.**
`mergeable_state` reports `unstable` whenever anything is pending, but the merge
path is never actually blocked.

This makes `task-branch-pr-workflow`'s "merge only after required checks pass and a
reviewer approves" unenforceable, and it is what allowed several merges this session
to proceed with `Integration Tests` still running. That gate is not decorative — it
caught the vacuous-FK validation bug and a seed-dependent fixture that no other
check saw.

**Done when:** `Integration Tests`, `Type Check`, `Lint`, `CI Aggregate (Required)`
and the W1-DATA gates are required on `main`, and at least one review is required.

**Needs the repository owner** — changing merge policy is not an agent decision.

**Do not** enable auto-merge while required checks are absent: with none
configured, auto-merge would merge as soon as conflicts clear, without waiting for
any gate. That is strictly worse than the current state.

---

## 6. Feature completeness gaps carried over from the module evaluation

**Status:** `OPEN`.

- **FEES-PAY-01 (P0)** — no live PSP integration. Cannot be closed in-repo.
- **`staff.user_id` has no admin API.** #341 resolves `institutions[]` from active
  staff assignments, but nothing populates the identity link or manages
  assignments, so the feature is inert in practice.
- **`FEES-AUTHZ-01`, `UX-01`, `OPS-02`** — unverified.
- **8 of 9 fees pages** have no i18n for display copy.

---

## 7. Dependency upgrades closed pending prerequisites

**Status:** `OPEN` by decision. Each PR carries a comment with the reasoning, so
Dependabot will reopen with context.

| PR   | Upgrade                  | Prerequisite                                                                                                                                         |
| ---- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| #350 | `@vitejs/plugin-react` 6 | Vite 5 → 8 (peer is `^8.0.0`); 13 config files                                                                                                       |
| #345 | `eslint-config-next` 16  | ESLint 8.57 → 9 flat-config migration                                                                                                                |
| #346 | Prisma 5 → 7             | `datasource.url` moves to `prisma.config.ts`; re-prove the W1-DATA-04 drift gate across 31 models and the `migrate deploy` → `apply-sql.sh` ordering |
| #349 | Tailwind 3 → 4           | CSS-first rewrite; 6 configs, the design-system CSS test, Playwright baselines                                                                       |

None of these is a bump. Each is its own task.

---

## 8. Housekeeping

- **8 stale local branches** from squash-merged PRs. `git branch -d` will refuse
  them because squash-merged branches look unmerged to git; `-D` is the honest
  alternative and needs explicit approval after reviewing the commits.
- **A second worktree exists** and is not mine:
  ```
  /home/ec2-user/ProctiraErp-team-governance   09d26e79  [chore/GOV-team-governance-enforcement]
  ```
  No commits beyond `main`, nothing unpushed. Given the name it may be the branch
  protection work in item 5. **Left untouched** — review before removing.
- **Five untracked directories** under `packages/backend/`: `alumni`, `canteen`,
  `finance`, `inventory`, `payroll`. Not in git, which is why CI is unaffected, but
  they fail `gateway-mount-matrix` locally. Left untouched; they may be
  work-in-progress.

---

## Suggested order

1. Item 1 — secrets. Cheapest, and unblocks all deployment.
2. Item 5 — branch protection. Prevents recurrence of the merge-while-red pattern.
3. Item 2 step 3 — the P0. Highest security value; needs a populated environment to
   classify the nine collections honestly.
4. Item 3 — the W1-DATA gate. Cheap to add, stops the hazard reappearing.
5. Items 6 and 7 as capacity allows.
