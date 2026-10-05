import { describe, expect, it } from 'vitest';
import { isProductionLike, isProductionNodeEnv, normalizeNodeEnv } from './node-env.js';

describe('node-env helpers (PRC-L579)', () => {
  it('normalises case and whitespace', () => {
    expect(normalizeNodeEnv('  Production ')).toBe('production');
    expect(normalizeNodeEnv(undefined)).toBe('');
  });

  it.each(['production', 'Production', ' PRODUCTION ', 'prod', 'PROD'])(
    'isProductionNodeEnv(%j) is true',
    (v) => {
      expect(isProductionNodeEnv(v)).toBe(true);
    },
  );

  it.each([undefined, '', 'development', 'test', 'staging'])(
    'isProductionNodeEnv(%j) is false',
    (v) => {
      expect(isProductionNodeEnv(v)).toBe(false);
    },
  );

  it.each([undefined, '', 'staging', 'Production', 'qa', 'prod'])(
    'isProductionLike(%j) fails closed (true)',
    (v) => {
      expect(isProductionLike(v)).toBe(true);
    },
  );

  it.each(['development', 'test', ' Test ', 'DEVELOPMENT'])(
    'isProductionLike(%j) is false',
    (v) => {
      expect(isProductionLike(v)).toBe(false);
    },
  );
});
