/**
 * Tests for the brand-string CI gate (task 57.4 / Design M).
 *
 * Runs the scanner against synthetic fixtures (a temp directory containing a
 * disallowed Markdown file, an allowlisted Markdown file, and a separately
 * supplied allowlist) and asserts the expected exit code, violation list,
 * and stdout/stderr formatting.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// @ts-expect-error - direct .mjs import; types are not generated.
import * as scanner from '../check-brand-strings.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, '..', 'check-brand-strings.mjs');

async function makeFixtureDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'brand-strings-fix-'));
}

async function writeFixture(root: string, relPath: string, content: string): Promise<void> {
  const full = join(root, relPath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
}

async function writeAllowlist(root: string, globs: string[]): Promise<string> {
  const file = join(root, 'allowlist.json');
  await writeFile(file, JSON.stringify({ categories: { test: globs } }, null, 2), 'utf8');
  return file;
}

function runCli(
  root: string,
  allowlistPath: string,
  extraArgs: string[] = [],
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [scriptPath, `--root=${root}`, `--allowlist=${allowlistPath}`, '--force-node', ...extraArgs],
    { encoding: 'utf8' },
  );
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('check-brand-strings library functions', () => {
  it('globToRegExp matches single-segment wildcards', () => {
    const re = scanner.globToRegExp('apps/*/src/messages/*.json');
    expect(re.test('apps/web/src/messages/en.json')).toBe(true);
    expect(re.test('apps/web/src/messages/fr.json')).toBe(true);
    expect(re.test('apps/web/src/other/en.json')).toBe(false);
    // single * does not cross a `/`
    expect(re.test('apps/web/deep/src/messages/en.json')).toBe(false);
  });

  it('globToRegExp matches recursive `**` segments', () => {
    const re = scanner.globToRegExp('infrastructure/**');
    expect(re.test('infrastructure/helm/proctira/values.yaml')).toBe(true);
    expect(re.test('infrastructure/Chart.yaml')).toBe(true);
    expect(re.test('infra/something.yaml')).toBe(false);
  });

  it('globToRegExp matches `**/foo` at any depth', () => {
    const re = scanner.globToRegExp('**/README.md');
    expect(re.test('README.md')).toBe(true);
    expect(re.test('packages/ui/README.md')).toBe(true);
    expect(re.test('a/b/c/README.md')).toBe(true);
    expect(re.test('README.txt')).toBe(false);
  });

  it('buildBrandRegExp escapes regex metacharacters', () => {
    const re = scanner.buildBrandRegExp(['Open.EMIS', 'EduZo']);
    expect(re.test('Open.EMIS')).toBe(true);
    expect(re.test('OpenXEMIS')).toBe(false); // `.` was escaped
    expect(re.test('EduZo')).toBe(true);
  });

  it('scanText returns 1-indexed line numbers', () => {
    const re = scanner.buildBrandRegExp(['ProctiraERP']);
    const text = 'first line\nsecond ProctiraERP line\nthird line';
    const hits = scanner.scanText(text, re);
    expect(hits).toEqual([{ line: 2, content: 'second ProctiraERP line' }]);
  });

  it('isAllowlisted returns true on any matching glob', () => {
    const re1 = scanner.globToRegExp('docs/**');
    const re2 = scanner.globToRegExp('**/README.md');
    const list = { globs: ['docs/**', '**/README.md'], matchers: [re1, re2] };
    expect(scanner.isAllowlisted('docs/onboarding.md', list)).toBe(true);
    expect(scanner.isAllowlisted('packages/ui/README.md', list)).toBe(true);
    expect(scanner.isAllowlisted('apps/web/page.md', list)).toBe(false);
  });
});

describe('check-brand-strings CLI', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeFixtureDir();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('exits 0 with no matches at all', async () => {
    await writeFixture(root, 'docs/clean.md', '# Hello world\nNo brands here.\n');
    const allow = await writeAllowlist(root, []);
    const out = runCli(root, allow);
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/0 violations/);
  });

  it('exits 1 when a non-allowlisted file contains a brand string', async () => {
    await writeFixture(
      root,
      'docs/marketing.md',
      'Welcome to ProctiraERP — the leading platform.\n',
    );
    const allow = await writeAllowlist(root, []);
    const out = runCli(root, allow);
    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/1 hardcoded brand string/);
    expect(out.stderr).toContain('docs/marketing.md:1:');
    expect(out.stderr).toContain('ProctiraERP');
  });

  it('exits 0 when the only matching file is allowlisted', async () => {
    await writeFixture(
      root,
      'docs/marketing.md',
      'Welcome to ProctiraERP — the leading platform.\n',
    );
    const allow = await writeAllowlist(root, ['docs/**']);
    const out = runCli(root, allow);
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/0 violations/);
    // The hit was counted but allowlisted.
    expect(out.stdout).toMatch(/1 allowlisted match/);
  });

  it('reports each violating line for multi-match files', async () => {
    await writeFixture(
      root,
      'page.html',
      ['<h1>ProctiraERP</h1>', '<p>safe line</p>', '<footer>Powered by EduZo</footer>'].join('\n'),
    );
    const allow = await writeAllowlist(root, []);
    const out = runCli(root, allow);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('page.html:1:');
    expect(out.stderr).toContain('page.html:3:');
  });

  it('honors --brands to override the default brand list', async () => {
    await writeFixture(root, 'docs/note.md', 'Acme Corp ships great software.\n');
    const allow = await writeAllowlist(root, []);

    // With default brands the file is clean.
    const passing = runCli(root, allow);
    expect(passing.status).toBe(0);

    // With a custom brand the file is now a violation.
    const failing = runCli(root, allow, ['--brands=Acme']);
    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain('docs/note.md:1:');
  });

  it('emits structured JSON when --json is passed', async () => {
    await writeFixture(root, 'docs/marketing.md', 'ProctiraERP rules.\n');
    await writeFixture(root, 'docs/internal/notes.md', 'EduZo internal.\n');
    const allow = await writeAllowlist(root, ['docs/internal/**']);

    const out = runCli(root, allow, ['--json']);
    expect(out.status).toBe(1);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.engine).toBe('node');
    expect(parsed.totalHits).toBe(2);
    expect(parsed.violations).toHaveLength(1);
    expect(parsed.violations[0].relPath).toBe('docs/marketing.md');
    expect(parsed.violations[0].line).toBe(1);
  });

  it('skips file extensions outside the scanner whitelist', async () => {
    // .ts files are explicitly NOT scanned (covered by the ESLint rule).
    await writeFixture(root, 'src/widget.ts', 'export const APP = "ProctiraERP";\n');
    const allow = await writeAllowlist(root, []);
    const out = runCli(root, allow);
    expect(out.status).toBe(0);
  });
});
