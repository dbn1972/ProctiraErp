# OPS — W1-OPS-08 COMPLETE (immutable app image tags + naming)

**Module / slice:** Prod deploy image tags (kustomize / Helm / deploy / release / compose)  
**Branch / tip:** `cursor/w1-ops-08-images-complete-56c3` @ `TIP_SHA_PENDING`  
**Date (UTC):** 2026-09-14  
**Prior status:** PARTIAL (k8s `:sha-pending` + kustomize component; Helm/deploy/release still used mutable `latest` / hyphenated `proctira-<svc>`)  
**This status:** **COMPLETE**

## Finding (residual closed)

Image naming was inconsistent (`proctira/<service>` in k8s/Helm vs `proctira-<service>` in release/supply-chain), and deployment assets still retained mutable `:latest` for app images (`proctira-service` Helm default, `deploy.yml` dual-tag push, `release.yml` `latest` on main).

## Done when (this PR)

| Criterion | Evidence |
| --------- | -------- |
| Deploy manifests / kustomize / Helm / compose prod paths do not use mutable `:latest` for **app** images | k8s `sha-pending`; Helm `tag: sha-pending`; compose apps use `build:`; gate below |
| Image naming consistent (`proctira/<service>`) | release + supply-chain aligned to slash form; k8s/Helm/deploy already slash |
| CI gate fails on `:latest` in prod deploy paths | `tools/scripts/check-no-latest-image-tags.sh` (+ Vitest fixtures; wired via `helm-template-check.sh`) |
| Audit with tip SHA + residuals | this file |

## Scope

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Helm default | `infrastructure/helm/proctira-service/values.yaml` | `tag: sha-pending` (was `latest`) |
| Deploy | `.github/workflows/deploy.yml` | Push immutable tag only (dropped `:latest`) |
| Release | `.github/workflows/release.yml` | `proctira/<service>`; no `value=latest` |
| Supply-chain | `.github/workflows/supply-chain.yml` | `…/proctira/api-gateway` |
| Gate | `tools/scripts/check-no-latest-image-tags.sh` | k8s + Helm + workflows + compose app images |
| Tests | `tools/scripts/__tests__/check-no-latest-image-tags.test.ts` | pass + fail fixtures |
| Docs | `.github/README.md`, `infrastructure/k8s/README.md`, `docs/SUPPLY_CHAIN.md` | Canonical naming |
| Audit | this file | |

## Invariants

1. No `image: …:latest` under `infrastructure/k8s/**`.
2. No `tag: latest` (or `image: …:latest`) under `infrastructure/helm/**`.
3. `deploy.yml` / `release.yml` / `supply-chain.yml` do not publish app images as `:latest`.
4. OCI repository path for app images is `proctira/<service>` (slash), not `proctira-<service>`.
5. Compose files do not pin `proctira/*:latest` app images (apps build from Dockerfiles).

## Apply / verify

```bash
./tools/scripts/check-no-latest-image-tags.sh
# or via Helm Template workflow / helm-template-check.sh
pnpm exec vitest run tools/scripts/__tests__/check-no-latest-image-tags.test.ts
```

## Residuals (honest)

| Residual | Status |
| -------- | ------ |
| Third-party compose images may still use vendor tags (e.g. `minio/minio:latest`) | **Accepted** — not Proctira app images; pin opportunistically |
| Branch-name tags on release (`:main`, `:develop`) remain mutable convenience refs | **Accepted** — prod Helm/kustomize/deploy must use `sha-*` / digest |
| `deploy.yml` image path is `{REGISTRY}/proctira/<svc>`; release uses `{REGISTRY}/{IMAGE_NAMESPACE}/proctira/<svc>` | **Accepted** — both use slash `proctira/<svc>`; org prefix follows existing registry vars |
| Historical GHCR tags named `proctira-<svc>:latest` are not deleted | **Accepted** — new pushes stop publishing them; consumers must cut over |

## Rollback

Revert this PR to restore Helm `tag: latest`, deploy dual-tag `:latest`, and hyphenated release image names (not recommended).

## Sign-off

**Ops claim:** W1-OPS-08 **COMPLETE** — prod deploy paths refuse mutable `:latest` for app images; naming is `proctira/<service>`; CI gate + fixtures prevent regression.
