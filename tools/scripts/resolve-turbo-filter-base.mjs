#!/usr/bin/env node
/**
 * W1-OPS-22 — Resolve comparison ranges for Turbo and changed-file CI gates.
 *
 * Default Turbo mode is event-aware and fail-safe: pull requests use the
 * target merge-base, ordinary pushes use a verified ancestor
 * `github.event.before`, and ambiguous push history selects every package.
 *
 * `--changed-files-base` emits a concrete non-empty SHA for ESLint/Prettier:
 * pull requests use their target merge-base, pushes use `github.event.before`,
 * and all-zero branch-creation pushes fall back to a non-empty parent range.
 *
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
    throw new Error(`Turbo filter base candidate not resolvable: ${candidate} (${detail})`);
  }

  const mergeBase = execGit(['merge-base', headRef, candidate]).trim();
  if (!SHA_RE.test(mergeBase)) {
    throw new Error(`git merge-base returned invalid SHA: ${JSON.stringify(mergeBase)}`);
  }
  return mergeBase;
}

function avoidEmptyPushRange(base, headRef, execGit) {
  const head = execGit(['rev-parse', '--verify', `${headRef}^{commit}`]).trim();
  if (!FULL_SHA_RE.test(head)) {
    throw new Error(`git rev-parse returned invalid HEAD SHA: ${JSON.stringify(head)}`);
  }
  if (base.toLowerCase() !== head.toLowerCase()) {
    return base;
  }

  const parent = execGit(['rev-parse', '--verify', `${headRef}^`]).trim();
  if (!FULL_SHA_RE.test(parent)) {
    throw new Error(`Unable to resolve a non-empty push fallback: ${JSON.stringify(parent)}`);
  }
  return parent;
}

/**
 * Resolve the comparison base for changed-file lint/format gates.
 * Pull requests use their target merge-base. Pushes use github.event.before;
 * all-zero branch-creation events fall back to origin/main and then HEAD^ when
 * the branch points at the fallback tip. A push range is never allowed to
 * collapse silently to HEAD..HEAD.
 *
 * @param {object} opts
 * @param {string | undefined | null} opts.eventName
 * @param {string | undefined | null} opts.prBaseSha
 * @param {string | undefined | null} opts.pushBeforeSha
 * @param {string} [opts.fallbackRef]
 * @param {string} [opts.headRef]
 * @param {(args: string[]) => string} opts.execGit
 */
export function resolveChangedFilesBase({
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
    if (!FULL_SHA_RE.test(target)) {
      throw new Error('pull_request event requires a valid PR_BASE_SHA');
    }
    return resolveTurboFilterBase({
      prBaseSha: target,
      fallbackRef,
      headRef,
      execGit,
    });
  }

  if (event === 'push') {
    const before = normalize(pushBeforeSha);
    let base;
    if (ZERO_SHA_RE.test(before)) {
      base = resolveTurboFilterBase({
        prBaseSha: '',
        fallbackRef,
        headRef,
        execGit,
      });
    } else {
      if (!FULL_SHA_RE.test(before)) {
        throw new Error('push event requires a valid PUSH_BEFORE_SHA');
      }
      base = resolveTurboFilterBase({
        prBaseSha: before,
        fallbackRef,
        headRef,
        execGit,
      });
    }
    return avoidEmptyPushRange(base, headRef, execGit);
  }

  return resolveTurboFilterBase({
    prBaseSha,
    fallbackRef,
    headRef,
    execGit,
  });
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
  /** @type {{ eventName?: string, prBaseSha?: string, pushBeforeSha?: string, fallbackRef: string, headRef: string, changedFilesBase: boolean, githubOutput: boolean, help?: boolean }} */
  const out = {
    fallbackRef: DEFAULT_FALLBACK_REF,
    headRef: 'HEAD',
    changedFilesBase: false,
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
    } else if (arg === '--changed-files-base') {
      out.changedFilesBase = true;
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
      'Usage: resolve-turbo-filter-base.mjs [--event-name NAME] [--pr-base SHA] [--push-before SHA] [--fallback REF] [--head REF] [--changed-files-base] [--github-output]\n',
    );
    return 0;
  }

  const resolverInput = {
    eventName: opts.eventName,
    prBaseSha: opts.prBaseSha,
    pushBeforeSha: opts.pushBeforeSha,
    fallbackRef: opts.fallbackRef,
    headRef: opts.headRef,
    execGit: defaultExecGit,
  };

  let selection;
  if (opts.changedFilesBase) {
    const base = resolveChangedFilesBase(resolverInput);
    selection = {
      base,
      filter: formatTurboFilter(base),
      mode: 'changed_files',
      reason: 'event_comparison_base',
    };
  } else {
    selection = resolveTurboFilterSelection(resolverInput);
  }
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
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
