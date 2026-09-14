#!/usr/bin/env node
/**
 * W1-DATA-06 — Strict tenant FK posture gate (fail closed).
 *
 * Finding: tenant FKs were opt-in (APPLY_STRICT_FKS) and NOT VALID; primary CI
 * could skip them silently, leaving orphan tenant_id rows unchecked forever.
 *
 * This gate requires:
 *   1. 021b exists and adds tenant_id → tenants(id) FKs.
 *   2. A numbered SQL migration VALIDATEs those NOT VALID tenant FKs.
 *   3. apply-sql.sh still gates 021a/021b behind APPLY_STRICT_FKS.
 *   4. Every GitHub Actions step that runs apply-sql.sh sets APPLY_STRICT_FKS=1
 *      unless the step includes an explicit `# STRICT_FK_SKIP_JUSTIFIED: …`
 *      comment (documented exception only).
 *
 * Usage:
 *   node tools/scripts/check-strict-tenant-fks.mjs
 *   node tools/scripts/check-strict-tenant-fks.mjs --root=/path/to/repo
 *   node tools/scripts/check-strict-tenant-fks.mjs --json
 *
 * Exit 0 on pass; exit 1 on residual.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STRICT_FK_ADD_FILE = '021b_tenant_fk_constraints.sql';
export const STRICT_FK_PREREQ_FILE = '021a_strict_fk_prerequisite_tenants.sql';
export const VALIDATE_MIGRATION_HINT = '068_validate_tenant_fk_constraints.sql';
export const SKIP_JUSTIFICATION_MARKER = 'STRICT_FK_SKIP_JUSTIFIED:';

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
 * True when apply-sql.sh still opt-gates strict FK files.
 * @param {string} applySqlText
 */
export function applySqlGatesStrictFks(applySqlText) {
  return (
    /APPLY_STRICT_FKS/.test(applySqlText) &&
    /021b_tenant_fk_constraints\.sql/.test(applySqlText) &&
    /is_strict_fk_file/.test(applySqlText)
  );
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
    // Multi-line `run: |` / `run: >` with script on a following non-comment line.
    if (/^\s*(?:-\s+)?run:\s*[|>]\s*$/.test(line)) {
      for (let k = idx + 1; k < Math.min(lines.length, idx + 8); k++) {
        const body = lines[k];
        if (!body.trim()) continue;
        if (/^\s*#/.test(body)) continue;
        // Stop at next YAML key at step body indent.
        if (/^\s{0,8}[a-zA-Z0-9_-]+:/.test(body) && !/apply-sql\.sh/.test(body)) {
          return false;
        }
        return /apply-sql\.sh/.test(body);
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
    const hasStrictFks =
      /APPLY_STRICT_FKS\s*:\s*['"]?1['"]?/.test(snippet) ||
      /APPLY_STRICT_FKS\s*=\s*1\b/.test(snippet);
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
 * @param {{
 *   root: string,
 *   paths?: ReturnType<typeof defaultPaths>,
 * }} input
 */
export function evaluateStrictTenantFks({ root, paths = defaultPaths(root) }) {
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

  const sqlTexts = sqlNames.map((name) => readFileSync(join(paths.sqlDir, name), 'utf8'));
  if (!hasTenantFkValidateMigration(sqlTexts)) {
    failures.push(
      `missing tenant FK VALIDATE migration (expected something like ${VALIDATE_MIGRATION_HINT})`,
    );
  } else if (!sqlNames.includes(VALIDATE_MIGRATION_HINT)) {
    notes.push(`VALIDATE migration present but not named ${VALIDATE_MIGRATION_HINT}`);
  }

  if (!existsSync(paths.applySqlScript)) {
    failures.push('missing tools/scripts/apply-sql.sh');
  } else {
    const applyText = readFileSync(paths.applySqlScript, 'utf8');
    if (!applySqlGatesStrictFks(applyText)) {
      failures.push('apply-sql.sh must gate 021b behind APPLY_STRICT_FKS via is_strict_fk_file');
    }
    if (!applyText.includes(STRICT_FK_PREREQ_FILE)) {
      failures.push(`apply-sql.sh must treat ${STRICT_FK_PREREQ_FILE} as a strict-FK file`);
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

  return {
    ok: failures.length === 0,
    failures,
    notes,
    applySqlStepCount: applySteps.length,
  };
}

function formatReport(report) {
  const lines = ['## Strict tenant FK gate (W1-DATA-06)', ''];
  if (report.ok) {
    lines.push('**Status:** pass — APPLY_STRICT_FKS posture and VALIDATE migration present.');
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
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg.startsWith('--root=')) root = arg.slice('--root='.length);
  }
  return { root, json };
}

function main() {
  const { root, json } = parseArgs(process.argv.slice(2));
  const report = evaluateStrictTenantFks({ root });
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
