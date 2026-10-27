#!/usr/bin/env bash
# =============================================================================
# W1-OPS-17 — Production replica / PDB coherence gate
# =============================================================================
# Fails when Helm production values or Kustomize production overlays drift below
# the canonical HA floors in infrastructure/ops/production-replica-policy.yaml.
# PRC-L567: also fails when two PDBs select the same app in any overlay, or a
# development PDB keeps minAvailable >= 1 while development forces replicas=1.
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
# PRC-L567: PDBs are resolved the way kustomize renders them. Resource PDBs come
# from `resources:` (recursing into ../../base and components); a strategic-merge
# patch file (`patches: - path:` without target) overrides the resource PDB of the
# same metadata.name instead of adding a second PDB over the same pods.
K8S = root / "infrastructure/k8s"

def load_docs(path: Path) -> list:
    return [d for d in yaml.safe_load_all(path.read_text(encoding="utf-8")) if d]

def kustomization(kdir: Path) -> dict:
    kfile = kdir / "kustomization.yaml"
    return yaml.safe_load(kfile.read_text(encoding="utf-8")) if kfile.exists() else {}

def resource_pdbs(kdir: Path) -> list:
    k = kustomization(kdir)
    out: list = []
    for rel in (k.get("resources") or []):
        p = (kdir / rel).resolve()
        if p.is_dir():
            out += resource_pdbs(p)
        elif p.suffix in (".yaml", ".yml") and p.exists():
            out += [d for d in load_docs(p) if d.get("kind") == "PodDisruptionBudget"]
    for rel in (k.get("components") or []):
        out += resource_pdbs((kdir / rel).resolve())
    return out

def smp_pdb_patches(kdir: Path) -> list:
    out: list = []
    for patch in (kustomization(kdir).get("patches") or []):
        if isinstance(patch, dict) and patch.get("path") and not patch.get("target"):
            p = kdir / patch["path"]
            if p.exists():
                out += [d for d in load_docs(p) if d.get("kind") == "PodDisruptionBudget"]
    return out

def json_pdb_ops(kdir: Path) -> list:
    """JSON6902 ops of patches that target every PodDisruptionBudget (no name)."""
    ops: list = []
    for patch in (kustomization(kdir).get("patches") or []):
        target = patch.get("target") if isinstance(patch, dict) else None
        if target and target.get("kind") == "PodDisruptionBudget" and not target.get("name"):
            ops += yaml.safe_load(patch.get("patch") or "[]") or []
    return ops

def selector_app(doc: dict) -> str | None:
    sel = ((doc.get("spec") or {}).get("selector") or {}).get("matchLabels") or {}
    return sel.get("app.kubernetes.io/name")

def effective_pdbs(kdir: Path, overlay: str) -> list:
    """Resource PDBs with same-name strategic-merge patches applied (spec merge)."""
    pdbs = [dict(d, spec=dict(d.get("spec") or {})) for d in resource_pdbs(kdir)]
    by_name = {(d.get("metadata") or {}).get("name"): d for d in pdbs}
    for patch in smp_pdb_patches(kdir):
        name = (patch.get("metadata") or {}).get("name")
        if name not in by_name:
            errors.append(
                f"kustomize {overlay}: PDB patch {name} matches no PDB resource (PRC-L567)"
            )
            continue
        by_name[name]["spec"].update(patch.get("spec") or {})
    return pdbs

overlays = [o for o in ("development", "staging", "production", "lab-split") if (K8S / "overlays" / o).is_dir()]
for overlay in overlays:
    seen: dict[str, int] = {}
    for doc in effective_pdbs(K8S / "overlays" / overlay, overlay):
        app = selector_app(doc)
        if app:
            seen[app] = seen.get(app, 0) + 1
    for app, count in sorted(seen.items()):
        if count > 1:
            errors.append(
                f"kustomize {overlay}: {count} PDBs select app.kubernetes.io/name={app}; "
                "overlapping PDBs block every eviction (PRC-L567)"
            )

# PRC-L567: development forces replicas to 1, so a PDB with minAvailable >= 1
# would block every voluntary disruption.
dev_dir = K8S / "overlays/development"
if dev_dir.is_dir():
    dev_text = (dev_dir / "kustomization.yaml").read_text(encoding="utf-8")
    dev_single = re.search(
        r"(?m)^  - target:\n      kind: Deployment\n    patch: \|\n      - op: replace\n        path: /spec/replicas\n        value: 1\s*$",
        dev_text,
    )
    if dev_single:
        ops = json_pdb_ops(dev_dir)
        removes_min = any(
            o.get("op") == "remove" and o.get("path") == "/spec/minAvailable" for o in ops
        )
        for doc in effective_pdbs(dev_dir, "development"):
            min_av = (doc.get("spec") or {}).get("minAvailable")
            if min_av is not None and not removes_min and int(min_av) >= 1:
                errors.append(
                    f"kustomize development PDB {(doc.get('metadata') or {}).get('name')} "
                    f"minAvailable={min_av} with replicas=1 blocks every eviction (PRC-L567)"
                )

pdb_by_app: dict[str, int] = {}
for doc in effective_pdbs(K8S / "overlays/production", "production"):
    name = selector_app(doc)
    min_av = (doc.get("spec") or {}).get("minAvailable")
    if name and min_av is not None:
        pdb_by_app[name] = int(min_av)

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
    for e in dict.fromkeys(errors):
        print(f"  - {e}", file=sys.stderr)
    sys.exit(1)

print("check-replica-policy: W1-OPS-17 OK")
PY
