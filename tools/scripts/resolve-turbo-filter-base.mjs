#!/usr/bin/env node
/**
 * W1-OPS-22 — Resolve the git SHA used in turbo `--filter=...[sha]`.
 *
 * `HEAD~1` only covers the tip commit, so packages touched in earlier commits
 * of a multi-commit PR are omitted. Prefer:
 *   merge-base(HEAD, github.event.pull_request.base.sha || origin/main)
 *
 * Usage (CI):
 *   PR_BASE_SHA=${{ github.event.pull_request.base.sha }} \
 *     node tools/scripts/resolve-turbo-filter-base.mjs
 *
 * Prints the merge-base SHA to stdout. Optional `--github-output` appends
 * `base=<sha>` and `filter=...[<sha>]` to $GITHUB_OUTPUT.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_FALLBACK_REF = 'origin/main';
const SHA_RE = /^[0-9a-f]{7,40}$/i;

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

  const trimmed = prBaseSha == null ? '' : String(prBaseSha).trim();
  const candidate = trimmed || fallbackRef;

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
  /** @type {{ prBaseSha?: string, fallbackRef: string, headRef: string, githubOutput: boolean, help?: boolean }} */
  const out = {
    fallbackRef: DEFAULT_FALLBACK_REF,
    headRef: 'HEAD',
    githubOutput: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--pr-base') {
      out.prBaseSha = argv[++i];
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
  if (out.prBaseSha == null && process.env.PR_BASE_SHA) {
    out.prBaseSha = process.env.PR_BASE_SHA;
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
      'Usage: resolve-turbo-filter-base.mjs [--pr-base SHA] [--fallback REF] [--head REF] [--github-output]\n',
    );
    return 0;
  }

  const base = resolveTurboFilterBase({
    prBaseSha: opts.prBaseSha,
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
