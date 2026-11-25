#!/usr/bin/env bash
# =============================================================================
# PRC-M623 (N2) — pre-deploy key-presence check for the PHI retention CronJob.
# =============================================================================
# With secrets.existingSecret the chart cannot see the Secret's contents, so a
# missing PHI_RETENTION_DATABASE_URL key renders cleanly and the CronJob pod
# only fails later with CreateContainerConfigError. This reads the rendered
# platform manifest, finds the Secret name and key the phi-retention CronJob's
# DATABASE_URL references, and fails unless that key exists and is non-empty
# in the cluster. The value never leaves kubectl: the go-template prints only
# the word "present".
#
# Usage (repo root):
#   bash tools/scripts/deploy-platform-helm.sh template > "$RUNNER_TEMP/platform.yaml"
#   bash tools/scripts/check-phi-retention-secret-key.sh "$RUNNER_TEMP/platform.yaml"
#
# Env:
#   KUBECTL   kubectl binary (default: kubectl; tests use a stub)
# Exit 0 when the key is present or no phi-retention CronJob is rendered.
# =============================================================================
set -euo pipefail

KUBECTL="${KUBECTL:-kubectl}"
MANIFEST="${1:-}"

die() {
  echo "::error::check-phi-retention-secret-key: $*" >&2
  exit 1
}

[[ -n "$MANIFEST" && -f "$MANIFEST" ]] || die "usage: check-phi-retention-secret-key.sh <rendered-manifest.yaml>"
# An empty file means the render failed; never read that as "nothing to check".
grep -q '^kind: ' "$MANIFEST" || die "${MANIFEST} holds no rendered manifests"

# Print "<namespace> <secret name> <key>" for the DATABASE_URL secretKeyRef of
# the CronJob whose metadata.name ends in -phi-retention.
ref="$(awk '
  /^---/ { kind=""; name=""; ns=""; secret=""; want=0 }
  /^kind: / { kind=$2 }
  kind == "CronJob" && /^  name: / { name=$2 }
  kind == "CronJob" && /^  namespace: / { ns=$2 }
  kind == "CronJob" && name ~ /-phi-retention$/ && /- name: DATABASE_URL$/ { want=1; next }
  want && /name: / && secret == "" { secret=$2; next }
  want && /key: / { print ns, secret, $2; exit }
' "$MANIFEST")"

if [[ -z "$ref" ]]; then
  echo "check-phi-retention-secret-key: SKIP (no phi-retention CronJob rendered)"
  exit 0
fi

read -r namespace secret key <<<"$ref"
[[ -n "$namespace" && -n "$secret" && -n "$key" ]] \
  || die "could not read the phi-retention CronJob DATABASE_URL secretKeyRef from ${MANIFEST}"

set +e
status="$("$KUBECTL" get secret "$secret" -n "$namespace" \
  -o "go-template={{ if index .data \"${key}\" }}present{{ else }}missing{{ end }}" 2>/dev/null)"
rc=$?
set -e
[[ "$rc" -eq 0 ]] || die "cannot read Secret ${namespace}/${secret} (kubectl exit ${rc})"
[[ "$status" == "present" ]] \
  || die "Secret ${namespace}/${secret} has no non-empty key ${key}; the phi-retention CronJob would fail with CreateContainerConfigError. Add the proctira_phi_retention URL under ${key} (docs/BACKUP_RESTORE.md 3.5) before deploying."

echo "check-phi-retention-secret-key: PASS (${namespace}/${secret} has key ${key})"
