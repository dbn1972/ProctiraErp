import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { portsFor } from '../ports.js';

import {
  generateSecrets,
  pgEnv,
  pgUrl,
  readEnvFile,
  renderEnvFile,
  secretsFromEnv,
  writeEnvFile,
} from './secrets.js';

describe('stack secrets', () => {
  it('generates distinct URL-safe secrets per stack', () => {
    const a = generateSecrets();
    const b = generateSecrets();
    expect(a.jwtSecret).not.toBe(b.jwtSecret);
    for (const v of Object.values(a)) expect(v).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(a.jwtSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('writes a mode-600 env file that round-trips', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aitest-env-'));
    const file = join(dir, 'p', 'aitest.env');
    const secrets = generateSecrets();
    writeEnvFile(file, renderEnvFile(secrets, portsFor(34950), { unit: 'foundation' }));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const vars = readEnvFile(file);
    expect(secretsFromEnv(vars)).toEqual(secrets);
    expect(vars['POSTGRES_PORT']).toBe('34950');
    expect(vars['BIND_ADDRESS']).toBe('127.0.0.1');
    expect(vars['AITEST_UNIT']).toBe('foundation');
    expect(vars['KAFKA_PORT']).toBe('34952');
  });

  it('keeps passwords out of PG argv-style values', () => {
    expect(pgUrl('proctira', 'p@ss/w', 34950)).toBe(
      'postgresql://proctira:p%40ss%2Fw@127.0.0.1:34950/proctira',
    );
    expect(pgEnv('proctira', 'pw', 34950)).toEqual({
      PGHOST: '127.0.0.1',
      PGPORT: '34950',
      PGUSER: 'proctira',
      PGPASSWORD: 'pw',
      PGDATABASE: 'proctira',
    });
  });
});
