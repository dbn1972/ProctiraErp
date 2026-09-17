#!/usr/bin/env node
/**
 * Unit tests for W1-OPS-22 turbo filter base resolver.
 * Run with: node --test tools/scripts/resolve-turbo-filter-base.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertCiAvoidsTurboHeadParent,
  formatTurboFilter,
  FULL_PACKAGE_FILTER,
  resolveTurboFilterBase,
  resolveTurboFilterSelection,
} from './resolve-turbo-filter-base.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');

function fakeGit(responses) {
  /** @type {string[][]} */
  const calls = [];
  return {
    calls,
    execGit(args) {
      calls.push([...args]);
      const key = args.join(' ');
      if (Object.prototype.hasOwnProperty.call(responses, key)) {
        const value = responses[key];
        if (value instanceof Error) throw value;
        return value;
      }
      throw new Error(`unexpected git ${key}`);
    },
  };
}

test('prefers PR base SHA and returns merge-base with HEAD', () => {
  const git = fakeGit({
    'rev-parse --verify abcdef0123456789abcdef0123456789abcdef01^{commit}':
      'abcdef0123456789abcdef0123456789abcdef01',
    'merge-base HEAD abcdef0123456789abcdef0123456789abcdef01':
      '1111111111111111111111111111111111111111',
  });

  const base = resolveTurboFilterBase({
    prBaseSha: 'abcdef0123456789abcdef0123456789abcdef01',
    execGit: git.execGit,
  });

  assert.equal(base, '1111111111111111111111111111111111111111');
  assert.deepEqual(git.calls[0], [
    'rev-parse',
    '--verify',
    'abcdef0123456789abcdef0123456789abcdef01^{commit}',
  ]);
  assert.deepEqual(git.calls[1], [
    'merge-base',
    'HEAD',
    'abcdef0123456789abcdef0123456789abcdef01',
  ]);
});

test('pull request selection requires and merge-bases the PR target', () => {
  const target = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const base = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const git = fakeGit({
    [`rev-parse --verify ${target}^{commit}`]: target,
    [`merge-base HEAD ${target}`]: base,
  });

  const selection = resolveTurboFilterSelection({
    eventName: 'pull_request',
    prBaseSha: target,
    pushBeforeSha: '',
    execGit: git.execGit,
  });

  assert.deepEqual(selection, {
    base,
    filter: `...[${base}]`,
    mode: 'pull_request',
    reason: 'pull_request_merge_base',
  });
  assert.throws(
    () =>
      resolveTurboFilterSelection({
        eventName: 'pull_request',
        prBaseSha: '',
        pushBeforeSha: '',
        execGit: git.execGit,
      }),
    /requires PR_BASE_SHA/,
  );
});

test('real explicit target fetch preserves divergent PR ancestry', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'w1-ops-22-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  const checkout = join(root, 'checkout');
  const runGit = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

  runGit(root, 'init', '--bare', remote);
  runGit(root, 'init', seed);
  runGit(seed, 'config', 'user.name', 'W1 OPS 22 Test');
  runGit(seed, 'config', 'user.email', 'w1-ops-22@example.invalid');
  writeFileSync(join(seed, 'base.txt'), 'base\n');
  runGit(seed, 'add', 'base.txt');
  runGit(seed, 'commit', '-m', 'base');
  runGit(seed, 'branch', '-M', 'main');
  runGit(seed, 'remote', 'add', 'origin', remote);
  runGit(seed, 'push', '-u', 'origin', 'main');
  const commonBase = runGit(seed, 'rev-parse', 'HEAD');

  runGit(seed, 'checkout', '-b', 'feature');
  writeFileSync(join(seed, 'feature.txt'), 'feature\n');
  runGit(seed, 'add', 'feature.txt');
  runGit(seed, 'commit', '-m', 'feature');
  runGit(seed, 'push', '-u', 'origin', 'feature');

  runGit(seed, 'checkout', 'main');
  writeFileSync(join(seed, 'target.txt'), 'target\n');
  runGit(seed, 'add', 'target.txt');
  runGit(seed, 'commit', '-m', 'target');
  const targetSha = runGit(seed, 'rev-parse', 'HEAD');
  runGit(seed, 'push', 'origin', 'main');

  runGit(root, 'clone', '--no-local', '--branch', 'feature', remote, checkout);
  runGit(checkout, 'fetch', '--no-tags', 'origin', targetSha);
  assert.equal(runGit(checkout, 'rev-parse', '--is-shallow-repository'), 'false');

  const selection = resolveTurboFilterSelection({
    eventName: 'pull_request',
    prBaseSha: targetSha,
    pushBeforeSha: '',
    execGit(args) {
      return runGit(checkout, ...args);
    },
  });
  assert.equal(selection.base, commonBase);
  assert.equal(selection.filter, `...[${commonBase}]`);
});

test('push selection uses an ancestor github.event.before instead of origin/main', () => {
  const before = '1111111111111111111111111111111111111111';
  const head = '2222222222222222222222222222222222222222';
  const git = fakeGit({
    [`rev-parse --verify ${before}^{commit}`]: before,
    'rev-parse --verify HEAD^{commit}': head,
    [`merge-base HEAD ${before}`]: before,
  });

  const selection = resolveTurboFilterSelection({
    eventName: 'push',
    prBaseSha: '',
    pushBeforeSha: before,
    execGit: git.execGit,
  });

  assert.deepEqual(selection, {
    base: before,
    filter: `...[${before}]`,
    mode: 'push',
    reason: 'push_before',
  });
  assert.equal(
    git.calls.some((call) => call.includes('origin/main')),
    false,
  );
});

test('divergent or uncomparable push history selects all packages', () => {
  const before = '5555555555555555555555555555555555555555';
  const head = '6666666666666666666666666666666666666666';
  const ancestor = '7777777777777777777777777777777777777777';

  const divergent = fakeGit({
    [`rev-parse --verify ${before}^{commit}`]: before,
    'rev-parse --verify HEAD^{commit}': head,
    [`merge-base HEAD ${before}`]: ancestor,
  });
  const divergentSelection = resolveTurboFilterSelection({
    eventName: 'push',
    prBaseSha: '',
    pushBeforeSha: before,
    execGit: divergent.execGit,
  });
  assert.equal(divergentSelection.filter, FULL_PACKAGE_FILTER);
  assert.equal(divergentSelection.reason, 'push_before_not_ancestor');

  const uncomparable = fakeGit({
    [`rev-parse --verify ${before}^{commit}`]: before,
    'rev-parse --verify HEAD^{commit}': head,
    [`merge-base HEAD ${before}`]: new Error('no merge base'),
  });
  const uncomparableSelection = resolveTurboFilterSelection({
    eventName: 'push',
    prBaseSha: '',
    pushBeforeSha: before,
    execGit: uncomparable.execGit,
  });
  assert.equal(uncomparableSelection.filter, FULL_PACKAGE_FILTER);
  assert.equal(uncomparableSelection.reason, 'push_before_uncomparable');
});

test('new-branch or missing push before SHA selects all packages', () => {
  for (const pushBeforeSha of ['', 'not-a-sha', '0000000000000000000000000000000000000000']) {
    const git = fakeGit({});
    const selection = resolveTurboFilterSelection({
      eventName: 'push',
      prBaseSha: '',
      pushBeforeSha,
      execGit: git.execGit,
    });
    assert.equal(selection.base, '');
    assert.equal(selection.filter, FULL_PACKAGE_FILTER);
    assert.equal(selection.mode, 'full');
    assert.equal(selection.reason, 'push_before_missing_or_zero');
    assert.equal(git.calls.length, 0);
  }
});

test('unavailable push before SHA selects all packages', () => {
  const before = '3333333333333333333333333333333333333333';
  const git = fakeGit({
    [`rev-parse --verify ${before}^{commit}`]: new Error('unknown revision'),
  });

  const selection = resolveTurboFilterSelection({
    eventName: 'push',
    prBaseSha: '',
    pushBeforeSha: before,
    execGit: git.execGit,
  });

  assert.equal(selection.filter, FULL_PACKAGE_FILTER);
  assert.equal(selection.mode, 'full');
  assert.equal(selection.reason, 'push_before_unresolvable');
});

test('push before equal to HEAD selects all packages rather than no work', () => {
  const sha = '4444444444444444444444444444444444444444';
  const git = fakeGit({
    [`rev-parse --verify ${sha}^{commit}`]: sha,
    'rev-parse --verify HEAD^{commit}': sha,
  });

  const selection = resolveTurboFilterSelection({
    eventName: 'push',
    prBaseSha: '',
    pushBeforeSha: sha,
    execGit: git.execGit,
  });

  assert.equal(selection.filter, FULL_PACKAGE_FILTER);
  assert.equal(selection.reason, 'push_before_equals_head');
});

test('non-CI invocation preserves origin/main merge-base compatibility', () => {
  const git = fakeGit({
    'rev-parse --verify origin/main^{commit}': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'merge-base HEAD origin/main': '3333333333333333333333333333333333333333',
  });

  const selection = resolveTurboFilterSelection({
    eventName: '',
    prBaseSha: undefined,
    pushBeforeSha: undefined,
    execGit: git.execGit,
  });

  assert.equal(selection.base, '3333333333333333333333333333333333333333');
  assert.equal(selection.mode, 'fallback');
});

test('multi-commit PR: merge-base is older than HEAD~1 tip parent', () => {
  const baseSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const mergeBase = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const tipParent = 'cccccccccccccccccccccccccccccccccccccccc';

  const git = fakeGit({
    [`rev-parse --verify ${baseSha}^{commit}`]: baseSha,
    [`merge-base HEAD ${baseSha}`]: mergeBase,
    'rev-parse --verify HEAD~1^{commit}': tipParent,
  });

  const resolved = resolveTurboFilterBase({
    prBaseSha: baseSha,
    execGit: git.execGit,
  });

  assert.equal(resolved, mergeBase);
  assert.notEqual(resolved, tipParent);
  assert.equal(formatTurboFilter(resolved), `...[${mergeBase}]`);
});

test('formatTurboFilter rejects invalid SHA', () => {
  assert.throws(() => formatTurboFilter('HEAD~1'), /Invalid turbo filter base SHA/);
  assert.throws(() => formatTurboFilter(''), /Invalid turbo filter base SHA/);
});

test('throws when fallback candidate ref cannot be resolved', () => {
  const git = fakeGit({
    'rev-parse --verify origin/main^{commit}': new Error('fatal: Needed a single revision'),
  });
  assert.throws(
    () => resolveTurboFilterBase({ prBaseSha: '', execGit: git.execGit }),
    /not resolvable/,
  );
});

test('assertCiAvoidsTurboHeadParent flags turbo HEAD~1 filters', () => {
  const bad = `
        run: pnpm turbo run typecheck --filter='...[HEAD~1]'
        run: pnpm turbo run test --filter="...[HEAD~1]" --coverage
  `;
  const report = assertCiAvoidsTurboHeadParent(bad);
  assert.equal(report.ok, false);
  assert.equal(report.hits.length, 2);
});

test('assertCiAvoidsTurboHeadParent allows event-aware filter placeholders', () => {
  const good = `
        run: pnpm turbo run typecheck --filter='\${{ steps.turbo.outputs.filter }}'
        run: git diff --name-only HEAD~1 HEAD -- '*.ts'
  `;
  const report = assertCiAvoidsTurboHeadParent(good);
  assert.equal(report.ok, true);
  assert.equal(report.hits.length, 0);
});

test('ci.yml wires each affected job and requires the resolver suite', () => {
  const yaml = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const report = assertCiAvoidsTurboHeadParent(yaml);
  assert.equal(
    report.ok,
    true,
    `ci.yml still has tip-only turbo filters:\n${report.hits.join('\n')}`,
  );

  function jobBlock(jobName) {
    const marker = `\n  ${jobName}:\n`;
    const start = yaml.indexOf(marker);
    assert.notEqual(start, -1, `missing CI job ${jobName}`);
    const remainder = yaml.slice(start + marker.length);
    const nextJob = remainder.search(/\n  [a-zA-Z0-9_-]+:\n/);
    return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
  }

  for (const jobName of ['typecheck', 'unit-test', 'build', 'integration-test']) {
    const block = jobBlock(jobName);
    assert.equal(
      (block.match(/resolve-turbo-filter-base\.mjs --github-output/g) ?? []).length,
      1,
      `${jobName} must invoke the resolver exactly once`,
    );
    assert.match(block, /EVENT_NAME:\s*\$\{\{ github\.event_name \}\}/);
    assert.match(block, /PR_BASE_SHA:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
    assert.match(block, /PUSH_BEFORE_SHA:\s*\$\{\{ github\.event\.before \}\}/);
    assert.match(block, /git fetch --no-tags origin "\$PR_BASE_SHA"/);
    assert.match(block, /git fetch --no-tags origin "\$PUSH_BEFORE_SHA"/);
    assert.equal(
      (block.match(/fetch-depth:\s*0/g) ?? []).length,
      1,
      `${jobName} must check out complete history exactly once`,
    );
    assert.doesNotMatch(
      block,
      /(^|\s)--(?:depth(?:=|\s+)\d+|deepen(?:=|\s+)\d+|shallow-since(?:=|\s+)|shallow-exclude(?:=|\s+))/m,
    );
    assert.match(block, /steps\.turbo\.outputs\.filter/);
  }

  const detectChanges = jobBlock('detect-changes');
  assert.match(detectChanges, /node --test tools\/scripts\/resolve-turbo-filter-base\.test\.mjs/);
  assert.match(yaml, /W1-OPS-22/);
});
