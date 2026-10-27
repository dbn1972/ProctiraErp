#!/usr/bin/env node
/**
 * PRC-L110 — PR concurrency groups must let superseded PR runs cancel.
 *
 * A group ending in `-${{ github.sha }}` is unique per commit, so with
 * `cancel-in-progress: true` a new push to a PR never cancels the previous
 * run. For every workflow with a `pull_request` trigger, each concurrency
 * block with `cancel-in-progress: true` whose group mentions `github.sha` must
 * use the PR-number-first form, with the SHA only in the non-PR fallback:
 *
 *   ${{ github.event.pull_request.number && format('pr-{0}', github.event.pull_request.number) || format('{0}-{1}', github.ref, github.sha) }}
 *
 * PR runs then share one group per PR; push/schedule/dispatch runs stay
 * per-SHA so every main merge commit keeps its own run.
 *
 * Dependency-free (node: built-ins only, line scan) because it runs in the
 * workflow-lint job, which has no `pnpm install`.
 *
 * Usage: node tools/scripts/check-workflow-concurrency.mjs [--root <dir>]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PR_FIRST =
  "github.event.pull_request.number && format('pr-{0}', github.event.pull_request.number) ||";

function stripComment(line) {
  return line.replace(/\s+#.*$/, '');
}

/** True when the top-level `on:` block (or inline list) includes pull_request. */
export function hasPullRequestTrigger(text) {
  let inOn = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = stripComment(raw);
    if (/^\S/.test(line)) {
      const t = line.trim();
      if (/^(on|'on'|"on"):/.test(t)) {
        const inline = t.replace(/^(on|'on'|"on"):\s*/, '');
        if (/\bpull_request\b/.test(inline)) return true;
        inOn = inline === '';
      } else {
        inOn = false;
      }
      continue;
    }
    if (inOn && /^\s+pull_request:/.test(line)) return true;
  }
  return false;
}

/** Returns every mapping-style concurrency block: { line, group, cancel }. */
export function concurrencyBlocks(text) {
  const lines = String(text).split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)concurrency:\s*$/.exec(stripComment(lines[i]));
    if (!m) continue;
    const indent = m[1].length;
    const block = { line: i + 1, group: '', cancel: false };
    for (let j = i + 1; j < lines.length; j += 1) {
      const l = stripComment(lines[j]);
      if (l.trim() === '') continue;
      if (l.length - l.trimStart().length <= indent) break;
      const g = /^\s+group:\s*(.+)$/.exec(l);
      if (g) block.group = g[1].trim();
      if (/^\s+cancel-in-progress:\s*true\s*$/.test(l)) block.cancel = true;
    }
    blocks.push(block);
  }
  return blocks;
}

/** A sha-bearing group is acceptable only in the PR-number-first form. */
export function groupIsPrSafe(group) {
  if (!group.includes('github.sha')) return true;
  const idx = group.indexOf(PR_FIRST);
  if (idx < 0) return false;
  return !group.slice(0, idx + PR_FIRST.length).includes('github.sha');
}

/** Pure check. `workflows` maps file name -> text. Returns error strings. */
export function checkConcurrency(workflows) {
  const errors = [];
  for (const [file, text] of Object.entries(workflows)) {
    if (!hasPullRequestTrigger(text)) continue;
    for (const block of concurrencyBlocks(text)) {
      if (block.cancel && !groupIsPrSafe(block.group)) {
        errors.push(
          `${file}:${block.line} concurrency group uses github.sha for PR runs, so superseded PR runs never cancel: ${block.group}`,
        );
      }
    }
  }
  return errors;
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : DEFAULT_ROOT;
  const dir = join(root, '.github/workflows');
  const workflows = {};
  for (const name of readdirSync(dir).sort()) {
    if (/\.ya?ml$/.test(name)) workflows[name] = readFileSync(join(dir, name), 'utf8');
  }
  const errors = checkConcurrency(workflows);
  if (errors.length > 0) {
    console.error('check-workflow-concurrency: FAIL');
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }
  console.log(
    `check-workflow-concurrency: PASS (${Object.keys(workflows).length} workflows scanned)`,
  );
  return 0;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  process.exit(main(process.argv.slice(2)));
}
