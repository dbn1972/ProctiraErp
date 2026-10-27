#!/usr/bin/env node
/**
 * PRC-M551 — DoD baseline ratchet: tools/dod-checks/reports/baseline.json may
 * only shrink relative to the base revision.
 *
 * Fails when, versus `git show <base>:<baseline>`:
 *   - totals.totalErrors increased;
 *   - any check's errorCount increased;
 *   - a check present at base disappeared;
 *   - an error finding fingerprint (check + file + message; line numbers are
 *     ignored because they drift) is new or occurs more often.
 *
 * The base revision must resolve. A baseline file absent at base is accepted
 * only because the head file is then new; a missing head file always fails.
 *
 * Usage: node tools/scripts/check-dod-baseline-ratchet.mjs --base <rev> [--file <path>]
 * Dependency-free (node: built-ins only).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const DEFAULT_BASELINE = 'tools/dod-checks/reports/baseline.json';

export function errorFingerprints(baseline) {
  const counts = new Map();
  for (const check of baseline?.checks ?? []) {
    for (const f of check?.findings ?? []) {
      if (f?.severity !== 'error') continue;
      const key = `${f.check ?? check.check}|${f.file ?? ''}|${f.message ?? ''}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function checkMap(baseline) {
  const map = new Map();
  for (const c of baseline?.checks ?? []) map.set(c.check, c);
  return map;
}

/**
 * @returns {{ ok: boolean, errors: string[], notes: string[] }}
 */
export function compareBaselines(base, head) {
  const errors = [];
  const notes = [];
  const baseTotal = Number(base?.totals?.totalErrors);
  const headTotal = Number(head?.totals?.totalErrors);
  if (!Number.isFinite(headTotal)) {
    errors.push('head baseline totals.totalErrors is missing or not a number');
  } else if (Number.isFinite(baseTotal) && headTotal > baseTotal) {
    errors.push(`totals.totalErrors increased: ${baseTotal} -> ${headTotal}`);
  } else if (Number.isFinite(baseTotal) && headTotal < baseTotal) {
    notes.push(`totals.totalErrors decreased: ${baseTotal} -> ${headTotal}`);
  }

  const baseChecks = checkMap(base);
  const headChecks = checkMap(head);
  for (const [name, bc] of baseChecks) {
    const hc = headChecks.get(name);
    if (!hc) {
      errors.push(`check "${name}" present at base disappeared from the baseline`);
      continue;
    }
    const b = Number(bc.errorCount ?? 0);
    const h = Number(hc.errorCount);
    if (!Number.isFinite(h)) {
      errors.push(`check "${name}" errorCount is missing or not a number`);
    } else if (h > b) {
      errors.push(`check "${name}" errorCount increased: ${b} -> ${h}`);
    }
  }
  for (const [name, hc] of headChecks) {
    if (!baseChecks.has(name) && Number(hc.errorCount ?? 0) > 0) {
      errors.push(`new check "${name}" starts with ${hc.errorCount} baselined error(s)`);
    }
  }

  const baseFp = errorFingerprints(base);
  for (const [key, count] of errorFingerprints(head)) {
    const was = baseFp.get(key) ?? 0;
    if (count > was) {
      errors.push(`new baselined error finding (${was} -> ${count}): ${key}`);
    }
  }
  return { ok: errors.length === 0, errors, notes };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseArgs(argv) {
  const out = { file: DEFAULT_BASELINE };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base' || argv[i] === '--file') {
      out[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return out;
}

function main() {
  const { base, file } = parseArgs(process.argv.slice(2));
  const die = (msg) => {
    console.error(`check-dod-baseline-ratchet: ${msg}`);
    process.exit(1);
  };
  if (!base) die('--base <rev> is required');
  if (!existsSync(file)) die(`head baseline missing: ${file}`);
  let baseSha;
  try {
    baseSha = git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).trim();
  } catch {
    die(`base revision does not resolve: ${base}`);
  }
  const head = JSON.parse(readFileSync(file, 'utf8'));
  let baseText;
  try {
    baseText = git(['show', `${baseSha}:${file}`]);
  } catch {
    console.log(
      `check-dod-baseline-ratchet: PASS (${file} is new at head; absent at ${baseSha.slice(0, 12)})`,
    );
    return;
  }
  const result = compareBaselines(JSON.parse(baseText), head);
  for (const n of result.notes) console.log(`check-dod-baseline-ratchet: ${n}`);
  if (!result.ok) {
    for (const e of result.errors) console.error(`check-dod-baseline-ratchet: ${e}`);
    die(
      `baseline grew versus ${baseSha.slice(0, 12)} (PRC-M551: the DoD baseline may only shrink)`,
    );
  }
  console.log(
    `check-dod-baseline-ratchet: PASS (totalErrors ${head.totals.totalErrors} vs base ${baseSha.slice(0, 12)})`,
  );
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main();
}
