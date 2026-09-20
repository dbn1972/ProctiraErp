# `fees` — per-module deep evaluation

**Audited SHA:** `8ca963fc18ecdfe8221bcd0f070a69af4d777ca8` (tip of `main` at time of audit)
**Date:** 2026-09-20
**Prompt:** `docs/audits/templates/MODULE_DEEP_EVALUATION_PROMPT.md`
**Verdict:** **PARTIAL** — the strongest module evaluated to date on integrity and
isolation, with a single decisive break at **collection** and a real localization gap.

---

## Environment actually used

Both the module prompt and `UAT_READINESS_VERIFICATION_PROMPT.md` require that
structural claims be executed against a live, migrated database as a
NOSUPERUSER/NOBYPASSRLS role. This audit did that.

| Item              | Value                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| Container         | `proctira-eval-pg` (`postgres:16-alpine`), `127.0.0.1:55440`            |
| Database          | `proctira_eval`                                                         |
| Migrations        | 114 applied, latest `097_admissions_public_context.sql`                 |
| Runtime role      | `proctira_app` — verified `rolsuper=false`, `rolbypassrls=false`        |
| Privilege posture | `tools/scripts/apply-runtime-table-privileges.sh` (W1-DATA-11) executed |

Two environment fix-ups were required and are disclosed because they affect how
much weight the results carry:

1. The database was one migration behind tip (`096`). `097` was applied directly,
   then its ledger checksum adopted (`sha256 8ee17295e3c1476e…`) to match what
   `apply-sql.sh` would have recorded.
2. `proctira_app` had no password in this container; one was set locally so live
   tests could connect as the runtime role rather than as `postgres`.

`apply-sql.sh` could **not** be used to bring the database to tip. See finding
`FEES-OPS-01` — this is a genuine cross-cutting defect, not an environment quirk.

---

## Step 1 — the module's real surface

Derived from code, not documents. The prompt warns a top-level glob understates
modules; `fees` was checked recursively and is genuinely flat (no subdirectories).

- **13** non-test sources: `create-fees-repository.ts`, `fees-access.ts`,
  `fees-http-guard.ts`, `fees-plugin.ts` (1,576 lines), `fees-repository.ts`,
  `fees-service.ts`, `in-memory-repository.ts`, `index.ts`,
  `instalment-schedule.ts`, `money-cents.ts`, `payment-adapter.ts`,
  `pg-fees-repository.ts`, `reminder-sandbox.ts`
- **2 live tests**: `pg-fees-ledger.live.test.ts`,
  `pg-fees-payment-concurrency.live.test.ts` — notable; many modules have none
- **36 routes** under `/fees` (see Step 2)
- **9 staff web routes**, **1 parent web route**, **1 real Flutter screen**
  (`apps/mobile/lib/features/parent_portal/presentation/parent_fees_screen.dart`)

### `mount-matrix.ts` is accurate for this module

`apps/api-gateway/src/mount-matrix.ts:331` declares `persistence: 'raw-pg'`,
`mounted: true`, `prefixes: ['/fees']`, `rbacWired: true`, and the note
_"Sandbox PSP only (G-202 waived)"_.

Verified against `create-fees-repository.ts`: `DATABASE_URL` set →
`new PgFeesRepository(pool)` guarded by `assertPostgresRepositoryAvailable('fees', …)`;
otherwise in-memory behind `assertInMemoryFallbackAllowed('fees')`.

**Contradiction: no.** This is worth stating plainly because the prompt flags
`auth`, `billing` and `developer-portal` as mislabelled — all three were
re-confirmed still mislabelled at this SHA (see `FEES-XREF-01`), but `fees` is not
among them, and its note honestly discloses the PSP limitation.

### Every persistence target is a real relation

The prompt requires proving each store name resolves to a real table rather than a
logical `collection` key. All **17** targets referenced by `pg-fees-repository.ts`
resolve with `relkind='r'`, `relrowsecurity=true` **and**
`relforcerowsecurity=true`:

```
enrollments  fee_concessions  fee_credit_notes  fee_ledger_entries
fee_reconciliation_batches  fee_reconciliation_rows  fee_refunds
fee_reminder_send_audits  fee_reminder_suppressions  fee_structure_components
fee_structure_instalments  fee_structures  fee_write_offs
parent_fee_invoices  parent_fee_payments  parent_fee_plans  parent_fee_receipts
```

No `auth.otp_challenges`-class problem exists in this module.

---

## Step 2 — vertical chain

`actor → UI → API → authz → service → repository → persistence/RLS → jobs/providers → audit → tests → deployment`

The chain is complete at every layer **except providers**. The 36 routes cover the
full lifecycle including the exception paths the prompt specifically asks about:

| Lifecycle stage | Routes                                                                                |
| --------------- | ------------------------------------------------------------------------------------- |
| Structure       | `POST /structures`, `/structures/:id/instalments`, `/structures/clone-period`         |
| Assignment      | `POST /plans`, `POST /structures/:id/bulk-invoice`                                    |
| Invoice         | `POST /invoices`, `GET /invoices`, `GET /invoices/:id/ledger`                         |
| **Collection**  | `POST /invoices/:id/pay`, `POST /payments` — **broken link: provider**                |
| Receipt         | `GET /receipts`, `GET /receipts/:id`                                                  |
| Refund          | `POST /invoices/:id/refund`                                                           |
| Reverse/amend   | `POST /invoices/:id/void`, `/credit-notes`, `/write-offs`                             |
| Concession      | `POST /concessions`, `/concessions/:id/approve`, `/concessions/:id/reject`            |
| Arrears/dunning | `GET /reminders/overdue`, `POST /reminders/send`, `/reminders/suppressions`, `/audit` |
| Reconciliation  | `POST /reconciliation/import`, `/rows/:id/resolve`, `GET /batches`                    |
| Scholarship     | `POST /scholarships/net`                                                              |
| Reporting       | `GET /reports/dues`, `GET /ledger/trial-balance`                                      |

**The single broken link is the provider at collection.** Every other layer is
present and verified. That distinction matters: this is a _missing dependency_,
not missing code, and the prompt requires those not be conflated.

`fees` is also consumed by admissions: `apps/api-gateway/src/domain-plugins.ts:257-271`
creates an invoice from an `admissions-offer`, linking this module to the offer→fee
step of the admissions lifecycle.

---

## Step 3 — the five dimensions

### 1. UX design — `partial`

Nine staff routes plus a parent route, all wired through a real API layer
(`@/lib/api/fees`) behind `requireSession()`. Ten interactive components exist:
`new-invoice-form`, `pay-invoice-staff-button`, `refund-dialog`,
`concession-dialog`, `dunning-console`, `reconciliation-workspace`,
`structures-workspace`, `new-fee-plan-form`, `scholarship-netting-form`,
`fees-reports-panel`. These are genuine Server Components fetching real data, not
placeholder screens.

**Gap — localization.** Only `fees/page.tsx` (the index) uses a translation hook.
The other eight subpages resolve no i18n at all: `h1` copy is hardcoded English
("Fee invoices", "Fee plans", "Fee receipts", "Fee reports"), and **6 sites**
hardcode `Intl.NumberFormat('en-IN')`. Money formatting is locale-locked to one
jurisdiction while the registration portal already ships `ar`/`es`/`fr`. For a
currency-bearing module this is a correctness issue, not cosmetics.

Empty/loading/error/permission-denied state coverage was **not** systematically
verified per route and is recorded `unverified` rather than guessed.

### 2. Functionality — `implemented` (except collection)

Every lifecycle stage has a route and a UI affordance, including reverse/amend
paths (`void`, `credit-note`, `write-off`, `refund`, concession `reject`) that are
commonly absent elsewhere in this repository. A staff actor can drive
structure → assignment → invoice → receipt → refund → arrears without a developer.

**Collection cannot complete against a real payment.** See dimension 5.

### 3. Integrity — `implemented` (live-verified)

This is the module's strongest dimension, and it is verified rather than inferred.

| Check                   | Result                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Money column typing     | every money column is `*_cents` `integer`; `fee_ledger_entries.amount_cents` is `bigint` |
| Non-integer money types | **none** — zero `numeric`/`float`/`decimal` money                                        |
| FK validation           | **zero unvalidated** FKs across all 16 fee tables                                        |
| `tenants(id)` FK        | present on **all 16** tables                                                             |
| `tenant_id` typing      | `uuid` on all 16 — not in the 23 text-tenant_id gap                                      |

Four live tests pass against `proctira_eval` as `proctira_app`:

```
✓ issue → pay posts two balanced journals and the trial balance nets to 0 AR
✓ recordPayment persists payment.amountCents === receipt.amountCents on re-read
✓ never double-receipts or over-pays an invoice under concurrent recordPayment
✓ database rejects an unbalanced journal at COMMIT and keeps it append-only
```

The fourth is the strongest single control found in this audit: the _database_
rejects an unbalanced journal at COMMIT, so double-entry balance does not depend
on application correctness.

### 4. Security — `implemented` (cross-tenant denial proven live)

The prompt forbids claiming security from unit tests. Proven live as
`proctira_app` on `parent_fee_invoices`:

| #   | Probe                                      | Expected        | Actual     |
| --- | ------------------------------------------ | --------------- | ---------- |
| 1   | tenant A reads own invoice                 | 1               | **1**      |
| 2   | tenant B reads tenant A's invoice          | 0 (isolated)    | **0**      |
| 3   | no `app.tenant_id` GUC set                 | 0 (fail-closed) | **0**      |
| 4   | `app.platform_admin='1'` escape attempt    | 0               | **0**      |
| 5   | tenant B `UPDATE`s tenant A's invoice      | 0 rows          | **0 rows** |
| 6   | amount after cross-tenant `UPDATE` attempt | unchanged       | **12345**  |

Probe 4 matters specifically: the prompt documents `app.platform_admin='1'` as a
**real, live-verified bypass** on `PgDocumentCollection`-backed tables where tenant
B read tenant A's row. **Zero** fees policies reference `platform_admin` — the
policy is a plain `tenant_id = current_setting('app.tenant_id')` match with an
identical `WITH CHECK`. Probes 5 and 6 confirm the write path is not merely
hidden but genuinely inert across tenants.

Per-resource (vs per-role) authorization depth in `fees-access.ts` /
`fees-http-guard.ts` was not exhaustively traced and is recorded `unverified`.

### 5. Production — `partial`

`assertInMemoryFallbackAllowed('fees')` and `assertPostgresRepositoryAvailable`
mean production cannot silently run on memory. Provider honesty is explicitly
engineered and executably verified — `payment-adapter-honesty.test.ts` passes 4/4:

```
✓ fails closed when PROVIDER_MODE=live (PSP adapter not implemented)
✓ sandbox still succeeds with sandbox reference
✓ W1-ARCH-08: throws when production would silently use sandbox PSP
✓ W1-ARCH-08: allows sandbox PSP in production with explicit opt-in
```

`SandboxPaymentAdapter.charge()` unconditionally returns `status:'succeeded'` with
a `sandbox-*` reference. `UnimplementedLivePaymentAdapter` returns
`status:'failed'` with `live-psp-unimplemented-refused-*`. `resolveProviderDeliveryMode`
(`packages/shared/common/src/provider-mode-policy.ts:63`) **throws** in production
when `PROVIDER_MODE` is unset.

This is the right design — it refuses to fake success — but the outcome stands:
**no real payment can be taken.** Zero `razorpay`/`stripe`/`twilio`/`sendgrid`/
`firebase-admin` dependencies exist in any `package.json`.

SLOs, alerts, runbook and multi-replica rollout behaviour were not assessed:
`unverified`.

---

## Step 5 — gap matrix

Columns verbatim from `gap-analysis.md` §5. One row per capability.

| Capability                                 | Current evidence                                                                                                                                                                                           | Evidence status                         | Contradiction                                                            | Maturity   | Expected enterprise state                                                               | Gap                                                                  | Impact                                                                                                                          | Recommendation                                                                                                                        | Dependencies                                              | Priority | Effort | Confidence |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------- | ------ | ---------- |
| **FEES-PAY-01** Fee collection             | `payment-adapter.ts`; `POST /fees/invoices/:id/pay`; `payment-adapter-honesty.test.ts` 4/4 pass; zero PSP deps                                                                                             | `absent` (provider)                     | no — matrix note discloses it                                            | thin       | A guardian pays and money moves at a real PSP with webhook settlement                   | No live PSP adapter or credentials; sandbox always succeeds          | Finance: no revenue can be collected. Fee UAT tests nothing                                                                     | Implement one live PSP adapter (idempotent charge + webhook reconciliation into `fee_ledger_entries`) behind `PROVIDER_MODE=live`     | PSP merchant account; secrets management; webhook ingress | **P0**   | L      | High       |
| **FEES-I18N-01** Localized money + copy    | 8 of 9 subpages use no translation hook; 6 hardcoded `Intl.NumberFormat('en-IN')`; hardcoded `h1` copy                                                                                                     | `partial`                               | no                                                                       | developed  | Currency and copy resolve per tenant locale; registration portal already ships ar/es/fr | Locale hardcoded to `en-IN`; staff copy English-only                 | Wrong currency formatting outside India; staff UI unusable in RTL/other locales                                                 | Route money formatting through a shared tenant-locale currency helper; move `h1`/labels to i18n keys                                  | Tenant locale resolution                                  | **P1**   | M      | High       |
| **FEES-OPS-01** Migration ledger drift     | `apply-sql.sh` W1-DATA-05 fail-closes: `checksum mismatch for 003_sis_timetable_schedule_schema.sql`; `3d045325` (#324) added comment-only lines to applied `003`/`024`                                    | `implemented` (gate) / defect (process) | **yes** — #324 titled `docs(db)` but changed applied-migration checksums | foundation | Applied migrations are immutable; drift is impossible or reconcilable                   | Any DB provisioned before #324 cannot run `apply-sql.sh` against tip | Ops: existing staging/prod environments blocked from schema updates. CI unaffected (fresh DB per run), so it is invisible in CI | Revert the comment edits to `003`/`024` and move the ownership notes to a new forward migration or a doc, per the tool's own guidance | none                                                      | **P1**   | S      | High       |
| **FEES-LEDGER-01** Double-entry integrity  | 4 live tests pass; DB rejects unbalanced journal at COMMIT; `fee_ledger_entries.amount_cents` `bigint`, append-only                                                                                        | `implemented`                           | no                                                                       | developed  | Balanced journals enforced by the database, not the app                                 | none found                                                           | —                                                                                                                               | Keep; extend live coverage to refund/write-off/credit-note journals                                                                   | none                                                      | P3       | S      | High       |
| **FEES-ISO-01** Tenant isolation           | 17/17 targets `relkind=r` + FORCE RLS; 6/6 live probes pass; zero `platform_admin` escapes                                                                                                                 | `implemented`                           | no                                                                       | developed  | Cross-tenant read and write denied under the runtime role                               | none found                                                           | —                                                                                                                               | Promote the 6 probes into a committed `.live.test.ts` so the proof is enforced, not ad-hoc                                            | none                                                      | P2       | S      | High       |
| **FEES-FK-01** Referential integrity       | zero unvalidated FKs; `tenants(id)` FK on all 16 tables; `tenant_id uuid`                                                                                                                                  | `implemented`                           | no                                                                       | developed  | Every tenant-scoped table has a validated `tenants(id)` FK                              | none found                                                           | —                                                                                                                               | Keep                                                                                                                                  | none                                                      | P3       | S      | High       |
| **FEES-AUTHZ-01** Per-resource authz depth | `fees-access.ts`, `fees-http-guard.ts` exist; `rbacWired: true`                                                                                                                                            | `unverified`                            | no                                                                       | —          | Authorization per resource, not only per role                                           | Not traced route-by-route in this pass                               | Unknown; potentially over-broad staff access to another student's finance rows                                                  | Enumerate all 36 routes × role × resource ownership and assert denial live                                                            | none                                                      | P2       | M      | Low        |
| **FEES-UX-01** Empty/loading/error states  | Pages are real Server Components; per-route state coverage not enumerated                                                                                                                                  | `unverified`                            | no                                                                       | —          | Every route handles empty, loading, error, permission-denied                            | Not enumerated                                                       | Unknown                                                                                                                         | Enumerate against `ENTERPRISE_UX_DESIGN_REVIEW.md` and capture screenshots                                                            | none                                                      | P2       | M      | Low        |
| **FEES-OPS-02** SLOs / alerts / runbook    | not assessed                                                                                                                                                                                               | `unverified`                            | no                                                                       | —          | Named SLO, alert, runbook per critical path                                             | Not assessed                                                         | Unknown operational readiness                                                                                                   | Assess against `ENTERPRISE_RELEASE_OPS_CHECKLIST.md`                                                                                  | observability                                             | P2       | M      | Low        |
| **FEES-XREF-01** Cross-module matrix drift | `auth`, `billing`, `developer-portal` still declare `persistence: 'in-memory'` while their factories return `HybridDeveloperPortalRepository` / `new PgBillingRepository(pool)` when `DATABASE_URL` is set | `partial`                               | **yes** — matrix vs runtime factory                                      | —          | `mount-matrix.persistence` matches runtime selection                                    | Three stale labels (not `fees`)                                      | Auditors mis-scope risk; the prompt's own warning depends on this being fixed                                                   | Correct the three labels, or derive the field from the factory                                                                        | none                                                      | P2       | S      | High       |

### Dispositions

| Finding        | Disposition                                  |
| -------------- | -------------------------------------------- |
| FEES-PAY-01    | `OPEN` — honestly gated, functionally absent |
| FEES-I18N-01   | `OPEN`                                       |
| FEES-OPS-01    | `OPEN` — introduced by merged `3d045325`     |
| FEES-LEDGER-01 | `FULLY_CLOSED` — live-verified               |
| FEES-ISO-01    | `FULLY_CLOSED` — live-verified               |
| FEES-FK-01     | `FULLY_CLOSED` — live-verified               |
| FEES-AUTHZ-01  | `EXTERNALLY_UNVERIFIED`                      |
| FEES-UX-01     | `EXTERNALLY_UNVERIFIED`                      |
| FEES-OPS-02    | `EXTERNALLY_UNVERIFIED`                      |
| FEES-XREF-01   | `OPEN`                                       |

---

## Step 6 — acceptance criteria

Executable conditions that would move each P0/P1 to `FULLY_CLOSED`.

**FEES-PAY-01 (P0)**

1. A `LivePaymentAdapter` exists and `createPaymentAdapterFromEnv` returns it when
   `PROVIDER_MODE=live`, with `UnimplementedLivePaymentAdapter` no longer reachable
   in that path.
2. `pnpm --filter @proctira/backend-fees exec vitest run src/pg-fees-live-psp.live.test.ts`
   passes against a PSP sandbox account, asserting: a charge produces exactly one
   `parent_fee_payments` row and one `parent_fee_receipts` row; a replayed webhook
   with the same provider reference produces **no** second row; and
   `GET /fees/ledger/trial-balance` still nets to 0 AR afterwards.
3. `payment-adapter-honesty.test.ts` continues to pass 4/4 unchanged.

**FEES-I18N-01 (P1)**

1. `grep -rn "Intl.NumberFormat('en-IN'" "apps/web/src/app/(dashboard)/fees"` returns **0**.
2. Every `page.tsx` under that directory resolves copy through `useTranslations`/`getTranslations`.
3. A test asserts a tenant with locale `ar` renders fee amounts in that locale's
   currency formatting and the page passes axe with `dir="rtl"`.

**FEES-OPS-01 (P1)**

1. `git show 3d045325 -- db/sql/003_sis_timetable_schedule_schema.sql db/sql/024_wave7_domain_persistence_schema.sql`
   is reverted, or both files are restored to their pre-#324 bytes.
2. On a database provisioned before `3d045325`,
   `APPLY_STRICT_FKS=1 bash tools/scripts/apply-sql.sh` completes with exit 0 and
   reports `applied=…, ledger_skipped=…` without any `W1-DATA-05 checksum mismatch`.
3. The ownership notes survive somewhere non-checksummed (a doc, or a new forward
   migration) so the knowledge is not lost.

---

## What this pass could not verify, and why

- **Real payment settlement** — no PSP credentials exist. `absent`, not `unverified`:
  the adapter is provably a stub.
- **Per-resource authorization across all 36 routes** — not traced. `unverified`.
- **Per-route empty/loading/error/permission states** — not enumerated. `unverified`.
- **SLOs, alerts, runbook, multi-replica rollout** — not assessed. `unverified`.
- **Whether fee calculation matches any school's policy** — needs the policy
  document and a bursar. Out of scope for a machine pass, per the UAT prompt's Part D.
- **`apply-sql.sh` end-to-end on this database** — blocked by `FEES-OPS-01`.
  `097` readiness was reconciled surgically instead; noted so the result is not
  over-read.

## Calibration note

One finding was nearly filed in error and is recorded as a caution. An initial grep
for `fetch(`/`onClick` across the fees pages returned zero and suggested a dead UI.
Reading `fees/invoices/page.tsx` directly disproved it: the pages are Server
Components fetching via `@/lib/api/fees` behind `requireSession()`, with four
interactive child components. The grep pattern, not the code, was wrong. Consistent
with this prompt's own calibration warning, pattern-match absence was not treated as
evidence of absence until the file was read.

## Deviation from prescribed sweep order

The prompt's sweep order places `audit` and `privacy` (group 1) before `fees`
(group 4). `fees` was evaluated first at the repository owner's direction. Group 1
foundation defects may therefore surface later and could affect conclusions here —
in particular `FEES-AUTHZ-01`, which depends on `auth` behaviour not yet evaluated.
