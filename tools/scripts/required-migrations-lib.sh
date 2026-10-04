#!/usr/bin/env bash
# Shared derivation of required migration sets (PRC-L188 / PRC-L381).
#
# Hard-coded filename lists in the deploy gates went stale as db/sql grew. These
# helpers derive the lists from their source of truth and fail closed (non-zero,
# empty stdout) when the source is missing, unparsable or yields no entries.
#
# Source this file; do not execute it.

REQUIRED_MIGRATION_NAME_RE='^[0-9][0-9A-Za-z_]*\.sql$'

# required_sql_migrations <sql_dir>
#   Every numbered db/sql file the production apply (APPLY_SEEDS=0,
#   APPLY_STRICT_FKS=1) records in schema_migrations: all [0-9]*.sql except the
#   demo seeds (NNNb_*_seed.sql). One filename per line, LC_ALL=C order.
required_sql_migrations() {
  local dir="${1:?required_sql_migrations: sql dir required}"
  [[ -d "$dir" ]] || {
    echo "required_sql_migrations: $dir is not a directory" >&2
    return 1
  }
  local names=() path base
  while IFS= read -r path; do
    base="$(basename "$path")"
    [[ "$base" =~ ^[0-9]+b_.*_seed\.sql$ ]] && continue
    [[ "$base" =~ $REQUIRED_MIGRATION_NAME_RE ]] || {
      echo "required_sql_migrations: unsafe migration filename: $base" >&2
      return 1
    }
    names+=("$base")
  done < <(find "$dir" -maxdepth 1 -type f -name '[0-9]*.sql' | LC_ALL=C sort)
  ((${#names[@]} > 0)) || {
    echo "required_sql_migrations: no migrations found in $dir" >&2
    return 1
  }
  printf '%s\n' "${names[@]}"
}

# required_runtime_migrations <schema-readiness.ts>
#   REQUIRED_RUNTIME_MIGRATIONS as built by packages/shared/database: the
#   PERMANENT_RUNTIME_INTEGRITY_MIGRATIONS array plus
#   CURRENT_RUNTIME_SCHEMA_MIGRATION, de-duplicated, in source order.
required_runtime_migrations() {
  local ts="${1:?required_runtime_migrations: schema-readiness.ts path required}"
  [[ -f "$ts" ]] || {
    echo "required_runtime_migrations: $ts not found" >&2
    return 1
  }
  local current permanent
  current="$(sed -n "s/^export const CURRENT_RUNTIME_SCHEMA_MIGRATION = '\([^']*\)';\$/\1/p" "$ts")"
  permanent="$(
    awk '
      /^export const PERMANENT_RUNTIME_INTEGRITY_MIGRATIONS = \[/ { inside = 1; next }
      inside && /^\] as const;/ { inside = 0; done = 1; next }
      inside {
        line = $0
        sub(/\/\/.*/, "", line)
        while (match(line, /'\''[^'\'']*'\''/)) {
          print substr(line, RSTART + 1, RLENGTH - 2)
          line = substr(line, RSTART + RLENGTH)
        }
      }
      END { if (!done) exit 3 }
    ' "$ts"
  )" || {
    echo "required_runtime_migrations: PERMANENT_RUNTIME_INTEGRITY_MIGRATIONS not parsable in $ts" >&2
    return 1
  }
  [[ -n "$current" && -n "$permanent" ]] || {
    echo "required_runtime_migrations: empty runtime migration contract in $ts" >&2
    return 1
  }
  local name out=() seen=" "
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    [[ "$name" =~ $REQUIRED_MIGRATION_NAME_RE ]] || {
      echo "required_runtime_migrations: unsafe migration filename: $name" >&2
      return 1
    }
    [[ "$seen" == *" $name "* ]] && continue
    seen+="$name "
    out+=("$name")
  done <<<"$permanent"$'\n'"$current"
  printf '%s\n' "${out[@]}"
}
