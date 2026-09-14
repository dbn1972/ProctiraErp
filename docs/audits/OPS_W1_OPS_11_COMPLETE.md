# OPS — W1-OPS-11 COMPLETE (SAST / secrets / IaC / container CVE gates)

**Module / slice:** Repo security-scan CI pack (PARTIAL → COMPLETE)  
**Branch / tip:** `cursor/w1-ops-11-scans-complete-56c3` @ `889743c520469638b91f52807745a0ac10a2e363` (implementation) · docs tip follows branch HEAD  
**Date (UTC):** 2026-09-14  
**Prior:** `#179` added standalone `.github/workflows/security-scans.yml` (PARTIAL — not in CI Aggregate)

---

## Finding (PARTIAL residual)

`#179` shipped gitleaks + Semgrep + Trivy config + Trivy filesystem CVE jobs in a
**standalone** Security Scans workflow. That pack was **not** wired into
`ci.yml` → `ci-aggregate` / `ci-aggregate-gate.mjs`, so branch protection on
**CI Aggregate (Required)** could go green while scanners were skipped, removed,
or soft-failed outside the merge gate. No static contract failed closed when
scanners went missing.

## Done when (this PR)

| Criterion | Evidence |
| --------- | -------- |
| SAST + secret + IaC + container CVE (FS equivalent) in CI | `security-scans.yml` jobs; `ci.yml` `uses: ./.github/workflows/security-scans.yml` |
| Wired into aggregate gate | `ci-aggregate` `needs: security-scans` + `SECURITY_SCANS_RESULT` + always-required gate in `ci-aggregate-gate.mjs` |
| Fail-closed when scanners missing / softened | `tools/scripts/check-security-scans-required.sh` (first job in scan pack) |
| COMPLETE audit with tip SHA + residuals | this file |

## Scope

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Scan pack | `.github/workflows/security-scans.yml` | `workflow_call` + schedule/dispatch; contract + 4 scanners + summary |
| CI wire | `.github/workflows/ci.yml` | Reusable call + aggregate `needs` |
| Aggregate | `tools/scripts/ci-aggregate-gate.mjs` | `security-scans` always required |
| Contract | `tools/scripts/check-security-scans-required.sh` | Fail closed on missing / soft-pass scanners |
| Tests | `tools/scripts/ci-aggregate-gate.test.mjs` | Skip of `security-scans` fails docs-only PRs |
| Audit | this file | |

### Scanner map

| Gate | Tool | Block policy |
| ---- | ---- | ------------ |
| Secrets | gitleaks | `--exit-code 1`, `continue-on-error: false` |
| SAST | Semgrep `p/typescript` + `p/javascript` + `p/security-audit` | `--severity ERROR --error` |
| IaC | Trivy `config` on `infrastructure/` | HIGH+ → `exit-code: 1` |
| Container CVE (PR/main equivalent) | Trivy `fs` vuln/secret/misconfig | CRITICAL → `exit-code: 1` |

## Invariants

1. `ci.yml` must call `.github/workflows/security-scans.yml` via `workflow_call`.
2. `ci-aggregate` must `needs: security-scans` and pass `SECURITY_SCANS_RESULT`.
3. Aggregate evaluates `security-scans` with `requiredWhen: () => true` (skip = fail).
4. Scan steps must not use `continue-on-error: true`.
5. `check-security-scans-required.sh` must PASS before scanner jobs run.

## Apply / verify

```bash
bash tools/scripts/check-security-scans-required.sh
node --test tools/scripts/ci-aggregate-gate.test.mjs
```

## Collateral fix (main tip corruption)

`origin/main` had mashed `runtime-table-privileges` / `runtime-role-gate` YAML and a
single aggregate gate object overwriting `codeowners-gate` → `runtime-role-gate`.
Those jobs are restored as separate always-on gates so aggregate fail-closed remains
honest while adding W1-OPS-11.

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Full OCI **image-digest** CVE of published GHCR tags still needs registry login / built image | **Accepted** — covered on non-PR by `supply-chain.yml` `sign-image`; FS scan is the documented PR/main aggregate equivalent |
| Semgrep community rules only (no paid Semgrep App / custom Pro ruleset) | **Accepted** — no third-party secret required |
| Trivy FS `ignore-unfixed: true` may omit unfixed CRITICAL noise | **Accepted** — prefer actionable fail signal |
| Weekly schedule on `security-scans.yml` is catch-up only; merge gate is CI Aggregate | By design |
| Branch-protection UI must list **CI Aggregate (Required)** (not each scanner) | Ops config outside repo |

## Rollback

Revert this PR. That re-opens PARTIAL (standalone scans without aggregate wire).

## Sign-off

**Ops claim:** W1-OPS-11 **PARTIAL → COMPLETE** — scanners present, fail-closed contract, wired into CI Aggregate.
