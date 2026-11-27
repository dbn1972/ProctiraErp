import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { portsFor } from '../ports.js';

import { generateSecrets, renderEnvFile, writeEnvFile } from './secrets.js';
import { serviceEnv, serviceUrl } from './services.js';
import { datastoresFor, gatewayCount, portsUsed, servicesFor, validateOptions } from './stack.js';
import type { StackState } from './types.js';

describe('stack options', () => {
  it('maps profiles to datastores and services', () => {
    expect(datastoresFor({ profile: 'none' })).toEqual([]);
    expect(datastoresFor({ profile: 'db' })).toEqual(['postgres']);
    expect(datastoresFor({ profile: 'core' })).toEqual(['postgres', 'redis']);
    expect(datastoresFor({ profile: 'full', keycloak: true })).toEqual([
      'postgres',
      'redis',
      'kafka',
      'rabbitmq',
      'minio',
      'keycloak',
    ]);
    expect(gatewayCount({ profile: 'db' })).toBe(0);
    expect(gatewayCount({ profile: 'core' })).toBe(1);
    expect(
      servicesFor({
        unit: 'u',
        profile: 'full',
        gateways: 2,
        workers: ['etl-worker'],
        webApps: ['web'],
      }),
    ).toEqual(['gateway', 'gateway2', 'etl-worker', 'web']);
  });

  it('lists every bound port for the free-port check', () => {
    expect(portsUsed({ unit: 'u', profile: 'core' }, 34950)).toEqual([34950, 34951, 34960]);
    expect(
      portsUsed({ unit: 'u', profile: 'full', keycloak: true, webApps: ['admin-console'] }, 34550),
    ).toEqual([34550, 34551, 34552, 34553, 34554, 34555, 34556, 34557, 34560, 34573]);
  });

  it('rejects impossible combinations', () => {
    expect(() => validateOptions({ unit: 'u', profile: 'core', keycloak: true })).toThrow(/full/);
    expect(() => validateOptions({ unit: 'u', profile: 'core', workers: ['etl-worker'] })).toThrow(
      /full/,
    );
    expect(() => validateOptions({ unit: 'u', profile: 'none', gateways: 1 })).toThrow();
    expect(() => validateOptions({ unit: 'u', profile: 'db', webApps: ['web'] })).toThrow(
      /gateway/,
    );
  });
});

describe('service environment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aitest-svc-'));
  const envFile = join(dir, 'aitest.env');
  const secrets = generateSecrets();
  writeEnvFile(envFile, renderEnvFile(secrets, portsFor(34250), { unit: 't06-compressed-year' }));
  const s = {
    unit: 't06-compressed-year',
    project: 'proctira-aitest-t06-compressed-year',
    portBase: 34250,
    profile: 'core',
    repoRoot: '/repo',
    gitSha: 'abc',
    createdAt: '',
    ports: portsFor(34250),
    urls: { gateways: ['http://127.0.0.1:34260'], web: {} },
    envFile,
    services: {},
    fixturesFile: '',
    stateFile: '',
    projectDir: dir,
    seeded: true,
    options: {
      unit: 't06-compressed-year',
      profile: 'core',
      serviceEnv: { gateway: { AITEST_CLOCK_FILE: '${AITEST_PROJECT_DIR}/clock.json' } },
    },
  } as StackState;

  it('gives the gateway the e2e harness environment plus overrides', () => {
    const env = serviceEnv(s, 'gateway');
    expect(env).toMatchObject({
      PORT: '34260',
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      SEED_DEMO_DATA: '1',
      JWT_SECRET: secrets.jwtSecret,
      RATE_LIMIT_MAX_REQUESTS: '10000',
      FEES_STAFF_SANDBOX_PAYMENTS: 'true',
      AITEST_CLOCK_FILE: `${dir}/clock.json`,
    });
    expect(env['DATABASE_URL']).toBe(
      `postgresql://proctira_app:${secrets.appRolePassword}@127.0.0.1:34250/proctira`,
    );
    expect(env['REDIS_URL']).toContain('@127.0.0.1:34251');
    expect(env['KEYCLOAK_ISSUER']).toBeUndefined();
    expect(env['CORS_ORIGINS']).toContain('http://localhost:34270');
    expect(serviceEnv(s, 'gateway2')['PORT']).toBe('34261');
  });

  it('adds the production-only secrets when nodeEnv is production', () => {
    const prod = serviceEnv({ ...s, options: { ...s.options, nodeEnv: 'production' } }, 'gateway');
    expect(prod).toMatchObject({
      NODE_ENV: 'production',
      AUDIT_CHAIN_HMAC_KEY: secrets.auditChainKey,
      ALLOW_LOCAL_HS_AUTH: '1',
    });
    expect(prod['SEED_DEMO_DATA']).toBeUndefined();
    expect(serviceEnv({ ...s, seeded: false }, 'gateway')['SEED_DEMO_DATA']).toBeUndefined();
  });

  it('points Next apps at gateway #1 on a localhost URL', () => {
    expect(serviceUrl(s, 'web')).toBe('http://localhost:34270');
    expect(serviceEnv(s, 'admin-console')).toMatchObject({
      PORT: '34273',
      GATEWAY_URL: 'http://127.0.0.1:34260',
      TENANT_FALLBACK_SLUG: 'sunrise-public-school',
    });
  });
});
