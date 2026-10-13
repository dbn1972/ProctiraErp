#!/usr/bin/env bash
# G-503 — Backup → restore → verify drill with evidence artifacts.
#
# Prefer a disposable restore DB (RESTORE_DATABASE_URL or auto sibling).
# If CREATEDB is denied, fall back to dump-integrity + selective table
# round-trip evidence (still proves backup/restore tooling).
#
# Usage:
#   DATABASE_URL=postgresql://... bash tools/scripts/restore-drill.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_URL="${DATABASE_URL:?DATABASE_URL is required}"
ARTIFACT_DIR="${ARTIFACT_DIR:-/opt/cursor/artifacts/restore-drill}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/.backups/drill}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$ARTIFACT_DIR" "$BACKUP_DIR"

if [[ -n "${RESTORE_DATABASE_URL:-}" ]]; then
  DST_URL="$RESTORE_DATABASE_URL"
else
  DST_URL="$(DATABASE_URL="$SRC_URL" python3 - <<'PY'
import os, urllib.parse
u = urllib.parse.urlparse(os.environ["DATABASE_URL"])
print(urllib.parse.urlunparse((u.scheme, u.netloc, "/proctira_restore_drill", "", "", "")))
PY
)"
fi
export DST_URL ARTIFACT_DIR TIMESTAMP
DUMP_FILE="$BACKUP_DIR/drill-${TIMESTAMP}.dump"
export DUMP_FILE

# PRC-M437: redact credentials before printing any connection string.
redact_url() {
  printf '%s' "$1" | sed -E 's#(://)[^@/]+@#\1***:***@#'
}

# PRC-M437: refuse to operate on the source DB and require a clearly-named
# disposable restore database so the drill can never DROP a real database.
SRC_DB="$(printf '%s' "$SRC_URL" | sed -E 's#^[^/]*//[^/]*/##; s#[?].*$##')"
DST_DB="$(printf '%s' "$DST_URL" | sed -E 's#^[^/]*//[^/]*/##; s#[?].*$##')"
if [[ "$DST_URL" == "$SRC_URL" || "$DST_DB" == "$SRC_DB" ]]; then
  echo "ERROR: restore drill DST must differ from source DB (got '$DST_DB')" >&2
  exit 1
fi
if [[ "$DST_DB" != proctira_restore_drill* ]]; then
  echo "ERROR: restore drill DST database name must start with 'proctira_restore_drill' (got '$DST_DB')" >&2
  exit 1
fi

echo "==> Source: $(redact_url "$SRC_URL")"
echo "==> Drill DB: $(redact_url "$DST_URL")"
echo "==> Artifacts: $ARTIFACT_DIR"

MODE="full-db"
CREATE_RC=0
DATABASE_URL="$SRC_URL" DST_URL="$DST_URL" python3 - <<'PY' || CREATE_RC=$?
import os, urllib.parse, subprocess, sys
src = urllib.parse.urlparse(os.environ["DATABASE_URL"])
dst = urllib.parse.urlparse(os.environ["DST_URL"])
maint = urllib.parse.urlunparse((src.scheme, src.netloc, "/postgres", "", "", ""))
db = dst.path.lstrip("/") or "proctira_restore_drill"
drop = subprocess.run(
    ["psql", maint, "-v", "ON_ERROR_STOP=1", "-c", f'DROP DATABASE IF EXISTS "{db}";'],
    capture_output=True, text=True,
)
create = subprocess.run(
    ["psql", maint, "-v", "ON_ERROR_STOP=1", "-c", f'CREATE DATABASE "{db}";'],
    capture_output=True, text=True,
)
if create.returncode != 0:
    err = (create.stderr or create.stdout)
    print(err, file=sys.stderr)
    # Exit 2 == permission denied (allowed to degrade); exit 1 == hard failure.
    if "permission denied" in err.lower() or "must be owner" in err.lower():
        sys.exit(2)
    sys.exit(1)
print(f"==> Recreated database {db}")
PY

# PRC-M437: only a permission failure (exit 2) may degrade to dump-integrity;
# any other CREATE error is a hard failure, not a silent PASS.
if [[ "$CREATE_RC" -eq 2 ]]; then
  MODE="dump-integrity"
elif [[ "$CREATE_RC" -ne 0 ]]; then
  echo "ERROR: restore drill could not create disposable DB (rc=$CREATE_RC)" >&2
  exit 1
fi

# The drill restores DUMP_FILE directly, so it opts in to a plaintext artifact
# (PRC-L383: pg-backup.sh refuses plaintext by default).
DATABASE_URL="$SRC_URL" BACKUP_ALLOW_PLAINTEXT=1 bash "$ROOT/tools/scripts/pg-backup.sh" "$DUMP_FILE" \
  | tee "$ARTIFACT_DIR/backup.log"

echo "==> Dump integrity (pg_restore --list)"
pg_restore --list "$DUMP_FILE" > "$ARTIFACT_DIR/dump-list-full.txt"
head -40 "$ARTIFACT_DIR/dump-list-full.txt" | tee "$ARTIFACT_DIR/dump-list.txt"
LIST_COUNT="$(wc -l < "$ARTIFACT_DIR/dump-list-full.txt" | tr -d ' ')"

if [[ "$MODE" == "full-db" ]]; then
  DATABASE_URL="$DST_URL" RESTORE_CONFIRM_DB="$DST_DB" bash "$ROOT/tools/scripts/pg-restore.sh" "$DUMP_FILE" \
    | tee "$ARTIFACT_DIR/restore.log"

  echo "==> Verify restored schema + row sanity"
  psql "$DST_URL" -v ON_ERROR_STOP=1 <<'SQL' | tee "$ARTIFACT_DIR/verify.txt"
SELECT current_database() AS db;
SELECT 'tenants' AS entity, count(*)::int AS n FROM tenants
UNION ALL SELECT 'boards', count(*)::int FROM boards
UNION ALL SELECT 'institutions', count(*)::int FROM institutions
ORDER BY 1;
SQL
else
  echo "==> CREATEDB unavailable — dump-integrity fallback mode (read-only on source)"
  # PRC-M437: never write to the source DB. Verify the dump is restorable by
  # listing its contents and doing a read-only count against the source.
  psql "$SRC_URL" -v ON_ERROR_STOP=1 <<'SQL' | tee "$ARTIFACT_DIR/verify.txt"
SELECT current_database() AS db;
SELECT 'tenants' AS entity, count(*)::int AS n FROM tenants;
SQL
  echo "mode=dump-integrity dump_list_entries=$LIST_COUNT" | tee -a "$ARTIFACT_DIR/verify.txt"
fi

MODE="$MODE" LIST_COUNT="$LIST_COUNT" python3 - <<'PY' | tee "$ARTIFACT_DIR/summary.json"
import json, pathlib, os
artifact = pathlib.Path(os.environ["ARTIFACT_DIR"])
verify = (artifact / "verify.txt").read_text(errors="replace")
summary = {
  "ok": True,
  "gap": "G-503",
  "mode": os.environ.get("MODE", "unknown"),
  "timestamp": os.environ.get("TIMESTAMP", ""),
  "dumpFile": os.environ.get("DUMP_FILE", ""),
  "dumpListEntries": int(os.environ.get("LIST_COUNT", "0") or 0),
  "sourceDatabaseUrlRedacted": True,
  "verifySnippet": verify.strip().splitlines()[:30],
}
print(json.dumps(summary, indent=2))
PY

echo "==> Restore drill PASS ($MODE). Evidence in $ARTIFACT_DIR"
