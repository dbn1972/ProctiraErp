#!/usr/bin/env node
/**
 * W1-OPS-24 — Fail closed when reusable CI assets lose their callers.
 *
 * Assets:
 *   - .github/workflows/reusable-setup.yml  (must be workflow_call'd)
 *   - .github/actions/setup-node-pnpm       (must be used by a workflow/action)
 *   - tools/scripts/validate-observability.mjs (must be invoked from a workflow)
 *
 * Usage: node tools/scripts/assert-reusable-ci-assets.mjs
 *        node tools/scripts/assert-reusable-ci-assets.mjs --root <dir>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '../..');

function parseArgs(argv) {
  const out = { root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1]) {
      out.root = resolve(argv[++i]);
    }
  }
  return out;
}

function walk(dir, predicate, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, predicate, acc);
    else if (predicate(entry, full)) acc.push(full);
  }
  return acc;
}

/**
 * @param {string} root
 * @returns {{ ok: boolean, failures: string[], evidence: Record<string, string[]> }}
 */
export function evaluateReusableCiAssets(root) {
  const workflowsDir = join(root, '.github/workflows');
  const actionsDir = join(root, '.github/actions');
  const workflowFiles = walk(workflowsDir, (f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  const actionFiles = walk(actionsDir, (f) => f === 'action.yml' || f === 'action.yaml');
  const searchFiles = [...workflowFiles, ...actionFiles];

  const readRel = (abs) => {
    const rel = relative(root, abs).split('\\').join('/');
    return { rel, text: readFileSync(abs, 'utf8') };
  };

  const evidence = {
    reusableSetupCallers: [],
    setupActionUsers: [],
    validateObservabilityUsers: [],
  };
  const failures = [];

  const reusableSetupPath = '.github/workflows/reusable-setup.yml';
  for (const abs of workflowFiles) {
    const { rel, text } = readRel(abs);
    if (rel === reusableSetupPath) continue;
    if (
      /uses:\s*\.\/\.github\/workflows\/reusable-setup\.yml\b/.test(text) ||
      /uses:\s*\$\{\{\s*github\.workspace\s*\}\}\/\.github\/workflows\/reusable-setup\.yml\b/.test(
        text,
      )
    ) {
      evidence.reusableSetupCallers.push(rel);
    }
  }
  if (evidence.reusableSetupCallers.length === 0) {
    failures.push(
      `${reusableSetupPath} is not called by any active workflow (expected uses: ./.github/workflows/reusable-setup.yml)`,
    );
  }

  const setupActionNeedle = /\.\/\.github\/actions\/setup-node-pnpm\b/;
  for (const abs of searchFiles) {
    const { rel, text } = readRel(abs);
    if (setupActionNeedle.test(text)) {
      evidence.setupActionUsers.push(rel);
    }
  }
  if (evidence.setupActionUsers.length === 0) {
    failures.push(
      `.github/actions/setup-node-pnpm is unused (no workflow/action references ./.github/actions/setup-node-pnpm)`,
    );
  }

  // Require an actual invocation, not merely a paths: filter mention.
  const validateInvoke =
    /(?:node\s+(?:tools\/scripts\/)?validate-observability\.mjs\b|pnpm(?:\s+run)?\s+check:observability\b|npm(?:\s+run)?\s+check:observability\b)/;
  for (const abs of workflowFiles) {
    const { rel, text } = readRel(abs);
    if (validateInvoke.test(text)) {
      evidence.validateObservabilityUsers.push(rel);
    }
  }
  if (evidence.validateObservabilityUsers.length === 0) {
    failures.push(
      `tools/scripts/validate-observability.mjs is not invoked from any workflow under .github/workflows/`,
    );
  }

  return { ok: failures.length === 0, failures, evidence };
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const report = evaluateReusableCiAssets(root);
  if (!report.ok) {
    console.error('W1-OPS-24 reusable CI assets check FAILED:');
    for (const f of report.failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('W1-OPS-24 reusable CI assets OK');
  console.log(`  reusable-setup callers: ${report.evidence.reusableSetupCallers.join(', ')}`);
  console.log(`  setup-node-pnpm users: ${report.evidence.setupActionUsers.join(', ')}`);
  console.log(
    `  validate-observability users: ${report.evidence.validateObservabilityUsers.join(', ')}`,
  );
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
