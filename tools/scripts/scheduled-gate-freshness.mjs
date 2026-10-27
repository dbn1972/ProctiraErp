#!/usr/bin/env node
/**
 * PRC-L108 — scheduled-gate watchdog.
 *
 * For each workflow in tools/scripts/scheduled-gates.json, lists its
 * `event=schedule` runs through the GitHub REST API and flags it when:
 *   - the latest completed scheduled run concluded failure, cancelled or
 *     timed_out; or
 *   - no scheduled run succeeded within maxAgeHours (stale or never ran).
 * For each flagged workflow it creates (or comments on) one open issue labelled
 * `scheduled-gate-failure` (the label is created when absent), then exits 1.
 * `--dry-run` prints the verdicts and performs no writes.
 *
 * Usage:
 *   node tools/scripts/scheduled-gate-freshness.mjs [--dry-run] [--repo owner/repo]
 * Env: GH_TOKEN | GITHUB_TOKEN (required), GITHUB_REPOSITORY, GITHUB_API_URL,
 *      GITHUB_SERVER_URL, GITHUB_RUN_ID (links the watchdog run in issues).
 *
 * Dependency-free (node: built-ins + global fetch).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOUR_MS = 60 * 60 * 1000;
export const ISSUE_LABEL = 'scheduled-gate-failure';
export const FAILED_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out']);
const REGISTRY = join(dirname(fileURLToPath(import.meta.url)), 'scheduled-gates.json');

/**
 * Pure verdict for one gate.
 * @param {{ workflow: string, maxAgeHours: number }} gate
 * @param {Array<{ status: string, conclusion: string | null, created_at: string, html_url?: string }>} runs
 *   scheduled runs, any order
 * @param {number} now epoch ms
 */
export function evaluateGate(gate, runs, now) {
  const sorted = [...(runs ?? [])].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const latest = sorted.find((r) => r.status === 'completed') ?? null;
  const cutoff = now - gate.maxAgeHours * HOUR_MS;
  const lastSuccess = sorted.find((r) => r.status === 'completed' && r.conclusion === 'success');
  const reasons = [];
  if (latest && FAILED_CONCLUSIONS.has(latest.conclusion)) {
    reasons.push(
      `latest scheduled run concluded ${latest.conclusion} (${latest.html_url ?? 'n/a'})`,
    );
  }
  if (!lastSuccess) {
    reasons.push('no successful scheduled run found');
  } else if (Date.parse(lastSuccess.created_at) < cutoff) {
    reasons.push(
      `last successful scheduled run ${lastSuccess.created_at} is older than ${gate.maxAgeHours}h`,
    );
  }
  return {
    workflow: gate.workflow,
    ok: reasons.length === 0,
    reasons,
    latest: latest
      ? {
          conclusion: latest.conclusion,
          created_at: latest.created_at,
          url: latest.html_url ?? null,
        }
      : null,
    lastSuccessAt: lastSuccess?.created_at ?? null,
  };
}

export function issueTitle(workflow) {
  return `Scheduled gate failing: ${workflow}`;
}

export function issueBody(verdict, runUrl) {
  const lines = [
    `The scheduled-gates watchdog (PRC-L108) flagged \`.github/workflows/${verdict.workflow}\`.`,
    '',
    ...verdict.reasons.map((r) => `- ${r}`),
    '',
    `Last successful scheduled run: ${verdict.lastSuccessAt ?? 'none'}`,
  ];
  if (runUrl) lines.push(`Watchdog run: ${runUrl}`);
  return lines.join('\n');
}

function makeClient({ token, apiUrl, repo, fetchImpl }) {
  const base = (apiUrl || 'https://api.github.com').replace(/\/+$/, '');
  return async function api(method, path, body) {
    const res = await fetchImpl(`${base}/repos/${repo}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
}

/** Creates or updates one open issue per flagged workflow. */
export async function reportFlagged(api, flagged, runUrl) {
  if (flagged.length === 0) return;
  const label = await api('GET', `/labels/${encodeURIComponent(ISSUE_LABEL)}`);
  if (!label) {
    await api('POST', '/labels', {
      name: ISSUE_LABEL,
      color: 'b60205',
      description: 'A scheduled CI gate failed or went stale (PRC-L108 watchdog)',
    });
  }
  const open =
    (await api(
      'GET',
      `/issues?state=open&labels=${encodeURIComponent(ISSUE_LABEL)}&per_page=100`,
    )) ?? [];
  for (const verdict of flagged) {
    const title = issueTitle(verdict.workflow);
    const body = issueBody(verdict, runUrl);
    const existing = open.find((i) => i.title === title && !i.pull_request);
    if (existing) {
      await api('POST', `/issues/${existing.number}/comments`, { body });
    } else {
      await api('POST', '/issues', { title, body, labels: [ISSUE_LABEL] });
    }
  }
}

export async function run({
  registry,
  repo,
  token,
  apiUrl,
  now,
  dryRun,
  runUrl,
  fetchImpl = fetch,
  log = console.log,
}) {
  const api = makeClient({ token, apiUrl, repo, fetchImpl });
  const verdicts = [];
  for (const gate of registry.gates) {
    const data = await api(
      'GET',
      `/actions/workflows/${encodeURIComponent(gate.workflow)}/runs?event=schedule&per_page=30`,
    );
    const verdict = evaluateGate(gate, data?.workflow_runs ?? [], now);
    verdicts.push(verdict);
    log(
      `${verdict.ok ? 'OK     ' : 'FLAGGED'} ${gate.workflow}${verdict.ok ? '' : ` — ${verdict.reasons.join('; ')}`}`,
    );
  }
  const flagged = verdicts.filter((v) => !v.ok);
  if (dryRun) {
    if (flagged.length > 0) log(`dry-run: ${flagged.length} flagged; no issues written`);
  } else {
    await reportFlagged(api, flagged, runUrl);
  }
  return { verdicts, flagged };
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const repoIdx = argv.indexOf('--repo');
  const repo = repoIdx >= 0 ? argv[repoIdx + 1] : process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    console.error('scheduled-gate-freshness: FAIL — set GITHUB_REPOSITORY or --repo owner/repo');
    return 1;
  }
  if (!token) {
    console.error('scheduled-gate-freshness: FAIL — GH_TOKEN or GITHUB_TOKEN is required');
    return 1;
  }
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${server}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
  const { flagged } = await run({
    registry,
    repo,
    token,
    apiUrl: process.env.GITHUB_API_URL,
    now: Date.now(),
    dryRun,
    runUrl,
  });
  if (flagged.length > 0) {
    console.error(`scheduled-gate-freshness: FAIL (${flagged.length} flagged)`);
    return 1;
  }
  console.log('scheduled-gate-freshness: PASS');
  return 0;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`scheduled-gate-freshness: FAIL — ${err.message}`);
      process.exit(1);
    },
  );
}
