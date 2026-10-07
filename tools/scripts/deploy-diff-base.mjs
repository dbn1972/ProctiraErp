#!/usr/bin/env node
/**
 * #555 review #1 (PRC-M259): explicit diff base for deploy.yml / release.yml.
 *
 * A workflow_run's `headSha` is the default-branch tip when the run was
 * triggered, not the CI commit that run built or deployed, so "headSha of the
 * last successful run" can skip changes. Each workflow therefore records the
 * SHA it actually shipped, per scope (deploy: one scope per environment;
 * release: one per branch). The record is a GitHub Deployment in the
 * bookkeeping environment `diff-base-<scope>` with task `proctira-diff-base`.
 * Only bookkeeping environments are written, so the real staging/production
 * deployment history is never marked inactive.
 *
 *   node tools/scripts/deploy-diff-base.mjs get --scope <scope>
 *     → prints the last recorded 40-hex SHA, or nothing. Never fails the
 *       step: no record / API error → empty → callers fan out to everything.
 *   node tools/scripts/deploy-diff-base.mjs record --scope <scope> --sha <sha>
 *     → records <sha> as the new base (exit 1 on API error).
 *
 * Env: GH_TOKEN or GITHUB_TOKEN, GITHUB_REPOSITORY, optional GITHUB_API_URL.
 * `record` needs `deployments: write`; `get` needs `deployments: read`.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const TASK = 'proctira-diff-base';
const SHA_RE = /^[0-9a-f]{40}$/;
const SCOPE_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/;

/** Map a branch name to a scope segment (release/1.2 → release-1.2). */
export function scopeForBranch(prefix, branch) {
  const slug = String(branch ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  if (!slug) throw new Error('branch is required');
  return `${prefix}-${slug}`;
}

export function environmentForScope(scope) {
  if (!SCOPE_RE.test(scope ?? '')) throw new Error(`invalid scope "${scope}"`);
  return `diff-base-${scope}`;
}

function apiContext(env) {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error('GH_TOKEN/GITHUB_TOKEN and GITHUB_REPOSITORY are required');
  }
  const base = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  return {
    url: (path) => `${base}/repos/${repo}${path}`,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
  };
}

/** Last recorded SHA for `scope`, or '' when none / unreadable. */
export async function getBase({ scope, env = process.env, fetchImpl = fetch, log = console }) {
  try {
    const api = apiContext(env);
    const qs = new URLSearchParams({
      environment: environmentForScope(scope),
      task: TASK,
      per_page: '1',
    });
    const res = await fetchImpl(api.url(`/deployments?${qs}`), { headers: api.headers });
    if (!res.ok) throw new Error(`GET deployments → HTTP ${res.status}`);
    const rows = await res.json();
    const sha = Array.isArray(rows) && rows[0] ? String(rows[0].sha ?? '') : '';
    return SHA_RE.test(sha) ? sha : '';
  } catch (err) {
    log.error(`::warning::diff base unavailable (${err.message}); falling back to full fan-out`);
    return '';
  }
}

/** Record `sha` as the diff base for `scope`. Throws on any failure. */
export async function recordBase({ scope, sha, env = process.env, fetchImpl = fetch }) {
  if (!SHA_RE.test(sha ?? '')) throw new Error(`sha must be 40 lowercase hex chars, got "${sha}"`);
  const api = apiContext(env);
  const environment = environmentForScope(scope);
  const created = await fetchImpl(api.url('/deployments'), {
    method: 'POST',
    headers: api.headers,
    body: JSON.stringify({
      ref: sha,
      task: TASK,
      environment,
      auto_merge: false,
      required_contexts: [],
      transient_environment: false,
      production_environment: false,
      description: `diff base: last fully shipped commit for ${scope}`,
    }),
  });
  if (created.status !== 201) throw new Error(`POST deployments → HTTP ${created.status}`);
  const { id } = await created.json();
  const status = await fetchImpl(api.url(`/deployments/${id}/statuses`), {
    method: 'POST',
    headers: api.headers,
    body: JSON.stringify({ state: 'success', auto_inactive: true }),
  });
  if (status.status !== 201) throw new Error(`POST deployment status → HTTP ${status.status}`);
  return { id, environment };
}

function argValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const scope = argValue(rest, 'scope');
  try {
    if (cmd === 'get') {
      environmentForScope(scope);
      process.stdout.write(`${await getBase({ scope })}\n`);
    } else if (cmd === 'record') {
      const { environment } = await recordBase({ scope, sha: argValue(rest, 'sha') });
      console.log(`Recorded diff base in ${environment}`);
    } else if (cmd === 'scope-for-branch') {
      process.stdout.write(
        `${scopeForBranch(argValue(rest, 'prefix'), argValue(rest, 'branch'))}\n`,
      );
    } else {
      console.error('usage: deploy-diff-base.mjs get|record|scope-for-branch …');
      process.exit(2);
    }
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
