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
  assert.match(
    workflow,
    /--log-opts "\$\{\{ github\.event\.pull_request\.base\.sha \}\}\.\.\$\{\{ github\.event\.pull_request\.head\.sha \}\}"/,
  );
  assert.doesNotMatch(workflow, /--no-merges|--first-parent/);
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
