# Runbook — Helm deploy rollback (W1-OPS-09)

**Owner:** platform / SRE  
**Supported deploy mode:** **single-wave** Helm release per service  
(`helm upgrade --install … --atomic --wait` via `.github/workflows/deploy.yml`)  
**Progressive delivery:** optional annotation hooks only — **not** a production
canary/Flagger/Argo path in this repo. Do not claim live canary proof from tip CI.

---

## 1. What “atomic” means here

| Path | Atomic behaviour |
| ---- | ---------------- |
| Deploy (`deploy.yml`) | `helm upgrade --install … --atomic --wait --timeout 300s` — failed release **auto-rolls back** to the prior successful revision |
| Manual rollback → prior revision | `helm rollback proctira-<svc> <rev>` (revision `0` = previous) — one Helm release transaction + `kubectl rollout status` |
| Manual rollback → known-good tag | `helm upgrade … --atomic --wait` to a previous image tag |

Single-wave progressive baseline (chart default):

- `strategy.type: RollingUpdate`
- `rollingUpdate.maxUnavailable: 0` (never drop ready pods before replacements)
- `progressiveDelivery.canary.enabled: false` by default

---

## 2. Automated rollback (preferred)

GitHub Actions → **Actions → Rollback** (`.github/workflows/rollback.yml`):

| Input | Guidance |
| ----- | -------- |
| `environment` | `staging` or `production` (GitHub Environment protection applies) |
| `services` | Comma-separated chart services, e.g. `api-gateway,web` |
| `revision` | Helm revision (`0` = previous successful). Ignored if `image_tag` set |
| `image_tag` | Optional known-good tag; uses `--atomic --wait` instead of `helm rollback` |
| `dry_run` | **Defaults to `true`** (fail-closed / plan-only). Set `false` only to apply |

Dry-run prints the exact Helm commands and exits 0 without cluster access.

Apply (`dry_run=false`) requires `secrets.KUBECONFIG` for the target Environment;
missing kubeconfig fails the job (no soft-success).

Local / CI dry-run gate (no cluster):

```bash
./tools/scripts/deploy-rollback-check.sh
```

Wired in `.github/workflows/helm-template.yml` alongside Helm template checks.

---

## 3. Operator CLI (break-glass)

```bash
NAMESPACE=proctira-staging   # or proctira-production
RELEASE=proctira-api-gateway

helm history "$RELEASE" -n "$NAMESPACE"
helm rollback "$RELEASE" 0 -n "$NAMESPACE" --wait --timeout 300s
kubectl rollout status "deployment/${RELEASE}" -n "$NAMESPACE" --timeout=120s
```

Known-good image tag (same flags as deploy):

```bash
helm upgrade --install "$RELEASE" ./infrastructure/helm/proctira-service \
  --namespace "$NAMESPACE" \
  --set image.repository="${REGISTRY}/proctira/api-gateway" \
  --set image.tag="<known-good-sha>" \
  --set environment=staging \
  --set service.name=api-gateway \
  --values ./infrastructure/helm/proctira-service/values-staging.yaml \
  --atomic --wait --timeout 300s
```

---

## 4. When **not** to use image rollback alone

| Situation | Prefer |
| --------- | ------ |
| App regression, schema unchanged | This runbook (Helm revision / prior tag) |
| Bad migration / data shape | [database-migration-rollback](./database-migration-rollback.md) first |
| Provider outage (IdP / PSP / SMTP) | Kill switch / sandbox honesty — not Helm rollback |

---

## 5. Progressive delivery residual (honesty)

Optional chart values stamp Flagger/Argo-style annotations when
`progressiveDelivery.canary.enabled=true`. **No controller, AnalysisTemplate,
or production canary exercise is proven in this repository.** Ship path remains
single-wave RollingUpdate + atomic Helm. Enabling canary without an installed
progressive-delivery controller is a no-op for traffic splitting.
