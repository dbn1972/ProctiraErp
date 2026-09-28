#!/usr/bin/env bash
# Canonical OCI repository for one Proctira service.
#
# Matches release.yml:
#   registry  = vars.CONTAINER_REGISTRY || ghcr.io
#   namespace = vars.IMAGE_NAMESPACE || github.repository_owner
# Prints:
#   <lowercase-registry>/<lowercase-namespace>/proctira/<lowercase-service>
#
# GHCR rejects mixed-case names (owner "ProctiraErp" must be "proctiraerp").
# Non-GHCR registries keep working: only case is normalized, the host is not
# rewritten to ghcr.io.
#
# Usage:
#   image-repository.sh <registry> <namespace> <service>
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: image-repository.sh <registry> <namespace> <service>" >&2
  exit 2
fi

lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

registry="$(lower "$1")"
namespace="$(lower "$2")"
service="$(lower "$3")"

registry="${registry%/}"
namespace="${namespace#/}"
namespace="${namespace%/}"
service="${service#/}"
service="${service%/}"

die() {
  echo "image-repository: $*" >&2
  exit 1
}

[[ -n "$registry" ]] || die "registry is empty"
[[ -n "$namespace" ]] || die "namespace is empty"
[[ -n "$service" ]] || die "service is empty"

# Host with optional port. No scheme and no repository path.
if [[ ! "$registry" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]+)?$ ]]; then
  echo "image-repository: registry '${registry}' is not a lowercase host[:port]" >&2
  exit 1
fi

# GitHub owner, or owner plus one extra registry path segment.
if [[ ! "$namespace" =~ ^[a-z0-9]([a-z0-9._-]*[a-z0-9])?(/[a-z0-9]([a-z0-9._-]*[a-z0-9])?)?$ ]]; then
  echo "image-repository: namespace '${namespace}' is not a lowercase registry path" >&2
  exit 1
fi

if [[ "$namespace" == *..* ]]; then
  echo "image-repository: namespace '${namespace}' must not contain '..'" >&2
  exit 1
fi

if [[ ! "$service" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
  echo "image-repository: service '${service}' is not a lowercase name" >&2
  exit 1
fi

printf '%s/%s/proctira/%s\n' "$registry" "$namespace" "$service"
