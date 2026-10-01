/**
 * PRC-L384 — bundle gate fails closed on absent routes and on growth vs the
 * recorded baseline. Hermetic synthetic `.next/` fixtures; no web build.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absentRouteFailures, compareToBaseline } from './check-bundle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, 'check-bundle.mjs');

function fixture(pages, chunkBytes = 2048) {
  const dir = mkdtempSync(join(tmpdir(), 'l384-'));
  mkdirSync(join(dir, 'static/chunks'), { recursive: true });
  // Incompressible-ish content so gzip size tracks raw size.
  let s = '';
  for (let i = 0; s.length < chunkBytes; i += 1) s += `${(i * 2654435761) % 1000003},`;
  writeFileSync(join(dir, 'static/chunks/a.js'), s);
  writeFileSync(join(dir, 'app-build-manifest.json'), JSON.stringify({ pages }));
  return dir;
}

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [cli, '--no-build', ...args], {
    encoding: 'utf8',
    env: { ...process.env, CI: 'false', ...env },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

const allKeys = {
  '/layout': ['static/chunks/a.js'],
  '/(auth)/layout': [],
  '/(auth)/login/page': [],
  '/(dashboard)/layout': [],
  '/(dashboard)/page': [],
  '/(dashboard)/attendance/page': [],
};

test('manifest with no matching route keys exits 1 (local and CI)', () => {
  const dir = fixture({ '/other/page': ['static/chunks/a.js'] });
  try {
    for (const CI of ['false', 'true']) {
      const r = run([`--build-dir=${dir}`], { CI });
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /absent from the manifest/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('absentRouteFailures: partial absence fails only in CI', () => {
  const reports = [
    { canonical: '/a', present: true },
    { canonical: '/b', present: false },
  ];
  assert.deepEqual(absentRouteFailures(reports, { ci: false }), []);
  assert.deepEqual(
    absentRouteFailures(reports, { ci: true }).map((r) => r.canonical),
    ['/b'],
  );
  assert.equal(absentRouteFailures([{ canonical: '/a', present: false }]).length, 1);
});

test('compareToBaseline: 10% growth fails, 3% passes, unknown route fails', () => {
  const baseline = { routes: [{ canonical: '/a', present: true, totalGzipBytes: 1000 }] };
  assert.equal(
    compareToBaseline([{ canonical: '/a', present: true, totalGzipBytes: 1100 }], baseline).length,
    1,
  );
  assert.equal(
    compareToBaseline([{ canonical: '/a', present: true, totalGzipBytes: 1030 }], baseline).length,
    0,
  );
  assert.equal(
    compareToBaseline([{ canonical: '/z', present: true, totalGzipBytes: 1 }], baseline).length,
    1,
  );
});

test('--compare-baseline exits 1 when a route grew 10% over the baseline', () => {
  const dir = fixture(allKeys);
  try {
    const basePath = join(dir, 'baseline.json');
    // Record a baseline, then shrink it by ~10% to simulate growth.
    assert.equal(
      run([`--build-dir=${dir}`, '--baseline', `--baseline-path=${basePath}`]).status,
      0,
    );
    const json = JSON.parse(
      spawnSync(process.execPath, [cli, '--no-build', `--build-dir=${dir}`, '--json', '--quiet'], {
        encoding: 'utf8',
        env: { ...process.env, CI: 'false' },
      }).stdout,
    );
    const routes = json.routes.map((r) => ({
      canonical: r.canonical,
      present: true,
      totalGzipBytes: Math.floor(r.totalGzipBytes / 1.1),
    }));
    writeFileSync(basePath, JSON.stringify({ routes }));
    const r = run([`--build-dir=${dir}`, '--compare-baseline', `--baseline-path=${basePath}`]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /regressed vs baseline/);
    // Same sizes as baseline pass.
    writeFileSync(
      basePath,
      JSON.stringify({ routes: json.routes.map((x) => ({ ...x, present: true })) }),
    );
    const ok = run([`--build-dir=${dir}`, '--compare-baseline', `--baseline-path=${basePath}`]);
    assert.equal(ok.status, 0, ok.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
