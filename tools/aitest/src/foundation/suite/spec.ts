import type { Profile, StackOptions, WebApp } from '../stack/types.js';

export type Cadence = 'nightly' | 'weekly';

/**
 * One runnable suite, declared in src/foundation/suite.json or
 * src/tracks/<unit>/suite.json (an object or an array of objects).
 * Relative `include` / `entry` paths resolve against tools/aitest.
 */
export interface SuiteSpec {
  id: string;
  title: string;
  /** Scheduled cadences, or 'script' for suites run by hand (reason says why). */
  cadence: Cadence[] | 'script';
  reason: string;
  unit: string;
  profile: Profile;
  gateways?: 0 | 1 | 2;
  workers?: StackOptions['workers'];
  webApps?: WebApp[];
  keycloak?: boolean;
  nodeEnv?: 'development' | 'production';
  runner: 'vitest' | 'playwright' | 'node';
  include?: string[];
  entry?: string;
  timeoutMinutes: number;
  env?: Record<string, string>;
  stack?: Pick<StackOptions, 'serviceEnv' | 'serviceNodeOptions' | 'extraComposeFiles'>;
  /** Set by discoverSuites: the suite.json file it came from. */
  file?: string;
}

const PROFILES: readonly Profile[] = ['none', 'db', 'core', 'full'];
const RUNNERS = ['vitest', 'playwright', 'node'] as const;

export function validateSuiteSpec(raw: unknown, where: string): SuiteSpec {
  const s = raw as Partial<SuiteSpec>;
  const fail = (msg: string): never => {
    throw new Error(`${where}: ${msg}`);
  };
  if (!s || typeof s !== 'object') fail('suite must be an object');
  if (typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s.id))
    fail('id must be lowercase kebab-case');
  if (typeof s.title !== 'string' || !s.title) fail('title is required');
  if (s.cadence !== 'script') {
    if (!Array.isArray(s.cadence) || s.cadence.length === 0)
      fail("cadence must be ['nightly'|'weekly', ...] or 'script'");
    for (const c of s.cadence as unknown[])
      if (c !== 'nightly' && c !== 'weekly') fail(`unknown cadence ${String(c)}`);
  }
  if (typeof s.reason !== 'string' || !s.reason) fail('reason is required (why this cadence)');
  if (typeof s.unit !== 'string' || !s.unit) fail('unit is required');
  if (!PROFILES.includes(s.profile as Profile))
    fail(`profile must be one of ${PROFILES.join(', ')}`);
  if (!RUNNERS.includes(s.runner as (typeof RUNNERS)[number]))
    fail(`runner must be one of ${RUNNERS.join(', ')}`);
  if (s.runner === 'node' && !s.entry) fail('runner node needs entry');
  if (s.runner !== 'node' && (!Array.isArray(s.include) || s.include.length === 0))
    fail(`runner ${String(s.runner)} needs include`);
  if (typeof s.timeoutMinutes !== 'number' || s.timeoutMinutes <= 0 || s.timeoutMinutes > 300) {
    fail('timeoutMinutes must be 1..300 (scheduled job limit)');
  }
  return s as SuiteSpec;
}
