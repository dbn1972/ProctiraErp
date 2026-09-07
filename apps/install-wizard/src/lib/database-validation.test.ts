import { describe, expect, it } from 'vitest';

import { validateDatabaseConfig } from './database-validation';

const valid = {
  provider: 'postgresql',
  host: 'localhost',
  port: 5432,
  database: 'appdb',
  username: 'postgres',
  password: 'secret',
  poolSize: 10,
};

describe('validateDatabaseConfig', () => {
  it('accepts a well-formed payload', () => {
    expect(validateDatabaseConfig(valid)).toBeNull();
  });

  it('rejects missing host / credentials', () => {
    expect(validateDatabaseConfig({ ...valid, host: '' })?.host).toMatch(/required/i);
    expect(validateDatabaseConfig({ ...valid, username: '' })?.username).toMatch(/required/i);
    expect(validateDatabaseConfig({ ...valid, password: '' })?.password).toMatch(/required/i);
  });

  it('rejects invalid port and pool size', () => {
    expect(validateDatabaseConfig({ ...valid, port: 0 })?.port).toMatch(/1 and 65535/i);
    expect(validateDatabaseConfig({ ...valid, poolSize: 101 })?.poolSize).toMatch(/1 and 100/i);
  });

  it('rejects unknown providers and bad database names', () => {
    expect(validateDatabaseConfig({ ...valid, provider: 'sqlite' })?.provider).toMatch(
      /postgresql or mysql/i,
    );
    expect(validateDatabaseConfig({ ...valid, database: 'bad name!' })?.database).toMatch(
      /alphanumeric/i,
    );
  });
});
