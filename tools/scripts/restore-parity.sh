#!/usr/bin/env bash
# PRC-M260 — restore-drill security/integrity parity between a source database
# and its restored copy. Fails (exit 1) when any of these differ or regress:
#   1. pg_policies (name, command, roles, USING, WITH CHECK) per table
#   2. relrowsecurity / relforcerowsecurity per table
#   3. sequence values (restored >= source)
#   4. per-tenant row counts on every table with a tenant_id column
#   5. audit hash-chain linkage (prev_hash = previous entry_hash, contiguous
#      chain_seq) on the restored DB, and chain heads equal to source
#   6. a NOBYPASSRLS probe role scoped to one tenant sees 0 rows of any other
#      tenant on the restored DB
#
# Usage: SRC_URL=… DST_URL=… [ARTIFACT_DIR=…] bash tools/scripts/restore-parity.sh
# Both URLs must be able to read every row (superuser / BYPASSRLS backup role).
set -euo pipefail

SRC_URL="${SRC_URL:?SRC_URL is required}"
DST_URL="${DST_URL:?DST_URL is required}"
ARTIFACT_DIR="${ARTIFACT_DIR:-/tmp/restore-parity}"
PROBE_ROLE="${PARITY_PROBE_ROLE:-restore_parity_probe}"
mkdir -p "$ARTIFACT_DIR"
fail=0

q() { psql "$1" -X -v ON_ERROR_STOP=1 -At -c "$2"; }

compare() {
  local name="$1" sql="$2"
  q "$SRC_URL" "$sql" > "$ARTIFACT_DIR/src-$name.txt"
  q "$DST_URL" "$sql" > "$ARTIFACT_DIR/dst-$name.txt"
  if diff -u "$ARTIFACT_DIR/src-$name.txt" "$ARTIFACT_DIR/dst-$name.txt" > "$ARTIFACT_DIR/diff-$name.txt"; then
    echo "OK   $name ($(wc -l < "$ARTIFACT_DIR/src-$name.txt" | tr -d ' ') rows)"
  else
    echo "FAIL $name differs after restore:"
    head -20 "$ARTIFACT_DIR/diff-$name.txt"
    fail=1
  fi
}

# 1. Policies.
compare policies "
  SELECT schemaname || '.' || tablename || '|' || policyname || '|' || cmd || '|' ||
         array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    FROM pg_policies ORDER BY 1"

# 2. RLS enable/force flags on every ordinary/partitioned table.
compare rls-flags "
  SELECT n.nspname || '.' || c.relname || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
   ORDER BY 1"

# 3. Sequences: restored value must be >= source (no id reuse after restore).
SEQ_SQL="SELECT schemaname || '.' || sequencename || '|' || coalesce(last_value, 0)
           FROM pg_sequences ORDER BY 1"
q "$SRC_URL" "$SEQ_SQL" | LC_ALL=C sort > "$ARTIFACT_DIR/src-sequences.txt"
q "$DST_URL" "$SEQ_SQL" | LC_ALL=C sort > "$ARTIFACT_DIR/dst-sequences.txt"
seq_bad="$(LC_ALL=C join -t '|' -a 1 -e MISSING -o '0,1.2,2.2' \
  "$ARTIFACT_DIR/src-sequences.txt" "$ARTIFACT_DIR/dst-sequences.txt" \
  | awk -F'|' '$3 == "MISSING" || ($3 + 0) < ($2 + 0)')"
if [[ -n "$seq_bad" ]]; then
  echo "FAIL sequences regressed or missing after restore:"
  echo "$seq_bad" | head -20
  fail=1
else
  echo "OK   sequences ($(wc -l < "$ARTIFACT_DIR/src-sequences.txt" | tr -d ' ') checked)"
fi

# 4. Per-tenant counts on every tenant_id table (generated from the catalog).
COUNT_GEN="
  SELECT coalesce(string_agg(format(
    'SELECT %L || ''|'' || coalesce(tenant_id::text, ''<null>'') || ''|'' || count(*) FROM %I.%I GROUP BY tenant_id',
    table_schema || '.' || table_name, table_schema, table_name), ' UNION ALL '), 'SELECT NULL WHERE false')
    FROM information_schema.columns col
    JOIN information_schema.tables t USING (table_schema, table_name)
   WHERE col.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
     AND col.table_schema NOT IN ('pg_catalog', 'information_schema')"
COUNT_SQL="$(q "$SRC_URL" "$COUNT_GEN")"
compare tenant-counts "SELECT * FROM ($COUNT_SQL) s(v) ORDER BY 1"

# 5. Audit hash chain linkage + heads.
has_audit="$(q "$DST_URL" "SELECT to_regclass('public.audit_log_entries') IS NOT NULL")"
if [[ "$has_audit" == "t" ]]; then
  broken="$(q "$DST_URL" "
    WITH chain AS (
      SELECT tenant_id, chain_seq, prev_hash, entry_hash,
             lag(entry_hash) OVER w AS expected_prev,
             lag(chain_seq) OVER w AS prev_seq
        FROM audit_log_entries WHERE chain_seq IS NOT NULL
      WINDOW w AS (PARTITION BY tenant_id ORDER BY chain_seq))
    SELECT count(*) FROM chain
     WHERE prev_seq IS NOT NULL
       AND (prev_hash IS DISTINCT FROM expected_prev OR chain_seq <> prev_seq + 1)")"
  if [[ "$broken" != "0" ]]; then
    echo "FAIL audit chain: $broken broken link(s) on restored DB"
    fail=1
  else
    echo "OK   audit chain verification (linkage intact)"
  fi
  if [[ "$(q "$DST_URL" "SELECT to_regclass('public.audit_chain_heads') IS NOT NULL")" == "t" ]]; then
    compare audit-chain-heads "SELECT tenant_id || '|' || row_to_json(h)::text FROM audit_chain_heads h ORDER BY 1"
  fi
else
  echo "SKIP audit chain (audit_log_entries not present)"
fi

# 6. Cross-tenant probe as a NOBYPASSRLS role on the restored DB.
tenant_a="$(q "$DST_URL" "SELECT id::text FROM tenants ORDER BY id LIMIT 1" || true)"
if [[ -z "$tenant_a" ]]; then
  echo "FAIL cross-tenant probe: restored DB has no tenants to probe"
  fail=1
else
  q "$DST_URL" "DO \$\$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$PROBE_ROLE') THEN
        CREATE ROLE $PROBE_ROLE NOLOGIN NOSUPERUSER NOBYPASSRLS;
      END IF; END \$\$;
    GRANT USAGE ON SCHEMA public TO $PROBE_ROLE;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO $PROBE_ROLE;" > /dev/null
  PROBE_GEN="
    SELECT coalesce(string_agg(format(
      'SELECT %L AS t, count(*) AS n FROM %I.%I WHERE tenant_id IS NOT NULL AND tenant_id::text <> %L',
      c.relname, n.nspname, c.relname, '$tenant_a'), ' UNION ALL '), 'SELECT NULL, 0')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p') AND c.relrowsecurity AND n.nspname = 'public'
       AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)"
  PROBE_SQL="$(q "$DST_URL" "$PROBE_GEN")"
  leaked="$(psql "$DST_URL" -X -q -v ON_ERROR_STOP=1 -At <<SQL
BEGIN;
SET LOCAL ROLE $PROBE_ROLE;
SELECT set_config('app.tenant_id', '$tenant_a', true);
SELECT set_config('app.current_tenant_id', '$tenant_a', true);
SELECT 'LEAKED:' || coalesce(string_agg(t || '=' || n, ','), '') FROM ($PROBE_SQL) s WHERE n > 0;
ROLLBACK;
SQL
)"
  leaked="$(printf '%s\n' "$leaked" | sed -n 's/^LEAKED://p')"
  if [[ -n "$leaked" ]]; then
    echo "FAIL cross-tenant probe: tenant $tenant_a sees other tenants' rows: $leaked"
    fail=1
  else
    echo "OK   cross-tenant probe as NOBYPASSRLS role returned 0 foreign rows"
  fi
fi

if [[ "$fail" -ne 0 ]]; then
  echo "Restore parity FAILED (artifacts in $ARTIFACT_DIR)"
  exit 1
fi
echo "Restore parity OK"
