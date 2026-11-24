#!/usr/bin/env bash
# Restore drill: newest proctira-*.dump.gpg -> a disposable scratch database
# (proctira_restore_drill_<ts>, restore-drill.sh naming rule) via
# tools/scripts/pg-restore.sh, compare row counts with the source, write
# evidence/restore-drill-<ts>.json, then drop the scratch database.
# The source database is only read.
set -euo pipefail
# shellcheck source=uatenv-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/uatenv-lib.sh"
umask 077

load_env_file "$UATENV_SEC/ops.env"
export GNUPGHOME
uatenv_gnupg_tools
REL="$(uatenv_release_dir)"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
SCRATCH="proctira_restore_drill_${TS,,}"
DUMP="$(ls -1t "$UATENV_BACKUPS"/proctira-*.dump.gpg 2>/dev/null | head -1 || true)"
[[ -n "$DUMP" ]] || uatenv_die "no proctira-*.dump.gpg in $UATENV_BACKUPS; run uatenv-backup.sh first"
[[ "$SCRATCH" == proctira_restore_drill_* ]] || uatenv_die "bad scratch name"
OUT="$UATENV_EVIDENCE/restore-drill-$TS.json"
mkdir -p "$UATENV_EVIDENCE"

SUPER_PW="$(uatenv_url_password "$BOOTSTRAP_DATABASE_URL")"
# Superuser URL pointed at the scratch database (with and without the password).
SCRATCH_FULL_URL="$(BOOT="$BOOTSTRAP_DATABASE_URL" DB="$SCRATCH" python3 -c '
import os, urllib.parse
u = urllib.parse.urlparse(os.environ["BOOT"])
print(urllib.parse.urlunparse(u._replace(path="/" + os.environ["DB"])))')"
SCRATCH_URL="$(uatenv_url_without_password "$SCRATCH_FULL_URL")"

cleanup() {
  uatenv_psql "$BOOTSTRAP_DATABASE_URL" -q -c "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

uatenv_log "creating scratch database $SCRATCH"
uatenv_psql "$BOOTSTRAP_DATABASE_URL" -q -c "CREATE DATABASE \"$SCRATCH\""

START=$SECONDS
uatenv_log "pg-restore.sh <- $(basename "$DUMP")"
DATABASE_URL="$SCRATCH_URL" PGPASSWORD="$SUPER_PW" RESTORE_CONFIRM_DB="$SCRATCH" \
  bash "$REL/tools/scripts/pg-restore.sh" "$DUMP" >"$UATENV_RT/logs/restore-drill-$TS.log" 2>&1 \
  || uatenv_die "restore failed; see $UATENV_RT/logs/restore-drill-$TS.log"
RESTORE_SECONDS=$((SECONDS - START))

COUNT_SQL="SELECT string_agg(t || '=' || coalesce(n::text, 'absent'), ' ' ORDER BY t) FROM (
  SELECT t, CASE WHEN to_regclass('public.' || t) IS NULL THEN NULL
                 ELSE (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', t), false, true, '')))[1]::text::bigint END AS n
    FROM unnest(ARRAY['tenants','institutions','students','staff','guardian_households','schema_migrations','_prisma_migrations']) AS t) s"
SRC="$(uatenv_psql "$BACKUP_DATABASE_URL" -Atc "$COUNT_SQL")"
DST="$(uatenv_psql "$SCRATCH_FULL_URL" -Atc "$COUNT_SQL")"

cleanup
DROPPED="$(uatenv_psql "$BOOTSTRAP_DATABASE_URL" -Atc "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_database WHERE datname = '$SCRATCH') THEN 'false' ELSE 'true' END")"
trap - EXIT

SRC="$SRC" DST="$DST" DUMP="$(basename "$DUMP")" SCRATCH="$SCRATCH" SECS="$RESTORE_SECONDS" DROPPED="$DROPPED" \
  python3 -c '
import json, os, datetime
def parse(s): return dict(kv.split("=", 1) for kv in s.split())
src, dst = parse(os.environ["SRC"]), parse(os.environ["DST"])
match = src == dst
print(json.dumps({
  "drillAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "artifact": os.environ["DUMP"], "scratchDatabase": os.environ["SCRATCH"],
  "restoreSeconds": int(os.environ["SECS"]), "sourceCounts": src, "restoredCounts": dst,
  "countsMatch": match, "scratchDropped": os.environ["DROPPED"] == "true",
  "result": "PASS" if match and os.environ["DROPPED"] == "true" else "FAIL",
}, indent=2))' >"$OUT"
chmod 644 "$OUT"
uatenv_log "restore drill: $(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["result"], "counts", d["restoredCounts"], "dropped", d["scratchDropped"])' "$OUT")"
uatenv_log "evidence: $OUT"
grep -q '"result": "PASS"' "$OUT"
