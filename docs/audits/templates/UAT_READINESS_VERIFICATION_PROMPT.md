# UAT readiness verification prompt — school and board

Purpose: establish whether ProctiraERP fulfils a **school's** and a **board's** ERP
requirement, and how close it is to UAT, using verification that only exhaustive
machine analysis can perform.

This is not the per-module prompt. Use `MODULE_DEEP_EVALUATION_PROMPT.md` for depth
on one module. Use this one for whole-product readiness.

---

## Why an AI pass is worth running at all

A human auditor samples. They open twelve screens, read four modules, and
extrapolate. That extrapolation is where readiness assessments go wrong. The four
techniques below are the ones where exhaustive traversal changes the answer, not
just the speed.

### 1. Exhaustive enumeration, not sampling

Traverse the **complete** cross-product and report the empty cells:

- 39 backend modules × 243 tables — who writes what
- 55 mounted API prefixes × every route × every RBAC rule
- 202 web pages + 17 admin + 8 registration + 28 Flutter screens × every backend
  capability — which capabilities have no UI, which UI has no backend
- Every actor role × every lifecycle state — which transitions no role can perform

A human cannot hold 243×39 in their head. The finding is usually in the empty cell.

### 2. Declared versus actual

The highest-yield class of defect in this repository. Systematically diff what the
code _claims_ against what it _does_:

| Declared in                      | Compare against                              | Known to have drifted                                               |
| -------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| `mount-matrix.ts` `persistence`  | the runtime repository factory               | `auth`, `billing`, `developer-portal` all mislabelled `in-memory`   |
| `db/sql/NNN_<name>.sql` filename | the module that actually writes those tables | `transcript_issuances` in timetable's file, owned by gradebook      |
| Table name prefix                | the owning service                           | `report_card_*` owned by assessment, not report                     |
| `docs/audits/*_COMPLETE.md`      | tip behaviour                                | 247 audit docs, several describe superseded states                  |
| A gate reporting **pass**        | what the gate actually queries               | W1-DATA-06 skipped 23 tables because it filtered `data_type='uuid'` |

A human reads the declaration and believes it. Cross-referencing every declaration
against every implementation is mechanical and therefore reliable.

### 3. Differential verification

Run the identical probe against two states and diff:

- Two independently provisioned databases — this is how a `DROP TABLE` migration
  was caught: `periods` is `relkind='v'`, a compatibility **view**, and the second
  database exposed it when the first had not
- Branch versus `main`
- A gate before and after a synthetic violation, to prove it fails closed

### 4. Negative space

Enumerate what is **absent**. Humans notice what exists.

- A package directory with no `src/` — `alumni`, `canteen`, `finance`, `inventory`,
  `payroll` contain only `node_modules`
- A capability with no dependency — no `razorpay`/`stripe`/`twilio`/`sendgrid`/
  `firebase-admin` in any `package.json`
- A standard with **zero** references — verify with `grep -w`, because substring
  matching gives false positives (`SIF` and `LTI` each returned 34 and 204 hits
  that were all noise; word-boundary count is 0)
- A module with no `.live.test.ts`
- A lifecycle state no UI can reach

---

## Mandatory method

> Audit the current tip commit of ProctiraERP. Record the SHA.
>
> **Every structural claim must be executed against a live, migrated database**,
> not inferred from source. Bootstrap per
> `.kiro/steering/sis-reliability-delivery-context.md`, apply all `db/sql` with
> `APPLY_STRICT_FKS=1`, and connect as `proctira_app` (NOSUPERUSER, NOBYPASSRLS) so
> isolation assertions are real.
>
> When inspecting a relation, **check `relkind`**. `to_regclass` returning non-NULL
> does not mean a table exists. Views, sequences and matviews all resolve.
>
> When counting references, use word boundaries and inspect a sample of hits before
> reporting a count.
>
> Classify every finding as `implemented` / `partial` / `absent` / `unverified`, and
> every remediation as `FULLY_CLOSED` / `PARTIAL` / `OPEN` / `REGRESSED` /
> `EXTERNALLY_UNVERIFIED`. When unsure, do not close.

## Part A — does it fulfil a _school's_ requirement?

A school's ERP requirement is the daily operational loop. For each, name the actor,
trace the full lifecycle, and state whether it completes today without a developer.

| Capability                          | Must complete end to end                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| Admission                           | enquiry → application → offer → fee → enrolment → roll number                  |
| Daily attendance                    | mark → correct → escalate → notify guardian → monthly return                   |
| Assessment                          | scheme → marks entry → moderation → report card → publish to guardian          |
| Examination                         | timetable → seating → invigilation → marks → result → re-evaluation            |
| Fee                                 | structure → assignment → invoice → **collection** → receipt → refund → arrears |
| Timetable                           | subject/teacher load → generate → clash resolve → substitution                 |
| Staff                               | recruit → onboard → attendance → leave → appraisal → **payroll**               |
| Transport                           | route → stop → allocation → attendance → guardian tracking                     |
| Library, hostel, health, discipline | issue/return, allocation, PHI consent, incident                                |
| Guardian communication              | announcement, fee reminder, absence alert, report card                         |
| Transfer out                        | TC generation, records archive, retention/erasure                              |

For each, state explicitly: which step **breaks**, and whether it breaks on missing
code, missing UI, missing provider, or missing verification. Those need different
fixes and must not be conflated.

## Part B — does it fulfil a _board's_ requirement?

A board is not a bigger school. Verify these separately, because they are a
different product surface and currently the weaker half.

| Board capability          | What to verify                                                                                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-school oversight    | Can one board actor read across N institutions **without** binding a single tenant? Trace against `institutions`, `geographic_areas`, `boards`, `board_codes`. Determine whether a school is a tenant or a row — this decides the entire isolation model |
| Affiliation lifecycle     | apply → inspect → grant → renew → suspend. Does any table or route exist?                                                                                                                                                                                |
| Statutory returns         | Does **any** government return format exist? Confirmed at tip: **zero** references to UDISE+, APAAR, DIKSHA, NDEAR, CEDS, OneRoster, Ed-Fi (word-boundary verified). `board_export_jobs` exists but is referenced only by `gradebook`                    |
| Board examination conduct | centre allocation, question paper custody, cross-school invigilation, moderation, result declaration at scale                                                                                                                                            |
| Consolidated analytics    | cross-school comparison, cohort trends, dropout tracking                                                                                                                                                                                                 |
| Data sovereignty          | residency, retention, cross-border rules for minor data                                                                                                                                                                                                  |

State whether "board" is an implemented product surface, an aspiration, or a
mislabelled multi-tenant school deployment. Do not assume the presence of a `boards`
table implies board capability.

## Part C — UAT readiness

Define UAT readiness as: **a real user can attempt a real workflow on a deployed
environment with their own data, and a failure means a product defect rather than a
missing dependency or an unconfigured environment.**

By that definition, verify and report:

1. **Is anything deployed?** UAT cannot begin on a developer machine.
2. **Can the workflow's external dependencies transact?** A fee UAT where payment is
   a sandbox stub tests nothing. Same for any SMS/email confirmation step.
3. **Can a tester self-serve?** Tenant creation, user invite, role assignment,
   password reset, MFA enrolment — without a developer running SQL.
4. **Is the data real?** Can a school import its own students, staff, structure?
5. **Is failure diagnosable?** Will a tester's bug report contain enough to act on —
   correlation id, audit trail, error surfaced in UI rather than a 500?
6. **Is it safe to put real child data in?** Tenant isolation, PHI controls,
   retention, and consent must hold before real names enter the system.

Score per workflow, not per module, using: `UAT_READY` /
`UAT_BLOCKED_BY_DEPENDENCY` / `UAT_BLOCKED_BY_DEFECT` / `NOT_UAT_CANDIDATE`. A
module can be well-built and still not be a UAT candidate if step 1 or 2 fails.

## Part D — what this pass cannot determine

State these as `unverified` rather than guessing. An AI pass that claims them is
worse than one that omits them.

- Whether a workflow matches how a school actually operates. Needs a registrar.
- Whether a statutory return satisfies the regulator. Needs the published spec and
  usually a submission portal.
- Whether a fee, grade or attendance calculation matches policy. Needs the policy.
- Whether the UX is usable. Needs observed sessions, not route enumeration.
- Whether performance is acceptable. Needs representative data volume.
- UAT sign-off itself. That is a user decision.

## Required output

```text
docs/audits/UAT_READINESS_<YYYY-MM-DD>.md
```

Containing: audited SHA; environment and what was executed; Part A table with the
breaking step per school workflow; Part B verdict on whether board is a real
surface; Part C per-workflow UAT score; Part D explicit non-findings; and a
prioritised list separating _missing dependency_ from _missing code_ from _missing
verification_.

## Calibration warning

Two confident findings in the first pass of this method were wrong, both caught only
by executing against a second database:

- `periods` reported as a stray dead table safe to drop. It is a compatibility
  **view** over `bell_periods`, read by 8 files. `relkind` was never checked.
- `tenant_theme_drafts` reported as an inconsistent `ON DELETE CASCADE`. Its
  `tenant_id` is the **primary key**, so CASCADE is correct.

Treat every output of this prompt as a hypothesis list requiring live confirmation
before anyone acts on it. The value of an AI pass is breadth of candidate findings,
not certainty of each one.
