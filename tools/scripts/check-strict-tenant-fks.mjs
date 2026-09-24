#!/usr/bin/env node
/**
 * W1-DATA-06 COMPLETE — Strict tenant FK posture + live catalog gate.
 *
 * Finding (PARTIAL residual):
 *   - APPLY_STRICT_FKS defaulted OFF, so prod/CI could forget create+validate.
 *   - 068 VALIDATE could be ledger-recorded while 021b was skipped (no-op).
 *   - Later enabling strict FKs left NOT VALID / missing FKs forever.
 *
 * This gate requires:
 *   1. 021b exists and adds tenant_id → tenants(id) FKs.
 *   2. 068 VALIDATE migration exists (tenant FK VALIDATE signal).
 *   3. 082 repair migration exists (create+validate+assert for prior no-ops).
 *   4. apply-sql.sh gates 021a/021b/068/082/100 behind APPLY_STRICT_FKS and
 *      defaults that flag ON when CI=true or NODE_ENV=production. Checked by
 *      *executing* is_strict_fk_file, not by grepping for filenames.
 *   5. Every GitHub Actions step that runs apply-sql.sh sets APPLY_STRICT_FKS=1
 *      unless the step includes `# STRICT_FK_SKIP_JUSTIFIED: …`.
 *
 * Scope boundary, stated rather than implied: requirement 5 reads the step's
 * own YAML in `.github/workflows/*.y*ml`, plus the wrapper scripts those steps
 * call (see APPLY_SQL_WRAPPER_SCRIPTS). It does not descend into composite
 * actions under `.github/actions/**`, reusable workflows in other repositories,
 * or a shell script discovered at runtime. A new indirection needs a line in
 * APPLY_SQL_WRAPPER_SCRIPTS.
 *   6. With --live (or DATABASE_URL / MIGRATOR_DATABASE_URL set under --require-live),
 *      query pg_catalog and fail if any tenant_id → tenants FK is NOT VALID, or if
 *      any uuid tenant_id base table lacks such an FK.
 *
 * Usage:
 *   node tools/scripts/check-strict-tenant-fks.mjs
 *   node tools/scripts/check-strict-tenant-fks.mjs --root=/path/to/repo
 *   node tools/scripts/check-strict-tenant-fks.mjs --json
 *   node tools/scripts/check-strict-tenant-fks.mjs --live
 *   node tools/scripts/check-strict-tenant-fks.mjs --live --require-live
 *
 * Exit 0 on pass; exit 1 on residual.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STRICT_FK_ADD_FILE = '021b_tenant_fk_constraints.sql';
export const STRICT_FK_PREREQ_FILE = '021a_strict_fk_prerequisite_tenants.sql';
export const VALIDATE_MIGRATION_HINT = '068_validate_tenant_fk_constraints.sql';
export const REPAIR_MIGRATION_HINT = '082_repair_strict_tenant_fk_validate.sql';
export const SKIP_JUSTIFICATION_MARKER = 'STRICT_FK_SKIP_JUSTIFIED:';

/**
 * Shell scripts that invoke apply-sql.sh on behalf of a workflow step.
 *
 * Requirement 5 reads the step's YAML, so an indirection through a wrapper hides
 * the posture from it. `deploy.yml` reaches apply-sql.sh only this way, which
 * means the production deploy path had no gate coverage at all: the wrapper does
 * set the flag, but nothing was checking that it kept doing so.
 */
export const APPLY_SQL_WRAPPER_SCRIPTS = [
  'tools/scripts/run-target-database-migrations.sh',
  'tools/scripts/setup-live-db-and-onboard.sh',
];

/** SQL used by --live catalog proof (zero unvalidated / missing tenant FKs). */
export const LIVE_CATALOG_QUERY = `
WITH tenant_fks AS (
  SELECT
    rel.relname AS table_name,
    c.conname AS constraint_name,
    c.convalidated
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN pg_class ref ON ref.oid = c.confrelid
  JOIN pg_namespace refnsp ON refnsp.oid = ref.relnamespace
  WHERE c.contype = 'f'
    AND nsp.nspname = 'public'
    AND refnsp.nspname = 'public'
    AND ref.relname = 'tenants'
    AND (
      SELECT array_agg(a.attname::text ORDER BY u.ord)
      FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = u.attnum
    ) = ARRAY['tenant_id']::text[]
),
unvalidated AS (
  SELECT table_name || '.' || constraint_name AS id
  FROM tenant_fks
  WHERE NOT convalidated
),
uuid_tenant_tables AS (
  SELECT col.table_name
  FROM information_schema.columns col
  JOIN information_schema.tables tb
    ON tb.table_schema = col.table_schema AND tb.table_name = col.table_name
  WHERE col.table_schema = 'public'
    AND col.column_name = 'tenant_id'
    AND col.data_type = 'uuid'
    AND tb.table_type = 'BASE TABLE'
    AND col.table_name <> 'tenants'
),
missing AS (
  SELECT t.table_name AS id
  FROM uuid_tenant_tables t
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant_fks f WHERE f.table_name = t.table_name
  )
),
-- W1-DATA-06 residual: a non-uuid tenant_id cannot carry an FK to tenants(id),
-- so these tables were invisible to the gate and reported clean while holding no
-- referential integrity. Emitted as a distinct kind and reconciled against
-- tenant-fk-text-column-allowlist.json by the caller.
text_tenant_tables AS (
  SELECT col.table_name AS id
  FROM information_schema.columns col
  JOIN information_schema.tables tb
    ON tb.table_schema = col.table_schema AND tb.table_name = col.table_name
  WHERE col.table_schema = 'public'
    AND col.column_name = 'tenant_id'
    AND col.data_type <> 'uuid'
    AND tb.table_type = 'BASE TABLE'
    AND col.table_name <> 'tenants'
    AND NOT EXISTS (
      SELECT 1 FROM tenant_fks f WHERE f.table_name = col.table_name
    )
)
SELECT 'unvalidated' AS kind, id FROM unvalidated
UNION ALL
SELECT 'missing' AS kind, id FROM missing
UNION ALL
SELECT 'text_tenant_no_fk' AS kind, id FROM text_tenant_tables
ORDER BY 1, 2;
`.trim();

/**
 * @param {string} root
 */
export function defaultPaths(root) {
  return {
    sqlDir: join(root, 'db/sql'),
    applySqlScript: join(root, 'tools/scripts/apply-sql.sh'),
    workflowsDir: join(root, '.github/workflows'),
  };
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listSqlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^[0-9].*\.sql$/.test(name))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listYamlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/i.test(name))
    .map((name) => join(dir, name))
    .filter((p) => statSync(p).isFile())
    .sort();
}

/**
 * True when SQL corpus includes a VALIDATE pass for tenant FKs.
 * @param {string[]} sqlTexts
 */
export function hasTenantFkValidateMigration(sqlTexts) {
  const joined = sqlTexts.join('\n');
  return (
    /VALIDATE\s+CONSTRAINT/i.test(joined) &&
    (/tenant_fk/i.test(joined) || /tenant_id/i.test(joined))
  );
}

/**
 * True when repair migration asserts fail-closed on leftover NOT VALID FKs.
 * @param {string} repairText
 */
export function repairMigrationFailClosed(repairText) {
  return (
    /VALIDATE\s+CONSTRAINT/i.test(repairText) &&
    /RAISE\s+EXCEPTION/i.test(repairText) &&
    (/unvalidated/i.test(repairText) || /NOT\s+c\.convalidated/i.test(repairText))
  );
}

/**
 * Every db/sql file that must sit behind APPLY_STRICT_FKS.
 *
 * 100 is here because it completes the text→uuid migration for the last 23
 * tables *and* closes with a repo-wide assertion that every uuid tenant_id
 * column has a validated FK — FKs that 021b creates and 068/082 validate. With
 * 100 ungated, a default `bash tools/scripts/apply-sql.sh` skipped the files
 * that produce that state and then failed asserting it.
 */
export const STRICT_FK_UUID_COMPLETION_FILE = '100_tenant_id_uuid_fks.sql';

/** Every file `is_strict_fk_file` must gate. */
export const REQUIRED_STRICT_FK_FILES = [
  STRICT_FK_PREREQ_FILE,
  STRICT_FK_ADD_FILE,
  VALIDATE_MIGRATION_HINT,
  REPAIR_MIGRATION_HINT,
  STRICT_FK_UUID_COMPLETION_FILE,
];

/**
 * Which of `candidates` `apply-sql.sh` actually gates, decided by **running**
 * `is_strict_fk_file`.
 *
 * Reading the source instead of running it kept producing answers that were
 * true of the text and false of the behaviour. Asking whether a filename
 * appeared anywhere in the script counted a comment as a gate. Narrowing that to
 * the `case` block counted a *trailing* comment inside the block, and counted a
 * `case` arm whose body is `return 1` — the exact opposite of gated. Every such
 * fix invited the next variant.
 *
 * So the function is extracted verbatim and executed against each candidate.
 * Comments, branch bodies, line continuations, indentation and glob patterns all
 * behave as bash says they do, because bash is what decides.
 *
 * Fails closed: an unextractable or unrunnable function returns an empty set, so
 * every required file reads as ungated and the gate reports failures rather than
 * passing on an inconclusive read.
 *
 * @param {string} applySqlText
 * @param {readonly string[]} candidates
 * @returns {Set<string>}
 */
export function strictFkGatedFiles(applySqlText, candidates = REQUIRED_STRICT_FK_FILES) {
  const lines = applySqlText.split('\n');
  const start = lines.findIndex((line) => /^\s*is_strict_fk_file\s*\(\)\s*\{/.test(line));
  if (start === -1) return new Set();
  // The function's closing brace, at the same indentation as its declaration.
  const declIndent = (lines[start].match(/^(\s*)/)?.[1] ?? '').length;
  let end = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    const indent = (lines[i].match(/^(\s*)/)?.[1] ?? '').length;
    if (indent === declIndent && /^\s*\}\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end === -1) return new Set();

  const fnSource = lines.slice(start, end + 1).join('\n');
  const probe = `
set -u
${fnSource}
for candidate in "$@"; do
  if is_strict_fk_file "$candidate"; then printf '%s\\n' "$candidate"; fi
done
`;
  const result = spawnSync('bash', ['-c', probe, 'probe', ...candidates], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.error || result.status !== 0) return new Set();
  return new Set(
    result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

/**
 * True when apply-sql.sh gates every strict FK file (create, validate, repair,
 * uuid completion) inside `is_strict_fk_file`.
 * @param {string} applySqlText
 */
export function applySqlGatesStrictFks(applySqlText) {
  if (!/APPLY_STRICT_FKS/.test(applySqlText)) return false;
  if (!/is_strict_fk_file/.test(applySqlText)) return false;
  const gated = strictFkGatedFiles(applySqlText);
  return REQUIRED_STRICT_FK_FILES.every((file) => gated.has(file));
}

/**
 * True when apply-sql.sh defaults APPLY_STRICT_FKS on for CI / production.
 * @param {string} applySqlText
 */
export function applySqlDefaultsStrictFksOnInProd(applySqlText) {
  return (
    /CI/.test(applySqlText) &&
    /NODE_ENV/.test(applySqlText) &&
    /production/.test(applySqlText) &&
    /APPLY_STRICT_FKS\s*=\s*1/.test(applySqlText)
  );
}

/**
 * Remove a trailing `#` comment, respecting quotes.
 *
 * Both YAML and shell end a comment at end-of-line and require the `#` to start
 * a word, so a single walk serves both. Quote tracking matters because
 * `--password 'a#b'` and `sed 's/#//'` are not comments.
 *
 * @param {string} line
 */
export function stripInlineComment(line) {
  let single = false;
  let double = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && double) {
      i += 1;
      continue;
    }
    if (ch === "'" && !double) single = !single;
    else if (ch === '"' && !single) double = !double;
    else if (ch === '#' && !single && !double && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Replace the contents of quoted spans with nothing, keeping the quotes. */
function blankQuotedSpans(line) {
  return line.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/**
 * True when a workflow step really sets `APPLY_STRICT_FKS=1`.
 *
 * "Really" is doing work here. Three readings all looked equivalent and are not:
 *
 * * `snippet.includes(...)` counted the step's own comment explaining that it
 *   deliberately does *not* set the flag. That is the single worst misreading
 *   this gate can make, because it turns a documented exception into a
 *   false claim of compliance.
 * * Dropping whole-line comments fixed that one case and not the class: a
 *   *trailing* comment still established the posture.
 * * Dropping all comments still counted `echo "APPLY_STRICT_FKS=1 would defeat
 *   the point"`, because a string that mentions an assignment is not one.
 *
 * So: strip the comment, then look for the flag in a position where it is
 * actually being set — a YAML `env:` mapping entry, or a shell assignment
 * outside any quoted span.
 *
 * @param {string} snippet
 */
export function stepSetsStrictFks(snippet) {
  for (const raw of snippet.split('\n')) {
    const line = stripInlineComment(raw);
    // YAML mapping entry: `APPLY_STRICT_FKS: '1'`. Anchored, so a value that
    // merely contains the key name does not count.
    if (/^\s*APPLY_STRICT_FKS\s*:\s*(['"]?)1\1\s*$/.test(line)) return true;
    // Shell assignment, with quoted spans blanked so an echoed string cannot
    // masquerade as one.
    if (/(^|\s|;|&)APPLY_STRICT_FKS=(['"]?)1\2(\s|$|;|&|\\)/.test(blankQuotedSpans(line))) {
      return true;
    }
  }
  return false;
}

/**
 * Extract apply-sql.sh steps from a GitHub Actions workflow document.
 * @param {string} yamlText
 * @param {string} relPath
 * @returns {{ file: string, stepName: string, hasStrictFks: boolean, justifiedSkip: boolean, snippet: string }[]}
 */
export function findApplySqlSteps(yamlText, relPath) {
  const lines = yamlText.split(/\r?\n/);
  /** @type {{ file: string, stepName: string, hasStrictFks: boolean, justifiedSkip: boolean, snippet: string }[]} */
  const steps = [];

  /**
   * True when this line is an executable run invocation of apply-sql.sh
   * (not a comment that merely mentions the script).
   * @param {number} idx
   */
  function isApplySqlRunLine(idx) {
    const line = lines[idx];
    if (/^\s*#/.test(line)) return false;
    if (/^\s*(?:-\s+)?run:\s*.*apply-sql\.sh/.test(line)) return true;
    // Multi-line `run: |` / `run: >`. Scan the whole block scalar, not just its
    // first body line: a step that sets env vars, provisions a database or runs
    // migrations before invoking the script would otherwise be invisible to this
    // gate, which is exactly the hole a non-strict CI apply would hide in.
    // `|`, `>` with any combination of chomping (`-`/`+`) and explicit
    // indentation indicator (`|2`). `run: |2` previously yielded zero steps.
    const blockMatch = line.match(/^(\s*)(?:-\s+)?run:\s*[|>](?:[0-9][-+]?|[-+][0-9]?)?\s*$/);
    if (blockMatch) {
      const keyIndent = blockMatch[1].length;
      for (let k = idx + 1; k < lines.length; k++) {
        const body = lines[k];
        if (!body.trim()) continue;
        const bodyIndent = (body.match(/^(\s*)/)?.[1] ?? '').length;
        // Block scalar content must be more indented than its key. Anything at
        // or below that indent ends the block.
        if (bodyIndent <= keyIndent) return false;
        if (/apply-sql\.sh/.test(body) && !/^\s*#/.test(body)) return true;
      }
    }
    return false;
  }

  for (let i = 0; i < lines.length; i++) {
    if (!isApplySqlRunLine(i)) continue;

    // Walk upward to the nearest `- name:` for this step.
    let stepName = '(unnamed step)';
    let stepStart = i;
    for (let j = i; j >= 0; j--) {
      const nameMatch = lines[j].match(/^\s*-\s+name:\s*(.+)\s*$/);
      if (nameMatch) {
        stepName = nameMatch[1].trim();
        stepStart = j;
        break;
      }
      if (/^[a-zA-Z0-9_-]+:\s*$/.test(lines[j]) && j < i) break;
    }

    const stepIndent = (lines[stepStart].match(/^(\s*)/)?.[1] ?? '').length;
    let stepEnd = lines.length;
    for (let k = stepStart + 1; k < lines.length; k++) {
      const line = lines[k];
      if (!line.trim()) continue;
      const indent = (line.match(/^(\s*)/)?.[1] ?? '').length;
      if (indent <= stepIndent && /^\s*-\s+name:\s*/.test(line)) {
        stepEnd = k;
        break;
      }
      if (indent === 0 && /^[a-zA-Z0-9_-]+:/.test(line)) {
        stepEnd = k;
        break;
      }
      if (indent === 2 && /^  [a-zA-Z0-9_-]+:/.test(line) && !/^\s+-/.test(line)) {
        stepEnd = k;
        break;
      }
    }

    const snippet = lines.slice(stepStart, Math.max(stepEnd, i + 1)).join('\n');
    const hasStrictFks = stepSetsStrictFks(snippet);
    // The marker is read from the comments on purpose. The posture is not.
    const justifiedSkip = snippet.includes(SKIP_JUSTIFICATION_MARKER);

    steps.push({
      file: relPath,
      stepName,
      hasStrictFks,
      justifiedSkip,
      snippet,
    });
  }

  return steps;
}

/**
 * Parse `psql -At` rows of `kind|id` from LIVE_CATALOG_QUERY.
 * @param {string} stdout
 * @returns {{ unvalidated: string[], missing: string[] }}
 */
export function parseLiveCatalogRows(stdout) {
  /** @type {string[]} */
  const unvalidated = [];
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const textTenantNoFk = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const pipe = trimmed.indexOf('|');
    const kind = pipe >= 0 ? trimmed.slice(0, pipe) : trimmed;
    const id = pipe >= 0 ? trimmed.slice(pipe + 1) : '';
    if (kind === 'unvalidated' && id) unvalidated.push(id);
    else if (kind === 'missing' && id) missing.push(id);
    else if (kind === 'text_tenant_no_fk' && id) textTenantNoFk.push(id);
  }
  return { unvalidated, missing, textTenantNoFk };
}

/**
 * Flatten the text-tenant allowlist into a Set of table names.
 * @param {string} root
 */
export function loadTextTenantAllowlist(root) {
  const path = join(root, 'tools/scripts/tenant-fk-text-column-allowlist.json');
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const categories = parsed.categories ?? {};
    return new Set(Object.values(categories).flat());
  } catch {
    // Missing or unreadable allowlist must not silently permit everything.
    return new Set();
  }
}

/**
 * Split observed text tenant_id tables into tracked debt and new violations.
 * @param {string[]} observed
 * @param {Set<string>} allowlist
 */
export function reconcileTextTenantTables(observed, allowlist) {
  const unlisted = observed.filter((t) => !allowlist.has(t)).sort();
  const tracked = observed.filter((t) => allowlist.has(t)).sort();
  const stale = [...allowlist].filter((t) => !observed.includes(t)).sort();
  return { unlisted, tracked, stale };
}

/**
 * Run the live catalog query via psql.
 * @param {{ databaseUrl: string, query?: string }} input
 */
export function queryLiveTenantFkCatalog({ databaseUrl, query = LIVE_CATALOG_QUERY }) {
  const result = spawnSync(
    'psql',
    [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|', '-c', query],
    { encoding: 'utf8' },
  );
  return {
    status: result.status ?? -1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    error: result.error ? String(result.error.message ?? result.error) : '',
  };
}

/**
 * @param {{
 *   root: string,
 *   paths?: ReturnType<typeof defaultPaths>,
 *   live?: boolean,
 *   requireLive?: boolean,
 *   databaseUrl?: string,
 *   queryLive?: typeof queryLiveTenantFkCatalog,
 * }} input
 */
export function evaluateStrictTenantFks({
  root,
  paths = defaultPaths(root),
  live = false,
  requireLive = false,
  databaseUrl = process.env.MIGRATOR_DATABASE_URL || process.env.DATABASE_URL || '',
  queryLive = queryLiveTenantFkCatalog,
}) {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];

  const sqlNames = listSqlFiles(paths.sqlDir);
  if (!sqlNames.includes(STRICT_FK_ADD_FILE)) {
    failures.push(`missing ${STRICT_FK_ADD_FILE} under db/sql/`);
  } else {
    const addText = readFileSync(join(paths.sqlDir, STRICT_FK_ADD_FILE), 'utf8');
    if (!/REFERENCES\s+tenants\s*\(\s*id\s*\)/i.test(addText)) {
      failures.push(`${STRICT_FK_ADD_FILE} must REFERENCE tenants(id)`);
    }
    if (!/NOT\s+VALID/i.test(addText)) {
      notes.push(
        `${STRICT_FK_ADD_FILE} no longer uses NOT VALID — ensure VALIDATE migration still matches`,
      );
    }
  }

  if (!sqlNames.includes(STRICT_FK_PREREQ_FILE)) {
    failures.push(
      `missing ${STRICT_FK_PREREQ_FILE} (demo tenant prerequisite for VALIDATE with *b_* seeds)`,
    );
  }

  if (!sqlNames.includes(VALIDATE_MIGRATION_HINT)) {
    failures.push(`missing tenant FK VALIDATE migration ${VALIDATE_MIGRATION_HINT}`);
  } else if (
    !hasTenantFkValidateMigration([
      readFileSync(join(paths.sqlDir, VALIDATE_MIGRATION_HINT), 'utf8'),
    ])
  ) {
    failures.push(`${VALIDATE_MIGRATION_HINT} must VALIDATE tenant_id / tenant_fk constraints`);
  }

  if (!sqlNames.includes(REPAIR_MIGRATION_HINT)) {
    failures.push(
      `missing repair migration ${REPAIR_MIGRATION_HINT} (prior no-op 068 installs must be repaired)`,
    );
  } else {
    const repairText = readFileSync(join(paths.sqlDir, REPAIR_MIGRATION_HINT), 'utf8');
    if (!repairMigrationFailClosed(repairText)) {
      failures.push(
        `${REPAIR_MIGRATION_HINT} must VALIDATE tenant FKs and RAISE EXCEPTION on leftovers`,
      );
    }
  }

  if (!existsSync(paths.applySqlScript)) {
    failures.push('missing tools/scripts/apply-sql.sh');
  } else {
    const applyText = readFileSync(paths.applySqlScript, 'utf8');
    if (!applySqlGatesStrictFks(applyText)) {
      failures.push(
        'apply-sql.sh must gate 021a/021b/068/082/100 behind APPLY_STRICT_FKS via is_strict_fk_file',
      );
    }
    if (!applySqlDefaultsStrictFksOnInProd(applyText)) {
      failures.push(
        'apply-sql.sh must default APPLY_STRICT_FKS=1 when CI=true or NODE_ENV=production',
      );
    }
    // Decided by running `is_strict_fk_file`, not by reading around it.
    const gatedFiles = strictFkGatedFiles(applyText);
    for (const required of [
      STRICT_FK_PREREQ_FILE,
      STRICT_FK_ADD_FILE,
      VALIDATE_MIGRATION_HINT,
      REPAIR_MIGRATION_HINT,
      STRICT_FK_UUID_COMPLETION_FILE,
    ]) {
      if (!gatedFiles.has(required)) {
        failures.push(`apply-sql.sh must treat ${required} as a strict-FK file`);
      }
    }
  }

  const workflowFiles = listYamlFiles(paths.workflowsDir);
  if (workflowFiles.length === 0) {
    failures.push('no workflow YAML under .github/workflows');
  }

  /** @type {ReturnType<typeof findApplySqlSteps>} */
  const applySteps = [];
  for (const abs of workflowFiles) {
    const rel = relative(root, abs).replace(/\\/g, '/');
    const text = readFileSync(abs, 'utf8');
    applySteps.push(...findApplySqlSteps(text, rel));
  }

  if (applySteps.length === 0) {
    failures.push('no apply-sql.sh invocations found in .github/workflows');
  }

  for (const step of applySteps) {
    if (step.hasStrictFks) {
      notes.push(`${step.file} :: ${step.stepName} sets APPLY_STRICT_FKS=1`);
      continue;
    }
    if (step.justifiedSkip) {
      notes.push(
        `${step.file} :: ${step.stepName} skips APPLY_STRICT_FKS with ${SKIP_JUSTIFICATION_MARKER}`,
      );
      continue;
    }
    failures.push(
      `${step.file} :: step "${step.stepName}" runs apply-sql.sh without APPLY_STRICT_FKS=1 ` +
        `(set it, or add "# ${SKIP_JUSTIFICATION_MARKER} <reason>" in the step)`,
    );
  }

  // Workflow steps are not the only callers. `deploy.yml` reaches apply-sql.sh
  // only through a wrapper script, so scanning step YAML alone left the
  // production deploy path with no coverage at all: the wrapper does set the
  // flag, but nothing checked that it kept doing so.
  for (const relScript of APPLY_SQL_WRAPPER_SCRIPTS) {
    const abs = join(root, relScript);
    if (!existsSync(abs)) {
      notes.push(`wrapper ${relScript} not present (nothing to check)`);
      continue;
    }
    const text = readFileSync(abs, 'utf8');
    if (!/apply-sql\.sh/.test(text)) {
      notes.push(`wrapper ${relScript} no longer calls apply-sql.sh`);
      continue;
    }
    if (stepSetsStrictFks(text)) {
      notes.push(`${relScript} sets APPLY_STRICT_FKS=1 before apply-sql.sh`);
    } else if (text.includes(SKIP_JUSTIFICATION_MARKER)) {
      notes.push(`${relScript} skips APPLY_STRICT_FKS with ${SKIP_JUSTIFICATION_MARKER}`);
    } else {
      failures.push(
        `${relScript} calls apply-sql.sh without APPLY_STRICT_FKS=1 ` +
          `(set it, or add "# ${SKIP_JUSTIFICATION_MARKER} <reason>")`,
      );
    }
  }

  /** @type {{ unvalidated: string[], missing: string[] } | null} */
  let liveCatalog = null;
  if (live) {
    const url = (databaseUrl || '').trim();
    if (!url) {
      const msg =
        'live catalog gate requires MIGRATOR_DATABASE_URL or DATABASE_URL (or --database-url=)';
      if (requireLive) failures.push(msg);
      else notes.push(`skipped live catalog: ${msg}`);
    } else {
      const result = queryLive({ databaseUrl: url });
      if (result.status !== 0) {
        failures.push(
          `live catalog psql failed (exit ${result.status}): ${result.stderr || result.error || result.stdout}`,
        );
      } else {
        liveCatalog = parseLiveCatalogRows(result.stdout);
        if (liveCatalog.unvalidated.length) {
          failures.push(
            `live catalog: unvalidated tenant_id → tenants FKs: ${liveCatalog.unvalidated.join(', ')}`,
          );
        }
        if (liveCatalog.missing.length) {
          failures.push(
            `live catalog: uuid tenant_id tables missing tenants(id) FK: ${liveCatalog.missing.join(', ')}`,
          );
        }
        // W1-DATA-06 residual. A non-uuid tenant_id cannot carry an FK to
        // tenants(id), so these tables used to pass invisibly. Existing debt is
        // tracked in the allowlist; anything unlisted is a new violation.
        const textReconciled = reconcileTextTenantTables(
          liveCatalog.textTenantNoFk,
          loadTextTenantAllowlist(root),
        );
        liveCatalog.textTenant = textReconciled;
        if (textReconciled.unlisted.length) {
          failures.push(
            `live catalog: text tenant_id tables with no tenants(id) FK and not allowlisted: ` +
              `${textReconciled.unlisted.join(', ')} ` +
              `(migrate tenant_id to uuid with a validated FK, or add to ` +
              `tools/scripts/tenant-fk-text-column-allowlist.json with a reason)`,
          );
        }
        if (textReconciled.tracked.length) {
          notes.push(
            `live catalog: ${textReconciled.tracked.length} allowlisted text tenant_id table(s) ` +
              `still lack a tenants(id) FK (RLS-enforced but no referential integrity)`,
          );
        }
        if (textReconciled.stale.length) {
          notes.push(
            `live catalog: allowlist entries no longer observed, safe to delete: ` +
              `${textReconciled.stale.join(', ')}`,
          );
        }
        if (!liveCatalog.unvalidated.length && !liveCatalog.missing.length) {
          notes.push('live catalog: zero unvalidated / missing tenant_id → tenants FKs');
        }
      }
    }
  } else if (requireLive) {
    failures.push('--require-live was set without --live');
  }

  return {
    ok: failures.length === 0,
    failures,
    notes,
    applySqlStepCount: applySteps.length,
    liveCatalog,
  };
}

function formatReport(report) {
  const lines = ['## Strict tenant FK gate (W1-DATA-06 COMPLETE)', ''];
  if (report.ok) {
    lines.push(
      '**Status:** pass — prod/CI default ON, VALIDATE+repair present, workflow posture OK' +
        (report.liveCatalog ? ', live catalog clean' : '') +
        '.',
    );
  } else {
    lines.push('**Status:** fail — tenant FK validation residual remains.');
  }
  lines.push('');
  lines.push(`Apply-sql workflow steps scanned: ${report.applySqlStepCount}`);
  lines.push('');
  if (report.failures.length) {
    lines.push('### Failures');
    for (const f of report.failures) lines.push(`- ${f}`);
    lines.push('');
  }
  if (report.notes.length) {
    lines.push('### Notes');
    for (const n of report.notes) lines.push(`- ${n}`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  let root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  let json = false;
  let live = false;
  let requireLive = false;
  /** @type {string | undefined} */
  let databaseUrl;
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg === '--live') live = true;
    else if (arg === '--require-live') requireLive = true;
    else if (arg.startsWith('--root=')) root = arg.slice('--root='.length);
    else if (arg.startsWith('--database-url=')) databaseUrl = arg.slice('--database-url='.length);
  }
  return { root, json, live, requireLive, databaseUrl };
}

function main() {
  const { root, json, live, requireLive, databaseUrl } = parseArgs(process.argv.slice(2));
  const report = evaluateStrictTenantFks({
    root,
    live,
    requireLive,
    databaseUrl: databaseUrl || process.env.MIGRATOR_DATABASE_URL || process.env.DATABASE_URL || '',
  });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
