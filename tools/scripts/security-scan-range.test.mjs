import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('gitleaks scans the complete pull-request commit graph', () => {
  const workflow = readFileSync(join(root, '.github/workflows/security-scans.yml'), 'utf8');
  // PRC-M256: event values reach the script through env, not inline expressions.
  assert.match(workflow, /PR_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /PR_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /--log-opts "\$\{PR_BASE_SHA\}\.\.\$\{PR_HEAD_SHA\}"/);
  assert.doesNotMatch(workflow, /--no-merges|--first-parent/);
});

test('gitleaks on push scans the pushed commit history, not every fetched ref (UAT-ENV-014)', () => {
  const workflow = readFileSync(join(root, '.github/workflows/security-scans.yml'), 'utf8');
  assert.match(workflow, /PUSH_SHA: \$\{\{ github\.sha \}\}/);
  const push = workflow.match(/elif \[ "\$\{EVENT_NAME\}" = "push" \]; then([\s\S]*?)\n\s*else\n/);
  assert.ok(push, 'secret scan needs a push branch');
  assert.match(push[1], /gitleaks detect[\s\S]*--log-opts "\$\{PUSH_SHA\}"[\s\S]*--exit-code 1/);
  assert.match(push[1], /git cat-file -e "\$\{PUSH_SHA\}\^\{commit\}"/);
  // Exactly one revision: no `--all`, no `before..after` range that would drop older history.
  const logOpts = push[1].match(/^\s*--log-opts\s+\S+/gm).map((s) => s.trim());
  assert.deepEqual(logOpts, ['--log-opts "${PUSH_SHA}"']);
});

test('pushed-commit range covers all merged history and excludes unmerged branches', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'uat-env-014-gitleaks-push-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'UAT Security Test');
  git(repo, 'config', 'user.email', 'uat-security@example.invalid');
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, 'add', 'base.txt');
  git(repo, 'commit', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-b', 'merged-feature');
  writeFileSync(join(repo, 'merged.txt'), 'merged\n');
  git(repo, 'add', 'merged.txt');
  git(repo, 'commit', '-m', 'merged feature');
  const merged = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-b', 'unmerged-feature', base);
  writeFileSync(join(repo, 'unmerged.txt'), 'unmerged\n');
  git(repo, 'add', 'unmerged.txt');
  git(repo, 'commit', '-m', 'unmerged feature');
  const unmerged = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', 'main');
  git(repo, 'merge', '--no-ff', '--no-edit', 'merged-feature');
  const pushed = git(repo, 'rev-parse', 'HEAD');

  // Old push behaviour: gitleaks without --log-opts runs `git log --all`.
  const all = new Set(git(repo, 'rev-list', '--all').split('\n'));
  assert.equal(all.has(unmerged), true);

  // New push behaviour: --log-opts "${PUSH_SHA}" scans the pushed commit's ancestry.
  const scanned = new Set(git(repo, 'rev-list', pushed).split('\n'));
  assert.deepEqual(scanned, new Set([base, merged, pushed]));
  assert.equal(scanned.has(unmerged), false);
});

test('complete base-to-head range includes source commits hidden by first-parent no-merges', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'p0-gitleaks-range-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  git(repo, 'init');
  git(repo, 'config', 'user.name', 'P0 Security Test');
  git(repo, 'config', 'user.email', 'p0-security@example.invalid');
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, 'add', 'base.txt');
  git(repo, 'commit', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-b', 'feature-a');
  writeFileSync(join(repo, 'feature-a.txt'), 'feature a\n');
  git(repo, 'add', 'feature-a.txt');
  git(repo, 'commit', '-m', 'feature a');
  const featureA = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-b', 'integration', base);
  git(repo, 'merge', '--no-ff', '--no-edit', 'feature-a');

  git(repo, 'checkout', '-b', 'feature-b', base);
  writeFileSync(join(repo, 'feature-b.txt'), 'feature b\n');
  git(repo, 'add', 'feature-b.txt');
  git(repo, 'commit', '-m', 'feature b');
  const featureB = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', 'integration');
  git(repo, 'merge', '--no-ff', '--no-edit', 'feature-b');
  const head = git(repo, 'rev-parse', 'HEAD');

  const unsafe = git(repo, 'rev-list', '--no-merges', '--first-parent', `${base}..${head}`);
  assert.equal(unsafe, '');

  const complete = new Set(git(repo, 'rev-list', `${base}..${head}`).split('\n'));
  assert.equal(complete.has(featureA), true);
  assert.equal(complete.has(featureB), true);
});
