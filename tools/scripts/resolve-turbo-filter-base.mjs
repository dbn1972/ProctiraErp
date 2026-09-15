#!/usr/bin/env node
/**
 * W1-OPS-22 — Resolve the Turborepo filter range for CI.
 *
 * Pull requests compare HEAD with the PR target merge-base. Push events compare
 * HEAD with github.event.before so main/develop/release pushes do not collapse
 * to origin/main === HEAD. New-branch, zero, equal, or unavailable push SHAs
 * deliberately select every package rather than silently selecting no work.
 *
 * Usage (CI):
 *   GITHUB_EVENT_NAME=${{ github.event_name }} \
 *   PR_BASE_SHA=${{ github.event.pull_request.base.sha }} \
 *   PUSH_BEFORE_SHA=${{ github.event.before }} \
 *     node tools/scripts/resolve-turbo-filter-base.mjs --github-output
 *
 * Prints the resolved base SHA, or `FULL` for an all-package fallback.
 * `--github-output` appends base/filter/mode/reason outputs to $GITHUB_OUTPUT.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_FALLBACK_REF = 'origin/main';
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const FULL_SHA_RE = /^[0-9a-f]{40}$/i;
const ZERO_SHA_RE = /^0{40}$/;
export const FULL_PACKAGE_FILTER = '*';

/** @param {unknown} value */
function normalize(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * Resolve a PR/local comparison base through git merge-base.
 *
 * @param {object} opts
 * @param {string | undefined | null} opts.prBaseSha
 * @param {string} [opts.fallbackRef]
 * @param {string} [opts.headRef]
 * @param {(args: string[]) => string} opts.execGit
 */
export function resolveTurboFilterBase({
  prBaseSha,
  fallbackRef = DEFAULT_FALLBACK_REF,
  headRef = 'HEAD',
  execGit,
}) {
  if (typeof execGit !== 'function') {
    throw new TypeError('execGit is required');
  }

  const candidate = normalize(prBaseSha) || fallbackRef;

  try {
    execGit(['rev-parse', '--verify', `${candidate}^{commit}`]);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Turbo filter base candidate not resolvable: ${candidate} (${detail})`,
    );
  }

  const mergeBase = execGit(['merge-base', headRef, candidate]).trim();
  if (!SHA_RE.test(mergeBase)) {
    throw new Error(`git merge-base returned invalid SHA: ${JSON.stringify(mergeBase)}`);
  }
  return mergeBase;
}

/** @param {string} baseSha */
export function formatTurboFilter(baseSha) {
  if (!SHA_RE.test(normalize(baseSha))) {
    throw new Error(`Invalid turbo filter base SHA: ${JSON.stringify(baseSha)}`);
  }
  return `...[${baseSha.trim()}]`;
}

/** @param {string} reason */
function fullPackageSelection(reason) {
  return {
    base: '',
    filter: FULL_PACKAGE_FILTER,
    mode: 'full',
    reason,
  };
}

/**
 * Select the event-appropriate Turborepo range.
 *
 * @param {object} opts
 * @param {string | undefined | null} opts.eventName
 * @param {string | undefined | null} opts.prBaseSha
 * @param {string | undefined | null} opts.pushBeforeSha
 * @param {string} [opts.fallbackRef]
 * @param {string} [opts.headRef]
 * @param {(args: string[]) => string} opts.execGit
 * @returns {{ base: string, filter: string, mode: string, reason: string }}
 */
export function resolveTurboFilterSelection({
  eventName,
  prBaseSha,
  pushBeforeSha,
  fallbackRef = DEFAULT_FALLBACK_REF,
  headRef = 'HEAD',
  execGit,
}) {
  if (typeof execGit !== 'function') {
    throw new TypeError('execGit is required');
  }

  const event = normalize(eventName);

  if (event === 'pull_request') {
    const target = normalize(prBaseSha);
    if (!target) {
      throw new Error('pull_request event requires PR_BASE_SHA');
    }
    const base = resolveTurboFilterBase({
      prBaseSha: target,
      fallbackRef,
      headRef,
      execGit,
    });
    return {
      base,
      filter: formatTurboFilter(base),
      mode: 'pull_request',
      reason: 'pull_request_merge_base',
    };
  }

  if (event === 'push') {
    const before = normalize(pushBeforeSha);
    if (!FULL_SHA_RE.test(before) || ZERO_SHA_RE.test(before)) {
      return fullPackageSelection('push_before_missing_or_zero');
    }

    let verifiedBefore;
    try {
      verifiedBefore = execGit(['rev-parse', '--verify', `${before}^{commit}`]).trim();
    } catch {
      return fullPackageSelection('push_before_unresolvable');
    }
    if (!FULL_SHA_RE.test(verifiedBefore)) {
      return fullPackageSelection('push_before_invalid');
    }

    const head = execGit(['rev-parse', '--verify', `${headRef}^{commit}`]).trim();
    if (!FULL_SHA_RE.test(head)) {
      throw new Error(`git rev-parse returned invalid HEAD SHA: ${JSON.stringify(head)}`);
    }
    if (verifiedBefore.toLowerCase() === head.toLowerCase()) {
      return fullPackageSelection('push_before_equals_head');
    }

    let mergeBase;
    try {
      mergeBase = execGit(['merge-base', headRef, verifiedBefore]).trim();
    } catch {
      return fullPackageSelection('push_before_uncomparable');
    }
    if (!FULL_SHA_RE.test(mergeBase)) {
      return fullPackageSelection('push_before_uncomparable');
    }
    if (mergeBase.toLowerCase() !== verifiedBefore.toLowerCase()) {
      return fullPackageSelection('push_before_not_ancestor');
    }

    return {
      base: verifiedBefore,
      filter: formatTurboFilter(verifiedBefore),
      mode: 'push',
      reason: 'push_before',
    };
  }

  // Local/manual compatibility: preserve the historical merge-base fallback.
  const base = resolveTurboFilterBase({
    prBaseSha,
    fallbackRef,
    headRef,
    execGit,
  });
  return {
    base,
    filter: formatTurboFilter(base),
    mode: 'fallback',
    reason: 'non_ci_merge_base',
  };
}

/**
 * Fail closed if CI still wires turbo to tip-only HEAD~1 filters.
 * @param {string} workflowYaml
 */
export function assertCiAvoidsTurboHeadParent(workflowYaml) {
  const text = String(workflowYaml ?? '');
  const hits = [];
  const re = /turbo\s+run\b[^\n]*--filter=['"]?\.\.\.\[HEAD~1\]/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    hits.push(match[0].trim());
  }
  return {
    ok: hits.length === 0,
    hits,
  };
}

function defaultExecGit(args) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = (result.stderr || result.stdout || '').trim();
    throw new Error(stderr || `git ${args.join(' ')} failed (${result.status})`);
  }
  return (result.stdout || '').trim();
}

function parseArgs(argv) {
  /** @type {{ eventName?: string, prBaseSha?: string, pushBeforeSha?: string, fallbackRef: string, headRef: string, githubOutput: boolean, help?: boolean }} */
  const out = {
    fallbackRef: DEFAULT_FALLBACK_REF,
    headRef: 'HEAD',
    githubOutput: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--event-name') {
      out.eventName = argv[++i];
    } else if (arg === '--pr-base') {
      out.prBaseSha = argv[++i];
    } else if (arg === '--push-before') {
      out.pushBeforeSha = argv[++i];
    } else if (arg === '--fallback') {
      out.fallbackRef = argv[++i] ?? DEFAULT_FALLBACK_REF;
    } else if (arg === '--head') {
      out.headRef = argv[++i] ?? 'HEAD';
    } else if (arg === '--github-output') {
      out.githubOutput = true;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (out.eventName == null && process.env.GITHUB_EVENT_NAME) {
    out.eventName = process.env.GITHUB_EVENT_NAME;
  }
  if (out.prBaseSha == null && process.env.PR_BASE_SHA) {
    out.prBaseSha = process.env.PR_BASE_SHA;
  }
  if (out.pushBeforeSha == null && process.env.PUSH_BEFORE_SHA) {
    out.pushBeforeSha = process.env.PUSH_BEFORE_SHA;
  }
  if (process.env.TURBO_FILTER_FALLBACK) {
    out.fallbackRef = process.env.TURBO_FILTER_FALLBACK;
  }
  return out;
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(
      'Usage: resolve-turbo-filter-base.mjs [--event-name NAME] [--pr-base SHA] [--push-before SHA] [--fallback REF] [--head REF] [--github-output]\n',
    );
    return 0;
  }

  const selection = resolveTurboFilterSelection({
    eventName: opts.eventName,
    prBaseSha: opts.prBaseSha,
    pushBeforeSha: opts.pushBeforeSha,
    fallbackRef: opts.fallbackRef,
    headRef: opts.headRef,
    execGit: defaultExecGit,
  });
  process.stdout.write(`${selection.base || 'FULL'}\n`);

  if (opts.githubOutput) {
    const path = process.env.GITHUB_OUTPUT;
    if (!path) {
      throw new Error('--github-output requires GITHUB_OUTPUT');
    }
    appendFileSync(
      path,
      `base=${selection.base}\nfilter=${selection.filter}\nmode=${selection.mode}\nreason=${selection.reason}\n`,
    );
  }
  return 0;
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
