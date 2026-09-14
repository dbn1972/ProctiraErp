#!/usr/bin/env node
/**
 * Unit tests for W1-OPS-22 turbo filter base resolver.
 * Run with: node --test tools/scripts/resolve-turbo-filter-base.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertCiAvoidsTurboHeadParent,
  formatTurboFilter,
  resolveTurboFilterBase,
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

test('falls back to origin/main when PR base SHA is empty', () => {
  const git = fakeGit({
    'rev-parse --verify origin/main^{commit}': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'merge-base HEAD origin/main': '2222222222222222222222222222222222222222',
  });

  const base = resolveTurboFilterBase({
    prBaseSha: '   ',
    execGit: git.execGit,
  });

  assert.equal(base, '2222222222222222222222222222222222222222');
  assert.equal(git.calls[0][2], 'origin/main^{commit}');
});

test('falls back to origin/main when PR base SHA is null/undefined', () => {
  const git = fakeGit({
    'rev-parse --verify origin/main^{commit}': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'merge-base HEAD origin/main': '3333333333333333333333333333333333333333',
  });

  assert.equal(
    resolveTurboFilterBase({ prBaseSha: null, execGit: git.execGit }),
    '3333333333333333333333333333333333333333',
  );
  assert.equal(
    resolveTurboFilterBase({ prBaseSha: undefined, execGit: git.execGit }),
    '3333333333333333333333333333333333333333',
  );
});

test('multi-commit PR: merge-base is older than HEAD~1 tip parent', () => {
  // Simulate: main tip = baseSha; PR has commits C1 then C2 (HEAD).
  // HEAD~1 would be C1 and miss packages only changed in C1 relative to main
  // when filtering ...[HEAD~1] from C2. merge-base with baseSha is M.
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

test('throws when candidate ref cannot be resolved', () => {
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

test('assertCiAvoidsTurboHeadParent allows merge-base filter placeholders', () => {
  const good = `
        run: pnpm turbo run typecheck --filter='\${{ steps.turbo.outputs.filter }}'
        run: git diff --name-only HEAD~1 HEAD -- '*.ts'
  `;
  const report = assertCiAvoidsTurboHeadParent(good);
  assert.equal(report.ok, true);
  assert.equal(report.hits.length, 0);
});

test('ci.yml no longer uses turbo ...[HEAD~1] filters', () => {
  const yaml = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const report = assertCiAvoidsTurboHeadParent(yaml);
  assert.equal(
    report.ok,
    true,
    `ci.yml still has tip-only turbo filters:\n${report.hits.join('\n')}`,
  );
  assert.match(yaml, /resolve-turbo-filter-base\.mjs/);
  assert.match(yaml, /W1-OPS-22/);
});
