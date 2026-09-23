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

/**
 * Browser and edge-runtime source trees whose token handling must go through
 * this module. Apps that do not read tokens today are included on purpose: the
 * point of the guard is to be already in place the day one of them starts.
 */
const SCANNED_ROOTS = [
  'apps/web/src',
  'apps/admin-console/src',
  'apps/public-website/src',
  'apps/registration-portal/src',
  'apps/install-wizard/src',
  'apps/developer-portal/src',
];

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

/**
 * True when a line is prose rather than code: a `//` comment, or a `*` / `/*`
 * line inside a doc block.
 *
 * Deliberately line-oriented. Stripping block comments with a global regex
 * first reads tidier, but an unterminated `/*` inside a string or regex literal
 * would then swallow every line up to the next close marker anywhere in the
 * file, hiding an `atob()` call behind it. A scanner that can silently blind
 * itself is worse than no scanner. The trade is a possible false positive on a
 * trailing inline comment, which is loud and trivially fixed.
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/** Lines of `source` that call `atob()` outside a comment. */
function offendingLines(source: string): string[] {
  return source.split('\n').filter((line) => !isCommentLine(line) && RAW_ATOB_CALL.test(line));
}

function offenders(): string[] {
  const found: string[] = [];
  for (const root of SCANNED_ROOTS) {
    for (const file of walk(join(REPO_ROOT, root))) {
      const rel = relative(REPO_ROOT, file);
      if (ALLOWED.has(rel)) continue;
      if (offendingLines(readFileSync(file, 'utf8')).length > 0) found.push(rel);
    }
  }
  return found.sort();
}

describe('no raw atob() in application source', () => {
  it.each(SCANNED_ROOTS)('actually scans %s', (root) => {
    // Per root, not summed. `apps/web/src` alone holds ~800 files, so a total
    // count would stay comfortably above any threshold after a rename silently
    // dropped `apps/admin-console/src` — the very tree this bug shipped in
    // twice. A moved or renamed app must fail here, not pass quietly.
    expect(walk(join(REPO_ROOT, root)).length).toBeGreaterThan(0);
  });

  it('finds no direct atob() call outside the sanctioned decoder', () => {
    expect(offenders()).toEqual([]);
  });

  it.each([
    'const p = JSON.parse(atob(parts[1]!));',
    '  binary = atob(base64);',
    'const x = globalThis.atob (s);',
    'const y = window.atob(s);',
  ])('would catch the reintroduction %j', (line) => {
    expect(offendingLines(line)).toEqual([line]);
  });

  it.each([
    '// the middleware\u2019s atob() need',
    ' * `atob()` implements standard base64 and throws',
    '/* atob(x) in a doc block */',
    'safeAtob(segment);',
    "const note = 'atob(' + segment;",
  ])('does not trip on %j', (line) => {
    expect(offendingLines(line)).toEqual([]);
  });

  it('cannot be blinded by an unterminated block-comment marker in a literal', () => {
    // The failure mode of a global block-comment strip: `/*` inside a string
    // with no matching close would hide everything after it.
    const source = ["const marker = '/*';", 'const p = atob(segment);'].join('\n');
    expect(offendingLines(source)).toEqual(['const p = atob(segment);']);
  });
});
