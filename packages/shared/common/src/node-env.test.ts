import { describe, expect, it } from 'vitest';
import {
  isDeployedEnvironment,
  isProductionLike,
  isProductionNodeEnv,
  normalizeNodeEnv,
} from './node-env.js';

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

describe('isDeployedEnvironment (PRC-L566)', () => {
  it.each([
    ['production', { APP_ENV: 'staging' }, true],
    ['development', { APP_ENV: 'staging' }, true],
    ['test', {}, false],
    [undefined, {}, true],
    ['staging', {}, true],
    ['development', {}, false],
    ['development', { DEPLOY_ENV: 'Prod' }, true],
    ['test', { APP_ENV: 'qa' }, false],
  ] as const)('NODE_ENV=%j env=%j -> %j', (nodeEnv, env, expected) => {
    expect(isDeployedEnvironment(nodeEnv, env)).toBe(expected);
  });
});
