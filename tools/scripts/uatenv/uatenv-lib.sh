#!/usr/bin/env bash
# Shared helpers for the UAT EC2 environment scripts (docs/testing/uat/UAT_ENVIRONMENT.md).
# Source it; do not execute it.
#
# Layout (UATENV_HOME, default: the task folder on this host):
#   runtime/releases/<sha>/   app source extracted with `git archive` (build context)
#   runtime/current           symlink to the deployed release
#   runtime/tooling/          copy of tools/scripts/uatenv + infrastructure/uat-ec2
#   runtime/generated/        rendered nginx config (no secrets)
#   runtime/state/            deployed.json
#   runtime/logs/             script logs
#   secrets/                  mode 700; env files, realm import, users, gpg key (mode 600)
#   backups/                  mode 700; encrypted nightly dumps
#   evidence/                 drill and health results
#
# Secrets rule: never `set -x`, never echo a value, never put one on argv.
# Values travel through env vars or stdin only.

UATENV_PROJECT="proctira-uatenv"
UATENV_HOME="${UATENV_HOME:-$HOME/ProctiraErp/.agents/tasks/ProctiraErp-uat-environment-ec2}"
UATENV_RT="$UATENV_HOME/runtime"
UATENV_SEC="$UATENV_HOME/secrets"
UATENV_BACKUPS="$UATENV_HOME/backups"
UATENV_EVIDENCE="$UATENV_HOME/evidence"
UATENV_GIT_DIR="${UATENV_GIT_DIR:-$HOME/ProctiraErp}"
UATENV_CORE_APPS=(api-gateway etl-worker exam-document-worker web registration-portal)
UATENV_SECONDARY_APPS=(public-website admin-console developer-portal install-wizard)
UATENV_DATASTORES=(postgres redis rabbitmq kafka minio)
# Every host port the stack may publish (127.0.0.1 only).
UATENV_PORTS=(29010 29012 29016 29020 29021 29030 29031 29032 29033 29034 29035 29036 29040 29041 29080)

uatenv_log() {
  printf '%s [uatenv] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

uatenv_die() {
  uatenv_log "ERROR: $*"
  exit 1
}

# Parse KEY=VALUE lines and export them without shell evaluation.
load_env_file() {
  local file="$1" line
  [[ -f "$file" ]] || uatenv_die "env file missing: $file"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      export "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
    fi
  done <"$file"
}

# Read one key from an env file without exporting the others.
env_file_get() {
  local file="$1" key="$2" line
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "$key="* ]]; then
      printf '%s' "${line#*=}"
      return 0
    fi
  done <"$file"
  return 1
}

# Retry ~/bin/server-guard.sh (or UATENV_GUARD_CMD) until the host has headroom.
uatenv_guard() {
  local guard="${UATENV_GUARD_CMD:-$HOME/bin/server-guard.sh}" i
  [[ -x "$guard" ]] || return 0
  for i in $(seq 1 "${UATENV_GUARD_RETRIES:-30}"); do
    if "$guard" </dev/null >/dev/null 2>&1; then
      return 0
    fi
    uatenv_log "server guard busy (attempt $i); waiting 60s"
    sleep 60
  done
  uatenv_die "server guard still failing; not starting heavy work"
}

# Refuse any docker target that is not ours.
assert_uatenv_only() {
  local name
  for name in "$@"; do
    [[ "$name" == "$UATENV_PROJECT"* ]] || uatenv_die "refusing to touch non-UAT docker object: $name"
  done
}

# Every UAT port must be free or held by one of our containers.
assert_ports_free() {
  local port owners
  for port in "${UATENV_PORTS[@]}"; do
    if ss -ltnH "sport = :$port" | grep -q .; then
      owners="$(docker ps --filter "publish=$port" --format '{{.Names}}')"
      if [[ -z "$owners" ]] || grep -qv "^$UATENV_PROJECT-" <<<"$owners"; then
        uatenv_die "port $port is in use by something other than $UATENV_PROJECT (${owners:-host process})"
      fi
    fi
  done
}

# Require the operator to type an exact word on stdin.
confirm_typed() {
  local word="$1" prompt="${2:-Type '$1' to continue: }" reply=''
  printf '%s' "$prompt" >&2
  IFS= read -r reply || true
  [[ "$reply" == "$word" ]] || uatenv_die "confirmation not given; nothing changed"
}

uatenv_release_dir() {
  local sha="${1:-}"
  if [[ -n "$sha" ]]; then
    printf '%s' "$UATENV_RT/releases/$sha"
  else
    [[ -L "$UATENV_RT/current" ]] || uatenv_die "no deployed release (runtime/current missing)"
    readlink -f "$UATENV_RT/current"
  fi
}

# docker compose for the UAT project. UATENV_RELEASE selects the release dir
# (default: runtime/current). Shell env wins over --env-file in compose
# interpolation, so the tag and paths always follow the selected release.
uatenv_compose() {
  local rel="${UATENV_RELEASE:-$(uatenv_release_dir)}"
  local sha
  sha="$(basename "$rel")"
  local files=(-f "$rel/docker-compose.yml" -f "$UATENV_RT/tooling/infrastructure/uat-ec2/docker-compose.uatenv.yml")
  if [[ "${UATENV_PUBLIC_TLS:-0}" == "1" ]]; then
    files+=(-f "$UATENV_RT/tooling/infrastructure/uat-ec2/docker-compose.uatenv-public.yml")
  fi
  UATENV_TAG="${sha:0:12}" \
    UATENV_SHA="$sha" \
    UATENV_RUNTIME_DIR="$UATENV_RT" \
    UATENV_SECRETS_DIR="$UATENV_SEC" \
    docker compose -p "$UATENV_PROJECT" --project-directory "$rel" "${files[@]}" \
    --env-file "$UATENV_SEC/uatenv.env" "$@"
}

uatenv_profile_args() {
  if [[ "${UATENV_WITH_SECONDARY:-0}" == "1" ]]; then
    printf '%s\n' --profile secondary
  fi
}

uatenv_apps() {
  printf '%s\n' "${UATENV_CORE_APPS[@]}"
  if [[ "${UATENV_WITH_SECONDARY:-0}" == "1" ]]; then
    printf '%s\n' "${UATENV_SECONDARY_APPS[@]}"
  fi
}

# Wait until each service's container reports healthy.
wait_healthy() {
  local timeout="${UATENV_HEALTH_TIMEOUT:-600}" svc cname status start
  for svc in "$@"; do
    cname="$UATENV_PROJECT-$svc-1"
    assert_uatenv_only "$cname"
    start=$SECONDS
    while :; do
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cname" 2>/dev/null || echo missing)"
      [[ "$status" == "healthy" ]] && break
      if ((SECONDS - start > timeout)); then
        uatenv_die "$svc not healthy after ${timeout}s (status: $status); see: docker logs $cname"
      fi
      sleep 5
    done
    uatenv_log "$svc healthy"
  done
}

# Split a postgresql:// URL into PG* env vars (bootstrap-db-roles.sh pattern),
# then run psql with no credential on argv. Usage: uatenv_psql URL [psql args...]
uatenv_psql() {
  local url="$1"
  shift
  (
    eval "$(CONN_URL="$url" python3 -c '
import os, shlex, urllib.parse
u = urllib.parse.urlparse(os.environ["CONN_URL"])
out = {"PGHOST": u.hostname or "", "PGPORT": str(u.port or 5432),
       "PGUSER": urllib.parse.unquote(u.username or ""),
       "PGPASSWORD": urllib.parse.unquote(u.password or ""),
       "PGDATABASE": urllib.parse.unquote(u.path.lstrip("/")) or "postgres"}
for k, v in out.items():
    print("export " + k + "=" + shlex.quote(v))
')"
    psql -X -v ON_ERROR_STOP=1 "$@"
  )
}

# postgresql:// URL with the password removed (for tools that take a URL on
# argv; the password then comes from PGPASSWORD).
uatenv_url_without_password() {
  CONN_URL="$1" python3 -c '
import os, urllib.parse
u = urllib.parse.urlparse(os.environ["CONN_URL"])
netloc = (u.username or "") + "@" + (u.hostname or "") + (":" + str(u.port) if u.port else "")
print(urllib.parse.urlunparse(u._replace(netloc=netloc)))
'
}

uatenv_url_password() {
  CONN_URL="$1" python3 -c '
import os, sys, urllib.parse
sys.stdout.write(urllib.parse.unquote(urllib.parse.urlparse(os.environ["CONN_URL"]).password or ""))
'
}

uatenv_require_tools() {
  local t
  for t in docker git psql pg_dump python3 node openssl curl ss; do
    command -v "$t" >/dev/null 2>&1 || uatenv_die "$t is required on the host"
  done
}

# Install the scripts and overlay the running stack uses into runtime/tooling.
# Source: --tooling-ref <git ref> (git archive) or the checkout this file lives in.
uatenv_install_tooling() {
  local ref="${1:-}" src tmp
  tmp="$(mktemp -d "$UATENV_RT/tooling.new.XXXXXX")"
  if [[ -n "$ref" ]]; then
    git -C "$UATENV_GIT_DIR" archive "$ref" tools/scripts/uatenv infrastructure/uat-ec2 | tar -x -C "$tmp"
  else
    src="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
    mkdir -p "$tmp/tools/scripts" "$tmp/infrastructure"
    cp -R "$src/tools/scripts/uatenv" "$tmp/tools/scripts/"
    cp -R "$src/infrastructure/uat-ec2" "$tmp/infrastructure/"
  fi
  rm -rf "$UATENV_RT/tooling.old"
  [[ -d "$UATENV_RT/tooling" ]] && mv "$UATENV_RT/tooling" "$UATENV_RT/tooling.old"
  mv "$tmp" "$UATENV_RT/tooling"
  chmod 755 "$UATENV_RT/tooling"
  rm -rf "$UATENV_RT/tooling.old"
  uatenv_log "tooling installed into runtime/tooling${ref:+ from $ref}"
}

# Extract <sha> from the shared git object store (never touches a working tree).
uatenv_extract_release() {
  local sha="$1" dest="$UATENV_RT/releases/$1"
  git -C "$UATENV_GIT_DIR" cat-file -e "$sha^{commit}" 2>/dev/null || uatenv_die "commit $sha not found in $UATENV_GIT_DIR"
  if [[ -f "$dest/package.json" ]]; then
    uatenv_log "release $sha already extracted"
    return 0
  fi
  rm -rf "$dest.tmp"
  mkdir -p "$dest.tmp"
  git -C "$UATENV_GIT_DIR" archive "$sha" | tar -x -C "$dest.tmp"
  mv "$dest.tmp" "$dest"
  uatenv_log "release $sha extracted"
}

# Host pnpm install in the release (migrations + Playwright run from here).
uatenv_pnpm_install() {
  local rel="$1" log
  if [[ -f "$rel/node_modules/.modules.yaml" ]]; then
    uatenv_log "pnpm install already done for $(basename "$rel")"
    return 0
  fi
  uatenv_guard
  log="$UATENV_RT/logs/pnpm-install-$(basename "$rel" | cut -c1-12)-$(date -u +%Y%m%dT%H%M%SZ).log"
  uatenv_log "pnpm install --frozen-lockfile (log: $log)"
  (cd "$rel" && CI=1 timeout 2400 pnpm install --frozen-lockfile >"$log" 2>&1) || uatenv_die "pnpm install failed; see $log"
}

# Build images one at a time (guarded) from the Release Dockerfiles.
uatenv_build_images() {
  local rel="$1" svc log
  shift
  for svc in "$@"; do
    uatenv_guard
    log="$UATENV_RT/logs/build-$svc-$(date -u +%Y%m%dT%H%M%SZ).log"
    uatenv_log "building $svc (log: $log)"
    (
      export UATENV_RELEASE="$rel" BUILDKIT_PROGRESS=plain UATENV_PROJECT UATENV_RT UATENV_SEC
      export -f uatenv_compose uatenv_release_dir uatenv_die uatenv_log
      timeout 3600 bash -c 'uatenv_compose build "$1"' _ "$svc"
    ) >"$log" 2>&1 || uatenv_die "build of $svc failed; see $log"
  done
}

# Amazon Linux 2023 ships gnupg2-minimal: no gpg-agent (no key generation or
# decryption) and no --trust-model (backup-crypto.sh uses it). Without sudo,
# take gpg + gpg-agent from the signed full gnupg2 package of the same version
# into runtime/bin (rpm -K must pass) and point the keyring at that agent.
uatenv_gnupg_tools() {
  local bin="$UATENV_RT/bin" ver tmp
  export PATH="$bin:$PATH"
  mkdir -p "$GNUPGHOME"
  chmod 700 "$GNUPGHOME"
  if [[ ! -x "$bin/gpg-agent" ]] && ! command -v gpg-agent >/dev/null 2>&1; then
    ver="$(rpm -q --qf '%{VERSION}-%{RELEASE}' gnupg2-minimal 2>/dev/null)" \
      || uatenv_die "gpg-agent missing and gnupg2-minimal not found; install gnupg2 or age"
    tmp="$(mktemp -d)"
    (cd "$tmp" && dnf download -q --setopt=cachedir="$tmp/cache" "gnupg2-$ver" >/dev/null) \
      || uatenv_die "dnf download gnupg2-$ver failed"
    rpm -K "$tmp"/gnupg2-*.rpm | grep -q 'digests signatures OK' || uatenv_die "gnupg2 rpm signature check failed"
    (cd "$tmp" && rpm2cpio gnupg2-*.rpm | cpio -idm --quiet ./usr/bin/gpg ./usr/bin/gpg-agent)
    mkdir -p "$bin"
    install -m 755 "$tmp/usr/bin/gpg" "$tmp/usr/bin/gpg-agent" "$bin/"
    rm -rf "$tmp"
    uatenv_log "installed gpg + gpg-agent $ver (signed Amazon Linux gnupg2 rpm) into runtime/bin"
  fi
  if [[ -x "$bin/gpg-agent" ]]; then
    (umask 077 && printf 'agent-program %s\n' "$bin/gpg-agent" >"$GNUPGHOME/gpg.conf")
  fi
}

# UATENV-D01 stop-gap: re-generate the Prisma engine for OpenSSL 3 when a
# backend image still carries only the OpenSSL 1.1 musl engine (see
# infrastructure/uat-ec2/Dockerfile.prisma-openssl3). No-op once fixed on main.
uatenv_patch_prisma_openssl() {
  local rel="$1" svc img log probe
  shift
  for svc in "$@"; do
    case "$svc" in api-gateway | etl-worker | exam-document-worker) ;; *) continue ;; esac
    img="proctira/$svc:uatenv-$(basename "$rel" | cut -c1-12)"
    if [[ "$(docker image inspect -f '{{index .Config.Labels "com.proctira.uatenv.patch"}}' "$img" 2>/dev/null)" == prisma-openssl3 ]]; then
      continue
    fi
    probe="$(docker run --rm --name "oth-uat-env-probe-$svc-$$" --entrypoint sh "$img" -c \
      'ls /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/ 2>/dev/null | grep -c "^libquery_engine-linux-musl-openssl-3" ; ls /lib/libssl.so.1.1 /usr/lib/libssl.so.1.1 2>/dev/null | wc -l')"
    if [[ "$(head -1 <<<"$probe")" != 0 || "$(tail -1 <<<"$probe")" != 0 ]]; then
      uatenv_log "$svc: Prisma engine matches the runtime OpenSSL; no patch needed"
      continue
    fi
    uatenv_guard
    log="$UATENV_RT/logs/patch-prisma-$svc-$(date -u +%Y%m%dT%H%M%SZ).log"
    uatenv_log "UATENV-D01: $svc has only the OpenSSL 1.1 Prisma engine; adding the OpenSSL 3 engine layer (log: $log)"
    timeout 1800 docker build --progress=plain --build-arg "BASE_IMAGE=$img" \
      -f "$UATENV_RT/tooling/infrastructure/uat-ec2/Dockerfile.prisma-openssl3" \
      -t "$img" "$UATENV_RT/tooling/infrastructure/uat-ec2" >"$log" 2>&1 \
      || uatenv_die "Prisma OpenSSL 3 layer failed for $svc; see $log"
  done
}

uatenv_render_configs() {
  local rel="$1"
  load_env_file "$UATENV_SEC/uatenv.env"
  node "$UATENV_RT/tooling/tools/scripts/uatenv/uatenv-render.mjs" nginx \
    --release "$rel" --out "$UATENV_RT/generated/nginx/uatenv.conf"
  node "$UATENV_RT/tooling/tools/scripts/uatenv/uatenv-render.mjs" realm \
    --release "$rel" --out "$UATENV_SEC/generated/keycloak-realm.json"
  chmod 644 "$UATENV_RT/generated/nginx/uatenv.conf"
  chmod 600 "$UATENV_SEC/generated/keycloak-realm.json"
}

# Production migration path (deploy.yml): roles, Prisma + apply-sql (strict FKs), gates.
uatenv_migrate() {
  local rel="$1" log
  uatenv_guard
  log="$UATENV_RT/logs/migrate-$(basename "$rel" | cut -c1-12)-$(date -u +%Y%m%dT%H%M%SZ).log"
  uatenv_log "running migrations (log: $log)"
  (
    load_env_file "$UATENV_SEC/ops.env"
    # Migrations run with the migrator credential only: apply-sql.sh would
    # otherwise re-run the role bootstrap with the superuser URL.
    unset BOOTSTRAP_DATABASE_URL BACKUP_DATABASE_URL KEYCLOAK_DATABASE_URL BACKUP_DB_PASSWORD
    cd "$rel"
    MIGRATOR_DATABASE_URL="$MIGRATOR_DATABASE_URL" NODE_ENV=production \
      timeout 1800 bash tools/scripts/run-target-database-migrations.sh
    DATABASE_URL="$RUNTIME_DATABASE_URL" RUNTIME_ROLE_GATE_REQUIRED=1 \
      bash tools/scripts/assert-runtime-database-role.sh
    DATABASE_URL="$RUNTIME_DATABASE_URL" bash tools/scripts/assert-runtime-schema-ready.sh
  ) >"$log" 2>&1 || uatenv_die "migrations failed; see $log"
  grep -h 'run-target-database-migrations: PASS' "$log" >&2 || true
}

uatenv_write_state() {
  local sha="$1" services="$2"
  mkdir -p "$UATENV_RT/state"
  SHA="$sha" SERVICES="$services" CI_URL="${UATENV_CI_URL:-}" python3 -c '
import json, os, datetime
print(json.dumps({
  "sha": os.environ["SHA"],
  "tag": "uatenv-" + os.environ["SHA"][:12],
  "deployedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "services": os.environ["SERVICES"].split(),
  "ciRun": os.environ["CI_URL"],
}, indent=2))' >"$UATENV_RT/state/deployed.json"
}
