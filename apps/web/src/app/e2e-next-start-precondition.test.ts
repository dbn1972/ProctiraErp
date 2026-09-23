/**
 * @vitest-environment node
 *
 * The e2e web server may only use `next start` where a build actually exists.
 *
 * ## The failure this exists to prevent
 *
 * The first version of this change gated on `process.env.CI`, reasoning that CI always
 * builds first — the Integration Tests job runs `pnpm turbo run test:e2e`, and `test:e2e`
 * declares `dependsOn: ["build"]`. True of that one caller, false of the other two, and CI
 * proved it: `E2E Backend Ready` (a hard pull-request gate) and `Visual Regression` both
 * went red at web-server start with `Could not find a production build`. Both run
 * `pnpm --filter @proctira/web exec playwright test` directly rather than through turbo,
 * while GitHub Actions sets `CI` on every runner.
 *
 * The first version of *this file* asserted the turbo `dependsOn` and the state of the five
 * secondary apps — both true, neither load-bearing — and was green on that broken branch.
 * So it now asserts the property that was actually violated: at least one CI caller does
 * not build, and the resolver must choose `next dev` for it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveWebServerCommand } from '../../e2e/web-server-command';

const REPO_ROOT = join(__dirname, '../../../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Every workflow or script that runs this Playwright config. */
function webPlaywrightCallSites(): { file: string; buildsWeb: boolean }[] {
  const candidates = [
    ...walk(join(REPO_ROOT, '.github/workflows')),
    ...walk(join(REPO_ROOT, 'tools/scripts')),
  ].filter((f) => /\.(ya?ml|sh|mjs)$/.test(f));

  const sites: { file: string; buildsWeb: boolean }[] = [];
  for (const file of candidates) {
    const source = readFileSync(file, 'utf8');
    const runsWebPlaywright = /@proctira\/web'? exec playwright test|turbo run test:e2e/.test(
      source,
    );
    if (!runsWebPlaywright) continue;
    const buildsWeb =
      /turbo run test:e2e/.test(source) ||
      /--filter[= ]'?@proctira\/web'? (run )?build/.test(source);
    sites.push({ file: file.slice(REPO_ROOT.length + 1), buildsWeb });
  }
  return sites;
}

describe('e2e web server: next start only where a build exists', () => {
  it('chooses next start only when CI has produced a build', () => {
    const port = '3001';
    expect(resolveWebServerCommand({ ci: true, hasProductionBuild: true, port })).toContain(
      'next start',
    );
    // The case that broke two gates: CI is set, nothing built.
    expect(resolveWebServerCommand({ ci: true, hasProductionBuild: false, port })).toContain(
      'next dev',
    );
    // Locally `next dev` regardless, because `next start` would serve a stale `.next`
    // and `next dev` always compiles current source.
    expect(resolveWebServerCommand({ ci: false, hasProductionBuild: true, port })).toContain(
      'next dev',
    );
    expect(resolveWebServerCommand({ ci: false, hasProductionBuild: false, port })).toContain(
      'next dev',
    );
  });

  it('carries the port through unchanged', () => {
    expect(resolveWebServerCommand({ ci: true, hasProductionBuild: true, port: '4123' })).toBe(
      'pnpm --filter @proctira/web exec next start --port 4123',
    );
  });

  it('at least one CI caller does not build web, so the dev fallback is load-bearing', () => {
    // If this ever finds that every caller builds, the fallback stops being exercised and
    // a regression to a CI-only predicate would go unnoticed — which is exactly how the
    // first version of this change shipped.
    const sites = webPlaywrightCallSites();
    expect(sites.length, 'found no callers — the detection heuristic has drifted').toBeGreaterThan(
      1,
    );
    const withoutBuild = sites.filter((s) => !s.buildsWeb).map((s) => s.file);
    expect(
      withoutBuild.length,
      `every caller appears to build web (${sites.map((s) => s.file).join(', ')}); ` +
        'verify before assuming next start is always safe',
    ).toBeGreaterThan(0);
  });

  it('the turbo-driven caller still gets its build from test:e2e dependsOn', () => {
    // This is what makes `next start` reachable at all. Remove it and the Integration
    // Tests job quietly drops to `next dev` — slower, not broken, but the reason this
    // change exists disappears.
    const turbo = JSON.parse(readFileSync(join(REPO_ROOT, 'turbo.json'), 'utf8')) as {
      tasks?: Record<string, { dependsOn?: string[] }>;
      pipeline?: Record<string, { dependsOn?: string[] }>;
    };
    const task = (turbo.tasks ?? turbo.pipeline ?? {})['test:e2e'];
    expect(task, 'turbo.json has no test:e2e task').toBeDefined();
    expect(task?.dependsOn ?? []).toContain('build');
  });
});
