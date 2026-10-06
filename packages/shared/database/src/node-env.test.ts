/**
 * PRC-L579: database fail-closed guards normalise NODE_ENV case/whitespace.
 */
import { describe, expect, it } from 'vitest';

import { isProductionNodeEnv } from './node-env.js';
import { resolvePersistenceMode } from './persistence-policy.js';
import { runReadinessProbe } from './readiness-probe.js';

describe('isProductionNodeEnv (PRC-L579)', () => {
  it.each(['production', 'Production', ' PRODUCTION '])('%j is production', (v) => {
    expect(isProductionNodeEnv(v)).toBe(true);
  });
  it.each([undefined, '', 'development', 'test'])('%j is not production', (v) => {
    expect(isProductionNodeEnv(v)).toBe(false);
  });
});

describe('persistence/readiness guards with mixed-case NODE_ENV (PRC-L579)', () => {
  it('refuses the in-memory fallback for NODE_ENV=Production', () => {
    expect(() => resolvePersistenceMode('demo', undefined, { NODE_ENV: 'Production' })).toThrow(
      /not allowed when NODE_ENV=production/,
    );
  });

  it('reports database required-missing for NODE_ENV=" Production "', async () => {
    const result = await runReadinessProbe({ env: { NODE_ENV: ' Production ' } });
    expect(result.ready).toBe(false);
    expect(result.dependencies.database).toBe('required-missing');
  });
});
