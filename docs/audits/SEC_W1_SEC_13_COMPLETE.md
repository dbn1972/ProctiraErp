# Security — W1-SEC-13 CODEOWNERS as-complete-as-possible

**Module / slice:** `.github/CODEOWNERS` + fail-closed CI gate  
**Branch / tip:** `cursor/w1-sec-13-codeowners-complete-56c3`  
**Date (UTC):** 2026-09-14  
**Prior pack:** `docs/audits/SEC_W1_SEC_13_CODEOWNERS.md` (domain split)  
**Paired gate:** `tools/scripts/check-codeowners.mjs` (wired in `ci.yml`)

---

## 0. Verdict

**OPEN → as-complete-as-possible** on personal-account repo `dbn1972/proctiraerp`.

| Done criteria | Status on this tip |
| ------------- | ------------------ |
| Resolvable qualified **teams** own security / privacy / RLS / migrations / finance / infra paths | **Not met** — owner type is `User`; no GitHub Organization teams |
| Required Code Owner review enabled on protected `main` | **Not met** — branch-protection API returns 403 to this agent; ops must enable **Require review from Code Owners** |

| Honest limit controls | Status |
| --------------------- | ------ |
| CODEOWNERS structured with documented team slugs (comments, not inventable live handles) | ☑ |
| Fail-closed CI gate blocks silent fake `@org/team` owners unless `PROCTIRA_CODEOWNERS_TEAMS_READY=1` | ☑ |
| Organization-owned repos fail closed until `PROCTIRA_CODEOWNERS_TEAMS_READY=1` | ☑ |
| Residual that org/team + branch protection is a **mandatory ops step** | ☑ (this document) |

Do **not** claim W1-SEC-13 fully closed until both Done criteria are green after org cutover.

---

## 1. Finding (remaining)

| ID | Sev | Remaining | Root cause |
| --- | --- | --------- | ---------- |
| W1-SEC-13 | P1 | All specialist ownership rules still resolve to one personal account (`@dbn1972`); specialist headings are comments, not teams | Personal-account repository cannot host GitHub teams; inventing `@proctira/*` on ownership lines would be silently ignored without a gate |

---

## 2. What this tip ships

| Artifact | Path | Role |
| -------- | ---- | ---- |
| CODEOWNERS | `.github/CODEOWNERS` | Domain sections (security / data / ops / web / governance); intended `@proctira/*` slugs in comments only; live owners `@dbn1972` |
| Gate | `tools/scripts/check-codeowners.mjs` | Fail closed on fake teams; require READY=1 for org + team ownership |
| Tests | `tools/scripts/check-codeowners.test.mjs` | Personal pass / fake-team fail / org-without-READY fail / READY team path |
| CI | `.github/workflows/ci.yml` job `codeowners-gate` | Always-on; included in `ci-aggregate` |
| Evidence | this file + `SEC_W1_SEC_13_CODEOWNERS.md` | Residual honesty |

### Specialist path coverage (live owners interim)

| Concern | Path pattern(s) | Interim owner | Intended team |
| ------- | --------------- | ------------- | ------------- |
| Security | `packages/backend/auth/`, `packages/shared/secrets/`, … | `@dbn1972` | `@proctira/security` |
| Privacy | `packages/backend/privacy/` | `@dbn1972` | `@proctira/security` |
| RLS / migrations | `db/sql/`, `packages/shared/database/` | `@dbn1972` | `@proctira/data` |
| Finance | `packages/backend/{fees,billing,scholarship}/` | `@dbn1972` | `@proctira/security` |
| Infra | `.github/`, `infrastructure/` | `@dbn1972` | `@proctira/ops` |

---

## 3. `PROCTIRA_CODEOWNERS_TEAMS_READY`

Repo / org Actions **variable** (not a secret):

| Value | Gate behavior |
| ----- | ------------- |
| unset / `0` | Ownership lines **must not** contain `@org/team` handles. Domain comments must document intended slugs. Personal interim ownership allowed. |
| `1` | Specialist paths **must** list team owners; core domains security/data/ops must appear as teams on rules. |

Organization owner type (`GITHUB_OWNER_TYPE=Organization`) **requires** `PROCTIRA_CODEOWNERS_TEAMS_READY=1` (fail closed) so an org transfer cannot greenwash personal-only CODEOWNERS forever.

---

## 4. Org cutover checklist (mandatory ops)

1. Create / transfer to a GitHub Organization; create teams `security`, `data`, `ops`, `web`, `governance`.
2. Replace domain `@dbn1972` entries in `.github/CODEOWNERS` with `@<org>/<team>` (keep a fallback `*`).
3. Set Actions variable `PROCTIRA_CODEOWNERS_TEAMS_READY=1`.
4. Enable branch protection on `main`: **Require a pull request before merging** + **Require review from Code Owners**.
5. Confirm CI job `Codeowners Gate (W1-SEC-13)` passes with READY=1.
6. Re-sign this audit: Done criteria both ☑.

---

## 5. Verify

```bash
node --test tools/scripts/check-codeowners.test.mjs
node tools/scripts/check-codeowners.mjs
# After org cutover:
PROCTIRA_CODEOWNERS_TEAMS_READY=1 GITHUB_OWNER_TYPE=Organization \
  node tools/scripts/check-codeowners.mjs
```

---

## 6. Sign-off

| Claim | Status |
| ----- | ------ |
| Fake-team silent ownership prevented by CI | ☑ |
| Domain / path-owner IA documented | ☑ |
| Done criteria (teams + Code Owner protection) | ☐ residual — ops |
| Safe to merge as **as-complete-as-possible** | ☑ |

**Residual risks (honest):**

- Until Organization teams exist and `PROCTIRA_CODEOWNERS_TEAMS_READY=1`, GitHub still notifies a single personal account for required owner reviews.
- **Require review from Code Owners** on protected `main` is a mandatory ops configuration step; this agent cannot enable or prove it (API 403).
- New regulated packages must be added to the matching CODEOWNERS domain when created.
