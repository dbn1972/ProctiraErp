#!/usr/bin/env node
/**
 * PRC-M431 — verify a committed evidence pack against its GitHub Actions run.
 *
 * The restore-drill and DoD evidence packs used to be self-asserted JSON: any
 * string containing `github.com` and `/actions/runs/` passed, and the pack never
 * expired. This gate adds:
 *   - freshness: the pack timestamp must be within maxAgeDays of now (default
 *     90 = GitHub Actions default run retention, so the run stays verifiable).
 *     EVIDENCE_MAX_AGE_DAYS may only LOWER the window; values above 90 clamp.
 *   - run verification: the URL must parse as
 *     https://github.com/<owner>/<repo>/actions/runs/<id>, belong to this repo,
 *     and the run (GET /repos/{owner}/{repo}/actions/runs/{id}) must have
 *     conclusion=success, the expected workflow path, and a created_at within
 *     7 days of the pack timestamp.
 *
 * Network verification is mandatory when CI is truthy or EVIDENCE_VERIFY_RUN=1;
 * a missing token then fails closed. Outside CI without a token the run check
 * is skipped with an explicit "UNVERIFIED (no token)" line (never a silent
 * pass). Freshness always applies.
 *
 * Usage:
 *   node tools/scripts/verify-evidence-run.mjs --pack <file> --workflow <path> [--repo owner/repo]
 * Env: GH_TOKEN | GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, CI,
 *      EVIDENCE_VERIFY_RUN, EVIDENCE_MAX_AGE_DAYS.
 *
 * Dependency-free (node: built-ins only).
 */
import { readFileSync } from 'node:fs';

export const MAX_AGE_DAYS_CAP = 90;
export const RUN_SKEW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRUTHY = new Set(['1', 'true', 'yes']);
const RUN_URL_RE =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/actions\/runs\/(\d+)\/?$/;

function truthy(value) {
  return TRUTHY.has(String(value ?? '').toLowerCase());
}

/** @returns {{ owner: string, repo: string, id: string } | null} */
export function parseRunUrl(url) {
  const m = RUN_URL_RE.exec(String(url ?? '').trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2], id: m[3] };
}

/** Accepts ISO-8601 or YYYYMMDDTHHMMSSZ; returns epoch ms or NaN. */
export function parseTimestamp(value) {
  const s = String(value ?? '').trim();
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (compact) {
    const [, y, mo, d, h, mi, se] = compact;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return Number.NaN;
  return Date.parse(s);
}

/**
 * EVIDENCE_MAX_AGE_DAYS can only lower the window. Unset → cap. Values above
 * the cap clamp to the cap. Non-positive / non-integer values fail closed.
 */
export function resolveMaxAgeDays(envValue) {
  if (envValue === undefined || envValue === null || String(envValue).trim() === '') {
    return MAX_AGE_DAYS_CAP;
  }
  const s = String(envValue).trim();
  if (!/^\d+$/.test(s) || Number(s) < 1) {
    throw new Error(`EVIDENCE_MAX_AGE_DAYS must be a positive integer, got: ${s}`);
  }
  return Math.min(Number(s), MAX_AGE_DAYS_CAP);
}

/** Pack timestamp in the same precedence order as the shell gates. */
export function packTimestampOf(pack) {
  return pack?.timestamp || pack?.localDrill?.timestamp || pack?.recordedAt || '';
}

export function packRunUrlOf(pack) {
  return pack?.ciCrossRef?.latestSuccessfulRun?.url || pack?.runUrl || '';
}

/** Freshness + URL-shape + repo checks that need no network. */
export function evaluateOffline({ runUrl, repo, packTimestamp, now, maxAgeDays }) {
  const errors = [];
  const ts = parseTimestamp(packTimestamp);
  if (Number.isNaN(ts)) {
    errors.push(`pack timestamp missing or unparseable: ${JSON.stringify(packTimestamp)}`);
  } else {
    const ageDays = (now - ts) / DAY_MS;
    if (ageDays > maxAgeDays) {
      errors.push(
        `pack is stale: ${ageDays.toFixed(1)} days old (max ${maxAgeDays}); commit a fresh evidence pack`,
      );
    }
    if (ts - now > DAY_MS) {
      errors.push(`pack timestamp is in the future: ${packTimestamp}`);
    }
  }
  const parsed = parseRunUrl(runUrl);
  if (!parsed) {
    errors.push(
      `run URL must be https://github.com/<owner>/<repo>/actions/runs/<id>, got: ${JSON.stringify(runUrl)}`,
    );
  } else if (repo && `${parsed.owner}/${parsed.repo}`.toLowerCase() !== repo.toLowerCase()) {
    errors.push(`run URL belongs to ${parsed.owner}/${parsed.repo}, expected ${repo}`);
  }
  return { errors, parsed, packTs: ts };
}

/**
 * Pure verdict for a pack + fetched run object.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function evaluateRun({
  runUrl,
  run,
  expectedWorkflowPath,
  repo,
  packTimestamp,
  now,
  maxAgeDays,
}) {
  const { errors, parsed, packTs } = evaluateOffline({
    runUrl,
    repo,
    packTimestamp,
    now,
    maxAgeDays,
  });
  if (!run || typeof run !== 'object') {
    errors.push('run metadata missing');
    return { ok: false, errors };
  }
  if (parsed && String(run.id) !== parsed.id) {
    errors.push(`run id ${run.id} does not match URL id ${parsed.id}`);
  }
  const runRepo = run.repository?.full_name;
  if (repo && runRepo && runRepo.toLowerCase() !== repo.toLowerCase()) {
    errors.push(`run repository ${runRepo} does not match ${repo}`);
  }
  if (run.conclusion !== 'success') {
    errors.push(`run conclusion is ${JSON.stringify(run.conclusion)}, expected "success"`);
  }
  if (run.path !== expectedWorkflowPath) {
    errors.push(
      `run workflow path is ${JSON.stringify(run.path)}, expected ${expectedWorkflowPath}`,
    );
  }
  const created = Date.parse(String(run.created_at ?? ''));
  if (Number.isNaN(created)) {
    errors.push('run created_at missing or unparseable');
  } else if (!Number.isNaN(packTs) && Math.abs(created - packTs) > RUN_SKEW_DAYS * DAY_MS) {
    errors.push(
      `run created_at ${run.created_at} is more than ${RUN_SKEW_DAYS} days from pack timestamp ${packTimestamp}`,
    );
  }
  return { ok: errors.length === 0, errors };
}

export async function fetchRunFromGitHub({ owner, repo, id, token, apiUrl, fetchImpl = fetch }) {
  const base = (apiUrl || 'https://api.github.com').replace(/\/+$/, '');
  const res = await fetchImpl(`${base}/repos/${owner}/${repo}/actions/runs/${id}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`GET actions/runs/${id} returned HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Full verdict for a pack. fetchRun is injectable for tests.
 * @returns {Promise<{ ok: boolean, errors: string[], lines: string[] }>}
 */
export async function verifyPack({ pack, expectedWorkflowPath, repo, env, now, fetchRun }) {
  const lines = [];
  let maxAgeDays;
  try {
    maxAgeDays = resolveMaxAgeDays(env.EVIDENCE_MAX_AGE_DAYS);
  } catch (err) {
    return { ok: false, errors: [err.message], lines };
  }
  const runUrl = packRunUrlOf(pack);
  const packTimestamp = packTimestampOf(pack);
  const required = truthy(env.CI) || env.EVIDENCE_VERIFY_RUN === '1';
  const token = env.GH_TOKEN || env.GITHUB_TOKEN || '';
  const errors = [];

  const declared = pack?.ciCrossRef?.workflow;
  if (declared && declared !== expectedWorkflowPath) {
    errors.push(`ciCrossRef.workflow is ${declared}, expected ${expectedWorkflowPath}`);
  }
  if (required && !repo) {
    errors.push('GITHUB_REPOSITORY (or --repo) is required when run verification is mandatory');
  }

  if (!token) {
    if (required) {
      errors.push('GH_TOKEN/GITHUB_TOKEN missing while run verification is mandatory (CI)');
    }
    const offline = evaluateOffline({ runUrl, repo, packTimestamp, now, maxAgeDays });
    errors.push(...offline.errors);
    if (!required) lines.push(`UNVERIFIED (no token): run ${runUrl} not checked against GitHub`);
    return { ok: errors.length === 0, errors, lines };
  }

  const parsed = parseRunUrl(runUrl);
  let run = null;
  if (parsed) {
    try {
      run = await fetchRun({ ...parsed, token, apiUrl: env.GITHUB_API_URL });
    } catch (err) {
      errors.push(`could not fetch run: ${err.message}`);
    }
  }
  const verdict = evaluateRun({
    runUrl,
    run,
    expectedWorkflowPath,
    repo,
    packTimestamp,
    now,
    maxAgeDays,
  });
  errors.push(...verdict.errors);
  if (errors.length === 0) {
    lines.push(
      `VERIFIED run ${run.id} (${run.path}, ${run.conclusion}, created ${run.created_at}); pack ${packTimestamp} within ${maxAgeDays}d`,
    );
  }
  return { ok: errors.length === 0, errors, lines };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--pack' || a === '--workflow' || a === '--repo') {
      out[a.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pack || !args.workflow) {
    console.error(
      'usage: verify-evidence-run.mjs --pack <file> --workflow <path> [--repo owner/repo]',
    );
    process.exit(2);
  }
  const pack = JSON.parse(readFileSync(args.pack, 'utf8'));
  const result = await verifyPack({
    pack,
    expectedWorkflowPath: args.workflow,
    repo: args.repo || process.env.GITHUB_REPOSITORY || '',
    env: process.env,
    now: Date.now(),
    fetchRun: fetchRunFromGitHub,
  });
  for (const line of result.lines) console.log(`verify-evidence-run: ${line}`);
  if (!result.ok) {
    for (const e of result.errors) console.error(`verify-evidence-run: ${e}`);
    process.exit(1);
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((err) => {
    console.error(`verify-evidence-run: ${err.message}`);
    process.exit(1);
  });
}
