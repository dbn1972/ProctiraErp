#!/usr/bin/env bash
# PRC-M260 — restore-drill security/integrity parity between a source database
# and its restored copy. Fails (exit 1) when any of these differ or regress:
#   1. pg_policies (name, command, roles, USING, WITH CHECK) per table
#   2. relrowsecurity / relforcerowsecurity per table
#   3. sequence values (restored >= source)
#   4. per-tenant row counts on every table with a tenant_id column
#   5. audit hash-chain linkage (prev_hash = previous entry_hash, contiguous
#      chain_seq) on the restored DB, and chain heads equal to source
#   6. a NOBYPASSRLS probe role sees 0 rows of any other tenant, for each of
#      up to PARITY_PROBE_TENANTS tenants (>= PARITY_MIN_TENANTS required, and
#      some foreign rows must exist so the probe is not vacuous)
#   7. every public table with a tenant_id column has RLS enabled
#      (PARITY_NON_RLS_ALLOW=table1,table2 for justified exceptions)
#
# The probe GRANTs SELECT on all tables to PARITY_PROBE_ROLE: point DST_URL
# only at a disposable restored copy, never at a live database.
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
# #555 review #14: the probe must not pass vacuously. It needs at least
# PARITY_MIN_TENANTS tenants, probes up to PARITY_PROBE_TENANTS of them (not
# only the lowest id), and fails when no probed tenant had any foreign rows to
# hide, which would mean RLS was never exercised.
MIN_TENANTS="${PARITY_MIN_TENANTS:-2}"
PROBE_TENANTS="${PARITY_PROBE_TENANTS:-5}"
[[ "$MIN_TENANTS" =~ ^[0-9]+$ && "$PROBE_TENANTS" =~ ^[1-9][0-9]*$ ]] \
  || { echo "PARITY_MIN_TENANTS / PARITY_PROBE_TENANTS must be integers" >&2; exit 2; }
tenant_total="$(q "$DST_URL" "SELECT count(*) FROM tenants")"
if (( tenant_total < MIN_TENANTS )); then
  echo "FAIL cross-tenant probe: restored DB has ${tenant_total} tenant(s); need >= ${MIN_TENANTS} for a meaningful probe"
  fail=1
else
  q "$DST_URL" "DO \$\$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$PROBE_ROLE') THEN
        CREATE ROLE $PROBE_ROLE NOLOGIN NOSUPERUSER NOBYPASSRLS;
      END IF; END \$\$;
    GRANT USAGE ON SCHEMA public TO $PROBE_ROLE;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO $PROBE_ROLE;" > /dev/null
  # One UNION ALL over every RLS-enabled public table with tenant_id; the
  # placeholder __TENANT__ is replaced per probed (uuid-validated) tenant.
  PROBE_GEN="
    SELECT coalesce(string_agg(format(
      'SELECT %L AS t, count(*) AS n FROM %I.%I WHERE tenant_id IS NOT NULL AND tenant_id::text <> ''__TENANT__''',
      c.relname, n.nspname, c.relname), ' UNION ALL '), 'SELECT NULL, 0')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p') AND c.relrowsecurity AND n.nspname = 'public'
       AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)"
  PROBE_TEMPLATE="$(q "$DST_URL" "$PROBE_GEN")"
  hidden_total=0
  probed=0
  while IFS= read -r tenant; do
    if ! [[ "$tenant" =~ ^[0-9a-fA-F-]{36}$ ]]; then
      echo "FAIL cross-tenant probe: unexpected tenant id '$tenant'"
      fail=1
      continue
    fi
    probe_sql="${PROBE_TEMPLATE//__TENANT__/$tenant}"
    # Foreign rows the probe must NOT see, counted on the BYPASSRLS connection.
    hidden="$(q "$DST_URL" "SELECT coalesce(sum(n), 0) FROM ($probe_sql) s")"
    leaked="$(psql "$DST_URL" -X -q -v ON_ERROR_STOP=1 -At <<SQL
BEGIN;
SET LOCAL ROLE $PROBE_ROLE;
SELECT set_config('app.tenant_id', '$tenant', true);
SELECT set_config('app.current_tenant_id', '$tenant', true);
SELECT 'LEAKED:' || coalesce(string_agg(t || '=' || n, ','), '') FROM ($probe_sql) s WHERE n > 0;
ROLLBACK;
SQL
)"
    leaked="$(printf '%s\n' "$leaked" | sed -n 's/^LEAKED://p')"
    probed=$((probed + 1))
    hidden_total=$((hidden_total + hidden))
    if [[ -n "$leaked" ]]; then
      echo "FAIL cross-tenant probe: tenant $tenant sees other tenants' rows: $leaked"
      fail=1
    else
      echo "OK   cross-tenant probe tenant $tenant: 0 of ${hidden} foreign rows visible"
    fi
  done < <(q "$DST_URL" "SELECT id::text FROM tenants ORDER BY id LIMIT $PROBE_TENANTS")
  if (( probed == 0 || hidden_total == 0 )); then
    echo "FAIL cross-tenant probe was vacuous: ${probed} tenant(s) probed, ${hidden_total} foreign rows existed to hide (seed rows for >= 2 tenants)"
    fail=1
  fi
fi
# 7. #555 review #14: tenant_id tables without RLS are never probed above, so
# flag them directly on the restored DB. PARITY_NON_RLS_ALLOW lists justified
# exceptions (comma-separated table names).
non_rls="$(q "$DST_URL" "
  SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p') AND n.nspname = 'public' AND NOT c.relrowsecurity
     AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
   ORDER BY 1")"
unexpected=""
while IFS= read -r t; do
  [[ -z "$t" ]] && continue
  case ",${PARITY_NON_RLS_ALLOW:-}," in
    *",$t,"*) echo "SKIP tenant_id table without RLS (allowlisted): $t" ;;
    *) unexpected="${unexpected:+$unexpected, }$t" ;;
  esac
done <<< "$non_rls"
if [[ -n "$unexpected" ]]; then
  echo "FAIL tenant_id tables without row-level security on restored DB: $unexpected"
  fail=1
else
  echo "OK   every public tenant_id table has row-level security enabled"
fi
if [[ "$fail" -ne 0 ]]; then
  echo "Restore parity FAILED (artifacts in $ARTIFACT_DIR)"
  exit 1
fi
echo "Restore parity OK"
