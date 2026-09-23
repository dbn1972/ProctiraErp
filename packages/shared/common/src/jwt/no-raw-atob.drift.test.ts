import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guard: JWT payloads must be decoded through `@proctira/common/jwt`, never by
 * calling `atob()` directly.
 *
 * This bug shipped six times — two middlewares and two session helpers across
 * `apps/web` and `apps/admin-console` — because each app grew its own copy of
 * the same four-line decode. `atob()` implements standard base64, so it throws
 * on the `-`/`_` that RFC 7519 requires, and it returns latin1 bytes rather
 * than UTF-8. Both failures surface as "the payload did not decode", which
 * every one of those call sites turned into a redirect to `/login`.
 *
 * Scoped to application source: a legitimate `atob()` for non-JWT data (file
 * uploads, images) belongs behind its own reviewed helper, so if this guard
 * ever needs to allow one, add it to ALLOWED with a reason.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');

/** Application source trees whose token handling must go through this module. */
const SCANNED_ROOTS = ['apps/web/src', 'apps/admin-console/src', 'apps/public-website/src'];

/** Files permitted to call `atob()` directly, each with a reason. */
const ALLOWED = new Map<string, string>([
  [
    'packages/shared/common/src/jwt/decode.ts',
    'the sanctioned implementation — it normalises the alphabet before calling atob()',
  ],
]);

const CODE_FILE = /\.(ts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;
/**
 * `atob(` as a call. `.` is *not* excluded before the name, so `window.atob(`
 * and `globalThis.atob(` are caught too. Quote characters are excluded so a
 * literal mentioning the name does not trip the scan.
 */
const RAW_ATOB_CALL = /(^|[^\w'"`])atob\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // Tree absent in this checkout; nothing to assert.
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (CODE_FILE.test(entry) && !TEST_FILE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip line and block comments so prose about `atob()` does not trip the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function offenders(): string[] {
  const found: string[] = [];
  for (const root of SCANNED_ROOTS) {
    for (const file of walk(join(REPO_ROOT, root))) {
      const rel = relative(REPO_ROOT, file);
      if (ALLOWED.has(rel)) continue;
      if (RAW_ATOB_CALL.test(stripComments(readFileSync(file, 'utf8')))) found.push(rel);
    }
  }
  return found.sort();
}

describe('no raw atob() in application source', () => {
  it('scans a non-empty set of files, so a passing result means something', () => {
    const scanned = SCANNED_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root)));
    expect(scanned.length).toBeGreaterThan(100);
  });

  it('finds no direct atob() call outside the sanctioned decoder', () => {
    expect(offenders()).toEqual([]);
  });

  it('would catch a reintroduction (the matcher is not vacuous)', () => {
    expect(RAW_ATOB_CALL.test('const p = JSON.parse(atob(parts[1]!));')).toBe(true);
    expect(RAW_ATOB_CALL.test('  binary = atob(base64);')).toBe(true);
    expect(RAW_ATOB_CALL.test('const x = globalThis.atob (s);')).toBe(true);
    // Prose and identifiers that merely contain the name must not trip it.
    expect(RAW_ATOB_CALL.test(stripComments('// the middleware\u2019s atob() need'))).toBe(false);
    expect(RAW_ATOB_CALL.test('safeAtob(segment);')).toBe(false);
  });
});
