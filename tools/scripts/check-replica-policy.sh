#!/usr/bin/env bash
# =============================================================================
# W1-OPS-17 — Production replica / PDB coherence gate
# =============================================================================
# Fails when Helm production values or Kustomize production overlays drift below
# the canonical HA floors in infrastructure/ops/production-replica-policy.yaml.
#
# Usage (repo root):
#   ./tools/scripts/check-replica-policy.sh
#   ROOT=/path/to/fixture ./tools/scripts/check-replica-policy.sh
# =============================================================================
set -euo pipefail

ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

die() {
  echo "check-replica-policy: $*" >&2
  exit 1
}

need() {
  [[ -f "$1" ]] || die "missing required file: $1"
}

POLICY=infrastructure/ops/production-replica-policy.yaml
PLATFORM_PROD=infrastructure/helm/proctira-platform/values-production.yaml
THIN_PROD=infrastructure/helm/proctira-service/values-production.yaml
KUST_PROD=infrastructure/k8s/overlays/production/kustomization.yaml
KUST_PDB=infrastructure/k8s/overlays/production/pod-disruption-budget.yaml
AUDIT=docs/audits/OPS_W1_OPS_17_REPLICAS.md

need "$POLICY"
need "$PLATFORM_PROD"
need "$THIN_PROD"
need "$KUST_PROD"
need "$KUST_PDB"
need "$AUDIT"
need infrastructure/k8s/base/kustomization.yaml

command -v python3 >/dev/null 2>&1 || die "python3 required"

python3 - "$ROOT" <<'PY'
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("check-replica-policy: PyYAML required", file=sys.stderr)
    sys.exit(1)

root = Path(sys.argv[1])
errors: list[str] = []

def load(rel: str):
    return yaml.safe_load((root / rel).read_text(encoding="utf-8"))

policy = load("infrastructure/ops/production-replica-policy.yaml")
ha = policy["haServices"]
floor = policy["thinChartFloor"]

# Helm key mapping (camelCase in platform values)
HELM_KEYS = {
    "api-gateway": "apiGateway",
    "web": "web",
    "etl-worker": "etlWorker",
    "registration-portal": "registrationPortal",
    "public-website": "publicWebsite",
    "admin-console": "adminConsole",
    "developer-portal": "developerPortal",
}

platform = load("infrastructure/helm/proctira-platform/values-production.yaml")
thin = load("infrastructure/helm/proctira-service/values-production.yaml")

# --- Thin chart floor --------------------------------------------------------
if int(thin.get("replicaCount", 0)) < int(floor["replicaCount"]):
    errors.append(
        f"proctira-service values-production replicaCount={thin.get('replicaCount')} "
        f"< floor {floor['replicaCount']}"
    )
ascaling = thin.get("autoscaling") or {}
if ascaling.get("enabled") and int(ascaling.get("minReplicas", 0)) < int(floor["minReplicas"]):
    errors.append(
        f"proctira-service values-production minReplicas={ascaling.get('minReplicas')} "
        f"< floor {floor['minReplicas']}"
    )
pdb = thin.get("podDisruptionBudget") or {}
if not pdb.get("enabled"):
    errors.append("proctira-service values-production must enable podDisruptionBudget")
else:
    min_av = pdb.get("minAvailable")
    if min_av is not None:
        if int(min_av) < int(floor["pdbMinAvailable"]):
            errors.append(
                f"proctira-service PDB minAvailable={min_av} < floor {floor['pdbMinAvailable']}"
            )
        if int(min_av) >= int(thin.get("replicaCount", 0)):
            errors.append(
                f"proctira-service PDB minAvailable={min_av} must be < replicaCount="
                f"{thin.get('replicaCount')} (W1-OPS-17 coherence)"
            )

# --- Platform production values ----------------------------------------------
for svc, expect in ha.items():
    key = HELM_KEYS[svc]
    block = platform.get(key) or {}
    reps = int(block.get("replicaCount", 0))
    if reps < int(expect["replicas"]):
        errors.append(
            f"platform values-production {key}.replicaCount={reps} < policy {expect['replicas']}"
        )
    hpa_exp = expect.get("hpa") or {}
    if hpa_exp.get("enabled"):
        hpa = block.get("autoscaling") or {}
        if not hpa.get("enabled"):
            errors.append(f"platform values-production {key}.autoscaling must be enabled")
        else:
            mn = int(hpa.get("minReplicas", 0))
            mx = int(hpa.get("maxReplicas", 0))
            if mn < int(hpa_exp["minReplicas"]):
                errors.append(
                    f"platform {key}.autoscaling.minReplicas={mn} < policy {hpa_exp['minReplicas']}"
                )
            if mx < int(hpa_exp["maxReplicas"]):
                errors.append(
                    f"platform {key}.autoscaling.maxReplicas={mx} < policy {hpa_exp['maxReplicas']}"
                )
            if mn < reps:
                errors.append(
                    f"platform {key}: HPA minReplicas={mn} < replicaCount={reps} "
                    "(HPA must not scale below HA floor)"
                )
    pdb_exp = expect.get("pdb") or {}
    pdb_b = block.get("podDisruptionBudget") or {}
    if not pdb_b.get("enabled"):
        errors.append(f"platform values-production {key}.podDisruptionBudget must be enabled")
    else:
        min_av = int(pdb_b.get("minAvailable", 0))
        if min_av < int(pdb_exp["minAvailable"]):
            errors.append(
                f"platform {key}.pdb.minAvailable={min_av} < policy {pdb_exp['minAvailable']}"
            )
        if min_av >= reps:
            errors.append(
                f"platform {key}: PDB minAvailable={min_av} must be < replicaCount={reps}"
            )

# --- Kustomize production patches + base + PDB -------------------------------
kust_text = (root / "infrastructure/k8s/overlays/production/kustomization.yaml").read_text(
    encoding="utf-8"
)
pdb_docs = list(
    yaml.safe_load_all(
        (root / "infrastructure/k8s/overlays/production/pod-disruption-budget.yaml").read_text(
            encoding="utf-8"
        )
    )
)
pdb_by_app: dict[str, int] = {}
for doc in pdb_docs:
    if not doc or doc.get("kind") != "PodDisruptionBudget":
        continue
    labels = (doc.get("metadata") or {}).get("labels") or {}
    name = labels.get("app.kubernetes.io/name")
    if name:
        pdb_by_app[name] = int(doc["spec"]["minAvailable"])

def patch_value(kind: str, name: str, path: str) -> int | None:
    """Extract JSON-patch value from kustomize overlay text."""
    # Split on "- target:" blocks
    blocks = re.split(r"(?m)^  - target:\n", kust_text)
    for block in blocks[1:]:
        if f"kind: {kind}" not in block:
            continue
        if f"name: {name}\n" not in block and f"name: {name}\r" not in block:
            # allow end-of-string
            if not re.search(rf"name:\s*{re.escape(name)}\s*$", block, re.M):
                continue
        # find path/value pair
        m = re.search(
            rf"path:\s*{re.escape(path)}\s*\n\s*value:\s*(\d+)",
            block,
        )
        if m:
            return int(m.group(1))
    return None

def base_replicas(svc: str) -> int:
    dep = root / f"infrastructure/k8s/base/{svc}/deployment.yaml"
    if not dep.exists():
        errors.append(f"missing base deployment for {svc}")
        return 0
    data = yaml.safe_load(dep.read_text(encoding="utf-8"))
    return int(data["spec"]["replicas"])

def base_hpa(svc: str) -> tuple[int | None, int | None]:
    hpa_path = root / f"infrastructure/k8s/base/{svc}/hpa.yaml"
    if not hpa_path.exists():
        return None, None
    data = yaml.safe_load(hpa_path.read_text(encoding="utf-8"))
    return int(data["spec"]["minReplicas"]), int(data["spec"]["maxReplicas"])

for svc, expect in ha.items():
    want = int(expect["replicas"])
    patched = patch_value("Deployment", svc, "/spec/replicas")
    effective = patched if patched is not None else base_replicas(svc)
    if effective < want:
        errors.append(
            f"kustomize production {svc} replicas={effective} < policy {want} "
            "(base or missing production patch)"
        )

    hpa_exp = expect.get("hpa") or {}
    if hpa_exp.get("enabled"):
        base_min, base_max = base_hpa(svc)
        if base_min is None:
            errors.append(f"kustomize base missing HPA for HA service {svc}")
        else:
            pmin = patch_value("HorizontalPodAutoscaler", svc, "/spec/minReplicas")
            pmax = patch_value("HorizontalPodAutoscaler", svc, "/spec/maxReplicas")
            emin = pmin if pmin is not None else base_min
            emax = pmax if pmax is not None else base_max
            if emin < int(hpa_exp["minReplicas"]):
                errors.append(
                    f"kustomize production {svc} HPA minReplicas={emin} "
                    f"< policy {hpa_exp['minReplicas']}"
                )
            if emax is not None and emax < int(hpa_exp["maxReplicas"]):
                errors.append(
                    f"kustomize production {svc} HPA maxReplicas={emax} "
                    f"< policy {hpa_exp['maxReplicas']}"
                )
            if emin < effective:
                errors.append(
                    f"kustomize {svc}: HPA minReplicas={emin} < deployment replicas={effective}"
                )

    if svc not in pdb_by_app:
        errors.append(f"kustomize production missing PDB for {svc}")
    else:
        min_av = pdb_by_app[svc]
        want_pdb = int(expect["pdb"]["minAvailable"])
        if min_av < want_pdb:
            errors.append(
                f"kustomize PDB {svc} minAvailable={min_av} < policy {want_pdb}"
            )
        if min_av >= effective:
            errors.append(
                f"kustomize PDB {svc} minAvailable={min_av} must be < replicas={effective}"
            )

# Refuse production overlay that leaves base single-replica HA services unpatched
# when base is below policy (belt-and-suspenders with effective check above).
for svc, expect in ha.items():
    if base_replicas(svc) < int(expect["replicas"]):
        if patch_value("Deployment", svc, "/spec/replicas") is None:
            errors.append(
                f"kustomize production must patch Deployment/{svc} replicas "
                f"(base={base_replicas(svc)} < policy {expect['replicas']})"
            )

if errors:
    print("check-replica-policy: FAIL (W1-OPS-17)", file=sys.stderr)
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    sys.exit(1)

print("check-replica-policy: W1-OPS-17 OK")
PY
