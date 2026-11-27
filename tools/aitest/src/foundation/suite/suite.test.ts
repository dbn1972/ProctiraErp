import { describe, expect, it } from 'vitest';

import { repoRootFromHere } from '../repo.js';

import { listSuites } from '../../../bin/list-suites.mjs';

import { discoverSuites, suitesForCadence } from './discover.js';
import { suiteCommand } from './runner.js';
import { validateSuiteSpec, type SuiteSpec } from './spec.js';

const root = repoRootFromHere();

describe('suite discovery', () => {
  it('finds the foundation suites and agrees with bin/list-suites.mjs', () => {
    const suites = discoverSuites(root);
    expect(suites.map((s) => s.id)).toContain('foundation-smoke');
    for (const cadence of ['nightly', 'weekly'] as const) {
      expect(listSuites(`${root}/tools/aitest`, cadence)).toEqual(
        suitesForCadence(suites, cadence).map((s) => s.id),
      );
      expect(suitesForCadence(suites, cadence).length).toBeGreaterThan(0);
    }
  });

  it('validates specs', () => {
    const ok = {
      id: 'x',
      title: 't',
      cadence: ['nightly'],
      reason: 'r',
      unit: 'foundation',
      profile: 'core',
      runner: 'vitest',
      include: ['a'],
      timeoutMinutes: 5,
    };
    expect(validateSuiteSpec(ok, 'f').id).toBe('x');
    expect(validateSuiteSpec({ ...ok, cadence: 'script' }, 'f').cadence).toBe('script');
    for (const bad of [
      { ...ok, id: 'Bad' },
      { ...ok, cadence: ['daily'] },
      { ...ok, reason: '' },
      { ...ok, profile: 'huge' },
      { ...ok, runner: 'node' },
      { ...ok, include: [] },
      { ...ok, timeoutMinutes: 301 },
    ]) {
      expect(() => validateSuiteSpec(bad, 'f')).toThrow(/^f: /);
    }
  });

  it('builds runner commands', () => {
    const spec = { runner: 'vitest', include: ['src/tracks/t02/x.aitest.ts'] } as SuiteSpec;
    expect(suiteCommand(spec, '/a')).toEqual({
      cmd: '/a/node_modules/.bin/vitest',
      args: ['run', '--config', 'vitest.aitest.config.ts', 'src/tracks/t02/x.aitest.ts'],
    });
    expect(suiteCommand({ ...spec, runner: 'playwright' }, '/a').args.slice(0, 3)).toEqual([
      'test',
      '-c',
      'playwright.aitest.config.ts',
    ]);
    expect(
      suiteCommand({ ...spec, runner: 'node', entry: 'src/tracks/t06/run.ts' }, '/a').args,
    ).toEqual(['--import', 'tsx', 'src/tracks/t06/run.ts']);
  });
});
