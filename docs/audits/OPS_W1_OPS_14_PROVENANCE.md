# W1-OPS-14 — Image provenance & required signing

**Slice:** Wave-1 ops / supply chain  
**Branch:** `cursor/aud-w1-ops-14-provenance-56c3`  
**Date (UTC):** 2026-09-14

## Finding

Production image workflows set `provenance: false` and gated keyless cosign
behind optional repository variable `SUPPLY_CHAIN_SIGN_IMAGES`, so major builds
could ship unsigned images without SLSA provenance attestations.

## Closed

| Change | Evidence |
| ------ | -------- |
| `release.yml` build matrix: `provenance: mode=max`, `sbom: true` | `.github/workflows/release.yml` |
| `release.yml`: keyless cosign sign + verify **required** (no variable opt-out) | same |
| `supply-chain.yml` `sign-image`: provenance + SBOM + required cosign on non-PR | `.github/workflows/supply-chain.yml` |
| `signing-skipped` only on `pull_request` (honest residual, not soft prod skip) | same |
| Regression guard fails if those workflows reintroduce `provenance: false` | `tools/scripts/check-image-provenance-required.sh` + advisory-gate step |
| Docs + audit updated | `docs/SUPPLY_CHAIN.md`, this file |

## Residual (honest)

- Local Docker / compose builds remain unsigned (developer loop).
- PR supply-chain runs advisory + SBOM only; cannot push or OIDC-sign.
- `deploy.yml` / restore-drill image builds are not the production release
  matrix; promote via signed `release.yml` digests.
- Lockfile CycloneDX SBOM still omits OS packages; BuildKit SBOM attestation
  covers image layers on production pushes.

## Sign-off

**Ship claim:** Ready for merge of workflow/docs remediation (CI tip verification
follows PR checks). Not a claim that every historical GHCR tag is re-signed.
