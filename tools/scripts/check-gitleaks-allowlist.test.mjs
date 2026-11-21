// UAT-9c: every `.gitleaks.toml` allowlist entry must be anchored so it
// cannot over-match. gitleaks tests allowlist `regexes` against the finding's
// secret (default `regexTarget = "secret"`) with an unanchored RE2 search, so
// '''pw-123456789''' also allowlists a real secret that merely contains it.
// Each regex must therefore be `^<literal>$` and each path `^<prefix>`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const config = readFileSync(join(here, '../../.gitleaks.toml'), 'utf8');

/** Literal strings ('''…''', '…' or "…") of the top-level `[allowlist]` array `key`. */
function allowlistArray(key) {
  const section = config.split(/^\[allowlist\]\s*$/m)[1];
  assert.ok(section, '.gitleaks.toml has an [allowlist] table');
  const body = section.split(/^\[/m)[0];
  const match = body.match(new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)^\\]`, 'm'));
  assert.ok(match, `[allowlist] has a ${key} array`);
  const withoutComments = match[1]
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  return [...withoutComments.matchAll(/'''([\s\S]*?)'''|'([^'\n]*)'|"((?:[^"\\\n]|\\.)*)"/g)].map(
    (m) => m[1] ?? m[2] ?? m[3],
  );
}

// Regex metacharacters that make an entry more than one literal value.
const UNESCAPED_META = /(?<!\\)[.*+?()[\]{}|^$]/;

const regexes = allowlistArray('regexes');
const paths = allowlistArray('paths');

test('the parser finds the allowlist entries', () => {
  assert.ok(regexes.length > 0, 'expected allowlist regexes');
  assert.ok(paths.length > 0, 'expected allowlist paths');
});

test('every allowlist regex is anchored ^…$ around one literal value', () => {
  for (const entry of regexes) {
    assert.match(entry, /^\^/, `regex '${entry}' must start with ^`);
    assert.match(entry, /(?<!\\)\$$/, `regex '${entry}' must end with $`);
    const literal = entry.slice(1, -1);
    assert.doesNotMatch(
      literal,
      UNESCAPED_META,
      `regex '${entry}' must be one literal value (escape '.' and other metacharacters)`,
    );
  }
});

test('an anchored regex allowlists its value and not a superstring secret', () => {
  for (const entry of regexes) {
    const value = entry
      .replace(/^\^/, '')
      .replace(/(?<!\\)\$$/, '')
      .replace(/\\(.)/g, '$1');
    const re = new RegExp(entry);
    assert.ok(re.test(value), `'${entry}' must still allowlist ${value}`);
    assert.ok(!re.test(`x${value}`), `'${entry}' must not allowlist a prefixed secret`);
    assert.ok(!re.test(`${value}-REAL0secret`), `'${entry}' must not allowlist a longer secret`);
  }
});

test('every allowlist path is anchored to the repository root', () => {
  for (const entry of paths) {
    assert.match(entry, /^\^/, `path '${entry}' must start with ^`);
    const re = new RegExp(entry);
    assert.ok(re.test('apps/web/.next/server/app.js'), `'${entry}' still covers Next build output`);
    assert.ok(
      !re.test('packages/x/apps/web/.next/leak.ts'),
      `'${entry}' must not match a nested apps/web/.next directory`,
    );
    assert.ok(!re.test('apps/web/xnext/leak.ts'), `'${entry}' must escape the literal '.'`);
  }
});
