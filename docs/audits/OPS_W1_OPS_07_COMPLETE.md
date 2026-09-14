# OPS — W1-OPS-07 Flutter CI (COMPLETE)

**Module / slice:** Mobile Flutter repository CI (`apps/mobile`)  
**Branch:** `cursor/w1-ops-07-flutter-complete-56c3`
**Tip SHA:** `948235e58604294be06599f3e9d203ba32b21a85`
**Implementation SHA:** `0e178fe254bf4b18c4cc11390b482357c3c2bb84`
**Date (UTC):** 2026-09-14  
**Environment:** GitHub Actions (`ci.yml` + `mobile-flutter.yml`); Flutter **stable**

## Finding (PARTIAL → COMPLETE)

PR `#176` added a standalone path-filtered workflow
(`.github/workflows/mobile-flutter.yml`) that runs `flutter pub get` →
`flutter analyze` → `flutter test` under `apps/mobile`. That was **PARTIAL**:

1. The job lived outside **CI Aggregate**, so an incorrect path-filter skip on a
   mobile change could still leave the required merge gate green.
2. Concurrent DATA-01 / DATA-11 merges had mashed `runtime-table-privileges` /
   `runtime-role-gate` (and their aggregate entries) — the fail-closed skip
   cascade was not trustworthy until those jobs were restored as separate
   always-on gates.

## Done when (this PR)

| Criterion | Evidence |
| --------- | -------- |
| CI runs `flutter analyze` + `flutter test` for `apps/mobile` | `ci.yml` job `mobile-flutter` (+ standalone `mobile-flutter.yml`) |
| Path dep `packages/flutter-core/**` also triggers the job | `detect-changes` filter `mobile_flutter` |
| Job required / aggregated; fail-closed if skipped incorrectly | `ci-aggregate-gate.mjs` `mobileFlutterGate` + unit tests |
| COMPLETE pack with tip SHA + residuals | this file |

## Scope

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Path filter | `.github/workflows/ci.yml` `mobile_flutter` | `apps/mobile/**`, `packages/flutter-core/**`, harness |
| CI job | `.github/workflows/ci.yml` `mobile-flutter` | Flutter stable; analyze + test fail closed |
| Standalone | `.github/workflows/mobile-flutter.yml` | Push/PR visibility + `workflow_dispatch` |
| Aggregate | `tools/scripts/ci-aggregate-gate.mjs` | Required when `MOBILE_FLUTTER_CHANGED=true` |
| Tests | `tools/scripts/ci-aggregate-gate.test.mjs` | Unproven skip + proven skip cases |
| Repair | `runtime-table-privileges` / `runtime-role-gate` job split | Restore always-on DATA-11 / DATA-01 jobs |

## Invariants

1. When `mobile-flutter-changed=true`, `mobile-flutter` must **succeed** (not
   skip/cancel/fail) or **CI Aggregate (Required)** fails.
2. When the path filter is false, a skipped `mobile-flutter` job is a **proven**
   skip.
3. Working directory is `apps/mobile` (documented package path). Path dependency
   `packages/flutter-core/api-client` is included in the filter.
4. Device-farm / `integration_test/` device runs remain **out of scope**
   (aligned with PRD-007 waiver / prior mobile enterprise residual).

## Verify

```bash
node --test tools/scripts/ci-aggregate-gate.test.mjs
# On a runner with Flutter stable:
cd apps/mobile && flutter pub get && flutter analyze && flutter test
```

## Residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Android/iOS device-farm / emulator PNGs | **WAIVED** (PRD-007) — not claimed here |
| Standalone `mobile-flutter.yml` is not itself aggregated | **Accepted** — merge gate is `ci.yml` → CI Aggregate |
| Branch-protection UI must list **CI Aggregate (Required)** | Ops config outside this PR (same as other W1-OPS gates) |
| Flutter channel pinned to **stable** (not a fixed version SHA) | Accepted — matches `#176`; Dart must satisfy `^3.11.5` |

## Rollback

Revert this commit (or disable the `mobile-flutter` job + aggregate entry
together). Do not leave the path filter true without the aggregate gate.

## Sign-off

**Ops claim:** Flutter analyze + test are repository CI with fail-closed
aggregate coverage.  
**Status:** W1-OPS-07 **COMPLETE** (PARTIAL cleared).
