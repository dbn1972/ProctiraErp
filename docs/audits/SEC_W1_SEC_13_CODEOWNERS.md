# Security — CODEOWNERS domain split (W1-SEC-13)

**Module / slice:** `.github/CODEOWNERS` governance  
**Branch / tip:** `cursor/aud-w1-sec-13-codeowners-56c3`  
**Date (UTC):** 2026-09-14  
**Data classes:** N/A (repository governance)  
**Paired test audit:** N/A (static ownership file + this evidence pack)

---

## 0. Finding

| ID | Sev | Finding | Root cause |
| --- | --- | ------- | ---------- |
| W1-SEC-13 | P1 | CODEOWNERS routed all high-risk concerns to one person rather than qualified specialist teams | Personal-account repo (`dbn1972`); no GitHub Organization teams; every path listed `@dbn1972` without domain / path-owner documentation |

---

## 1. Remediation posture

GitHub **teams do not exist** for this repository (owner is a user, not an org). Inventing `@fake-org/security` (etc.) would break CODEOWNERS resolution and false-green branch protection.

**Therefore:**

1. Split CODEOWNERS into **domain sections** with stable path patterns: **security**, **data**, **ops**, **web**, plus **governance**.
2. Keep a repo-wide **fallback** (`* @dbn1972`) for unmatched paths.
3. Document **path owners** (human/role) and **intended team slugs** in CODEOWNERS comments and this audit — not as unresolved GitHub team handles.
4. GitHub-resolvable owner on every rule remains `@dbn1972` **until** an Organization with those teams is created and CODEOWNERS is updated to replace the interim identity.

---

## 2. Domain → path map

| Domain | Path patterns | Path owner (role) | Intended team (when org exists) |
| ------ | ------------- | ----------------- | -------------------------------- |
| **security** | `apps/api-gateway/` · `packages/shared/{auth,tenant,secrets}/` · `packages/backend/{auth,tenant,policy,audit,privacy,health,fees,billing,scholarship}/` | Security lead | `@proctira/security` |
| **data** | `db/sql/` · `packages/shared/database/` · `tools/scripts/{apply-sql,pg-backup,pg-restore,restore-drill}.sh` | Data / DBA lead | `@proctira/data` |
| **ops** | `.github/` · `infrastructure/` · `tools/supply-chain/` · `tools/scripts/audit-gate.mjs` | Platform / SRE lead | `@proctira/ops` |
| **web** | `apps/{web,admin-console,registration-portal,public-website,developer-portal,install-wizard,mobile}/` | Web / product eng lead | `@proctira/web` |
| **governance** | `docs/audits/` · `docs/runbooks/` · `CHANGELOG.md` | Program / release governance | `@proctira/governance` |
| **fallback** | `*` (unmatched) | Repository owner | `@dbn1972` (interim) |

PHI / money / scholarship packages sit under **security** (not a separate domain) so regulated surfaces share one specialist review lane.

---

## 3. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Domains split (security / data / ops / web) | ☑ | `.github/CODEOWNERS` section headers |
| Fallback retained | ☑ | leading `* @dbn1972` |
| No invented GitHub teams | ☑ | only `@dbn1972` as resolvable identity; team slugs in comments/docs only |
| Path owners documented | ☑ | CODEOWNERS comments + §2 table |
| Migration path to teams documented | ☑ | §4 |

---

## 4. Org-team cutover (when available)

1. Create a GitHub Organization (or transfer the repo) and teams: `security`, `data`, `ops`, `web`, `governance` (slugs as in §2).
2. Replace each domain’s `@dbn1972` entries in `.github/CODEOWNERS` with the matching `@<org>/<team>`.
3. Keep `* @dbn1972` (or `* @<org>/<fallback-maintainers>`) as the unmatched-path fallback.
4. Enable branch protection **Require review from Code Owners** on `main`.
5. Re-verify this audit: every high-risk path resolves to a **team**, not a single personal account.

---

## 5. Sign-off

| Claim | Status |
| ----- | ------ |
| P0 cleared | ☑ (N/A — governance P1) |
| W1-SEC-13 remediated within personal-account constraints | ☑ |
| Safe to merge from security/governance view | ☑ |

**Residual risks:**

- Until org teams exist, GitHub still notifies a single account for required owner reviews — specialist routing is **documented** (process/IA) and ready for cutover, not yet enforced by GitHub team membership.
- Branch protection “Require review from Code Owners” is out of scope for this file change; ops must enable it after teams exist (or accept interim single-owner reviews).
- New packages under regulated domains must be added to the matching CODEOWNERS section when created.

---

## 6. Follow-up (as-complete-as-possible)

See `docs/audits/SEC_W1_SEC_13_COMPLETE.md` for the fail-closed
`PROCTIRA_CODEOWNERS_TEAMS_READY` CI gate and mandatory org / branch-protection
ops residual. This pack alone does **not** claim Done criteria met.
