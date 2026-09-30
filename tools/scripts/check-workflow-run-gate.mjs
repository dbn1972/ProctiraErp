#!/usr/bin/env node
/**
 * PRC-H061 — static contract for the Deploy/Release `workflow_run` gate.
 *
 * A fork pull request from a branch named `main` triggers `workflow_run` with
 * `head_branch == 'main'`. Deploy/Release must therefore require, in the
 * `ci-gate` job condition:
 *   - github.event.workflow_run.conclusion == 'success'
 *   - github.event.workflow_run.event == 'push'
 *   - github.event.workflow_run.head_repository.full_name == github.repository
 * and every other job must (transitively) need `ci-gate`.
 *
 * Usage: node tools/scripts/check-workflow-run-gate.mjs [workflow.yml ...]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_WORKFLOWS = ['.github/workflows/deploy.yml', '.github/workflows/release.yml'];

export const REQUIRED_GUARDS = [
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.event == 'push'",
  'github.event.workflow_run.head_repository.full_name == github.repository',
];

const normalize = (expr) =>
  String(expr ?? '')
    .replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Evaluates a GitHub Actions `if:` expression limited to context lookups,
 * string literals, ==, !=, &&, || and parentheses against a context object.
 * Used to simulate workflow_run payloads in tests.
 */
export function evaluateGuard(expr, context) {
  const source = normalize(expr);
  const lookup = (path) =>
    path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), context);
  let js = '';
  const tokens = source.match(/'(?:[^']|'')*'|[A-Za-z_][\w.-]*|==|!=|&&|\|\||\(|\)|\S/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith("'")) js += JSON.stringify(token.slice(1, -1).replace(/''/g, "'"));
    else if (token === '==') js += '===';
    else if (token === '!=') js += '!==';
    else if (['&&', '||', '(', ')'].includes(token)) js += token;
    else if (token === 'true' || token === 'false') js += token;
    else if (/^[A-Za-z_][\w.-]*$/.test(token)) js += JSON.stringify(lookup(token) ?? null);
    else throw new Error(`Unsupported token in guard expression: ${token}`);
    js += ' ';
  }
  return Boolean(new Function(`return (${js});`)());
}

/** Returns contract violations for one workflow's YAML text. */
export function workflowRunGateContract(yamlText, name = 'workflow') {
  const problems = [];
  const doc = parse(yamlText);
  const jobs = doc?.jobs ?? {};
  const gate = jobs['ci-gate'];
  if (!doc?.on?.workflow_run) return problems;
  if (!gate) {
    problems.push(`${name}: workflow_run trigger without a ci-gate job`);
    return problems;
  }
  const condition = normalize(gate.if);
  for (const guard of REQUIRED_GUARDS) {
    if (!condition.includes(guard)) problems.push(`${name}: ci-gate if: is missing \`${guard}\``);
  }
  const needsOf = (job) => {
    const needs = jobs[job]?.needs;
    return Array.isArray(needs) ? needs : needs ? [needs] : [];
  };
  const reachesGate = (job, seen = new Set()) => {
    if (job === 'ci-gate') return true;
    if (seen.has(job)) return false;
    seen.add(job);
    return needsOf(job).some((dep) => reachesGate(dep, seen));
  };
  for (const job of Object.keys(jobs)) {
    if (!reachesGate(job)) problems.push(`${name}: job \`${job}\` does not depend on ci-gate`);
  }
  return problems;
}

function main() {
  const files = process.argv.slice(2);
  const targets = files.length > 0 ? files : DEFAULT_WORKFLOWS;
  const problems = targets.flatMap((file) =>
    workflowRunGateContract(readFileSync(join(ROOT, file), 'utf8'), file),
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`check-workflow-run-gate: ${problem}`);
    process.exit(1);
  }
  console.log(`check-workflow-run-gate: OK (${targets.join(', ')})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
