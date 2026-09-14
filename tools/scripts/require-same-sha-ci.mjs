#!/usr/bin/env node
/**
 * Same-SHA CI gate for manual release (W1-OPS-23).
 *
 * Manual `workflow_dispatch` of Release must not proceed unless the exact
 * commit already has a successful CI proof. Fail closed when CI is missing,
 * failed, cancelled, or still in progress.
 *
 * Usage (in Actions):
 *   node tools/scripts/require-same-sha-ci.mjs --sha <sha>
 *
 * Env:
 *   GITHUB_REPOSITORY  owner/repo (required when fetching)
 *   GH_TOKEN / GITHUB_TOKEN  token with actions:read + checks:read
 *   REQUIRE_SAME_SHA_CI_WORKFLOW_NAME  default "CI"
 *
 * Pure evaluation (tests):
 *   import { evaluateSameShaCi } from './require-same-sha-ci.mjs'
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_WORKFLOW_NAME = 'CI';

/** Check-run names that prove the full CI aggregate passed (not a single job). */
const AGGREGATE_CHECK_NAMES = new Set([
  'CI Aggregate',
  'CI Aggregate (Required)',
  'Verify CI results (fail closed on failures and unproven skips)',
]);

/**
 * @param {{
 *   workflowRuns?: Array<{ id?: number, name?: string, status?: string, conclusion?: string | null }>,
 *   checkRuns?: Array<{ id?: number, name?: string, status?: string, conclusion?: string | null }>,
 *   workflowName?: string,
 * }} input
 */
export function evaluateSameShaCi({
  workflowRuns = [],
  checkRuns = [],
  workflowName = DEFAULT_WORKFLOW_NAME,
} = {}) {
  const report = {
    ok: false,
    source: null,
    evidence: [],
    failures: [],
  };

  const matchingRuns = workflowRuns.filter((r) => (r.name || '') === workflowName);
  const successfulRuns = matchingRuns.filter(
    (r) => r.status === 'completed' && r.conclusion === 'success',
  );

  if (successfulRuns.length > 0) {
    report.ok = true;
    report.source = 'workflow_run';
    report.evidence = successfulRuns.map((r) => ({
      id: r.id,
      name: r.name,
      conclusion: r.conclusion,
    }));
    return report;
  }

  // Secondary proof via Checks API — only aggregate CI check-runs, never a
  // partial green job (e.g. lint alone).
  const successfulChecks = checkRuns.filter(
    (c) =>
      c.status === 'completed' &&
      c.conclusion === 'success' &&
      AGGREGATE_CHECK_NAMES.has(c.name || ''),
  );

  if (successfulChecks.length > 0) {
    report.ok = true;
    report.source = 'check_run';
    report.evidence = successfulChecks.map((c) => ({
      id: c.id,
      name: c.name,
      conclusion: c.conclusion,
    }));
    return report;
  }

  if (matchingRuns.length === 0 && checkRuns.length === 0) {
    report.failures.push({
      reason: 'no CI workflow_runs or check_runs found for this SHA (missing)',
    });
  } else if (matchingRuns.length === 0) {
    report.failures.push({
      reason: `no "${workflowName}" workflow_runs for this SHA; check_runs present but no aggregate CI success`,
      checkConclusions: summarizeConclusions(checkRuns),
    });
  } else {
    report.failures.push({
      reason: `"${workflowName}" workflow_runs exist but none concluded success`,
      runConclusions: summarizeConclusions(matchingRuns),
    });
  }

  return report;
}

function summarizeConclusions(items) {
  const counts = {};
  for (const item of items) {
    const key = `${item.status || 'unknown'}/${item.conclusion ?? 'null'}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function ghApi(path) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GH_TOKEN or GITHUB_TOKEN is required to query GitHub');
  }
  const result = spawnSync(
    'gh',
    ['api', '-H', 'Accept: application/vnd.github+json', path],
    {
      encoding: 'utf8',
      env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
    },
  );
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').trim();
    throw new Error(`gh api ${path} failed: ${err || `exit ${result.status}`}`);
  }
  return JSON.parse(result.stdout);
}

function fetchProof(sha, repo) {
  const workflowName =
    process.env.REQUIRE_SAME_SHA_CI_WORKFLOW_NAME || DEFAULT_WORKFLOW_NAME;
  const runsPayload = ghApi(
    `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${encodeURIComponent(sha)}&per_page=30`,
  );
  const checksPayload = ghApi(
    `repos/${repo}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`,
  );
  return {
    workflowRuns: runsPayload.workflow_runs || [],
    checkRuns: checksPayload.check_runs || [],
    workflowName,
  };
}

function parseArgs(argv) {
  const out = { sha: null, evaluateOnly: false, jsonPath: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--sha') {
      out.sha = argv[++i];
    } else if (arg === '--evaluate-json') {
      out.evaluateOnly = true;
      out.jsonPath = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    }
  }
  return out;
}

function writeSummary(lines) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, `${lines.join('\n')}\n`);
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(`Usage: node tools/scripts/require-same-sha-ci.mjs --sha <commit-sha>
Fail closed unless the SHA has a successful CI workflow_run (or CI Aggregate check_run).`);
    return 0;
  }

  if (args.evaluateOnly) {
    if (!args.jsonPath) {
      console.error('::error::--evaluate-json requires a file path');
      return 1;
    }
    const payload = JSON.parse(readFileSync(args.jsonPath, 'utf8'));
    const report = evaluateSameShaCi(payload);
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }

  const sha = args.sha || process.env.HEAD_SHA;
  if (!sha) {
    console.error('::error::require-same-sha-ci: --sha or HEAD_SHA is required');
    return 1;
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.error('::error::require-same-sha-ci: GITHUB_REPOSITORY is required');
    return 1;
  }

  let proof;
  try {
    proof = fetchProof(sha, repo);
  } catch (err) {
    console.error(`::error::require-same-sha-ci: fail closed — ${err.message}`);
    writeSummary([
      '## Same-SHA CI gate (W1-OPS-23)',
      '',
      `- SHA: \`${sha}\``,
      '- Result: **FAIL CLOSED** (API error)',
      `- Error: ${err.message}`,
    ]);
    return 1;
  }

  const report = evaluateSameShaCi(proof);
  if (!report.ok) {
    console.error(
      `::error::No successful CI proof for SHA ${sha}. Manual release refuses (fail closed).`,
    );
    console.error(JSON.stringify(report, null, 2));
    writeSummary([
      '## Same-SHA CI gate (W1-OPS-23)',
      '',
      `- SHA: \`${sha}\``,
      '- Result: **FAIL CLOSED**',
      `- Detail: \`${JSON.stringify(report.failures)}\``,
    ]);
    return 1;
  }

  console.log(
    `Same-SHA CI gate passed via ${report.source} (${report.evidence.length} evidence item(s)) for ${sha}`,
  );
  writeSummary([
    '## Same-SHA CI gate (W1-OPS-23)',
    '',
    `- SHA: \`${sha}\``,
    `- Result: **PASS** via \`${report.source}\``,
    `- Evidence: ${report.evidence.map((e) => `\`${e.name}:${e.id}\``).join(', ')}`,
  ]);
  return 0;
}

const isDirect =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('/require-same-sha-ci.mjs') ||
    process.argv[1].endsWith('\\require-same-sha-ci.mjs') ||
    import.meta.url === pathToFileURL(process.argv[1]).href);

if (isDirect) {
  process.exit(main());
}
