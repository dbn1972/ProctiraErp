/**
 * @vitest-environment node
 *
 * The e2e web server serves `next start` in CI. That only works because something
 * builds first — this pins the "something".
 *
 * `playwright.config.ts` runs `next start` when `process.env.CI` is set. `next start`
 * requires a production build in `.next/`, and nothing in the Playwright config creates
 * one. The build comes from turbo: the Integration Tests job runs
 * `pnpm turbo run test:e2e`, and `test:e2e` declares `dependsOn: ["build"]`.
 *
 * Remove that `dependsOn`, or invoke `playwright test` directly instead of through turbo,
 * and every e2e run fails at server start with "Could not find a production build" —
 * a confusing failure a long way from its cause. So the dependency is asserted here
 * rather than left as a comment.
 *
 * This is also why the five secondary Next apps keep `next dev`:
 * `tools/scripts/run-secondary-apps-e2e.sh` calls `playwright test` directly, so no build
 * runs for them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../../../..');

function turboTasks(): Record<string, { dependsOn?: string[] }> {
  const turbo = JSON.parse(readFileSync(join(REPO_ROOT, 'turbo.json'), 'utf8')) as {
    tasks?: Record<string, { dependsOn?: string[] }>;
    pipeline?: Record<string, { dependsOn?: string[] }>;
  };
  return turbo.tasks ?? turbo.pipeline ?? {};
}

describe('e2e next start precondition', () => {
  it('test:e2e depends on build, so a production build exists before the server starts', () => {
    const task = turboTasks()['test:e2e'];
    expect(task, 'turbo.json has no test:e2e task').toBeDefined();
    expect(
      task?.dependsOn ?? [],
      'playwright.config.ts runs `next start` in CI, which needs the build this dependsOn ' +
        'provides. Restore it, or switch the web server back to `next dev`.',
    ).toContain('build');
  });

  it('the CI web-server command is next start, and the local one is next dev', () => {
    // Pins both halves of the conditional: CI must not pay for an on-demand compile it
    // already paid for at build time, and a local single-spec run must not need a build.
    const config = readFileSync(join(__dirname, '../../playwright.config.ts'), 'utf8');
    expect(config).toMatch(
      /process\.env\.CI\s*\n?\s*\?\s*`pnpm --filter @proctira\/web exec next start/,
    );
    expect(config).toMatch(/:\s*`pnpm --filter @proctira\/web exec next dev/);
  });

  it('the secondary-app runner still builds nothing, so those apps must stay on next dev', () => {
    // If this ever gains a build step, the five secondary configs can switch too — and
    // this assertion is what will say so.
    const runner = readFileSync(join(REPO_ROOT, 'tools/scripts/run-secondary-apps-e2e.sh'), 'utf8');
    expect(runner).toContain('playwright test');
    expect(runner).not.toMatch(/turbo run|run build|next build/);

    for (const app of [
      'admin-console',
      'developer-portal',
      'install-wizard',
      'public-website',
      'registration-portal',
    ]) {
      const config = readFileSync(join(REPO_ROOT, 'apps', app, 'playwright.config.ts'), 'utf8');
      expect(config, `${app} would fail at server start: nothing builds it`).toContain('next dev');
      expect(config, `${app} runs next start with no build`).not.toContain('next start');
    }
  });
});
