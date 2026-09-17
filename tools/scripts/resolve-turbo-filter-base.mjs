#!/usr/bin/env node
/**
 * W1-OPS-22 — Resolve comparison SHAs for Turbo and changed-file CI gates.
 *
 * The default mode preserves the Turbo merge-base contract. The explicit
 * `--changed-files-base` mode is event-aware: PRs compare against their target,
 * pushes compare against github.event.before, and all-zero branch-creation
 * pushes use a non-empty fallback rather than silently checking zero files.
 *
 * Usage (changed-file CI):
 *   node tools/scripts/resolve-turbo-filter-base.mjs \
 *     --changed-files-base --event-name "$GITHUB_EVENT_NAME" \
 *     --pr-base "$PR_BASE_SHA" --push-before "$PUSH_BEFORE_SHA" \
 *     --github-output
 *
 * Prints the comparison SHA. `--github-output` appends `base=<sha>` and
 * `filter=...[<sha>]` to $GITHUB_OUTPUT.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_FALLBACK_REF = 'origin/main';
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const FULL_SHA_RE = /^[0-9a-f]{40}$/i;
const ZERO_SHA_RE = /^0{40}$/;

/** @param {unknown} value */
function normalize(value) {
  return value == null ? '' : String(value).trim();
}

/**
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
  if (!SHA_RE.test(String(baseSha ?? '').trim())) {
    throw new Error(`Invalid turbo filter base SHA: ${JSON.stringify(baseSha)}`);
  }
  return `...[${baseSha.trim()}]`;
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

  const resolver = opts.changedFilesBase ? resolveChangedFilesBase : resolveTurboFilterBase;
  const base = resolver({
    eventName: opts.eventName,
    prBaseSha: opts.prBaseSha,
    pushBeforeSha: opts.pushBeforeSha,
    fallbackRef: opts.fallbackRef,
    headRef: opts.headRef,
    execGit: defaultExecGit,
  });
  const filter = formatTurboFilter(base);
  process.stdout.write(`${base}\n`);

  if (opts.githubOutput) {
    const path = process.env.GITHUB_OUTPUT;
    if (!path) {
      throw new Error('--github-output requires GITHUB_OUTPUT');
    }
    appendFileSync(path, `base=${base}\nfilter=${filter}\n`);
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
