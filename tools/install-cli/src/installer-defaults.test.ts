/**
 * PRC-H102: without real dependencies the installer must fail loudly instead of
 * reporting applied migrations or a fabricated admin user.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, it, expect, vi, afterEach } from 'vitest';

import { run } from './cli';
import { Installer, NOT_IMPLEMENTED_ADMIN, NOT_IMPLEMENTED_MIGRATIONS } from './installer';
import type { InstallConfig } from './types';

const config: InstallConfig = {
  cdn: { adapter: 'nginx', baseUrl: 'http://localhost:8080', tenantAware: true },
  database: {
    provider: 'postgresql',
    host: 'localhost',
    port: 5432,
    database: 'proctira',
    username: 'admin',
    password: 'secret123',
  },
  storage: {
    adapter: 'minio',
    bucket: 'proctira',
    endpoint: 'http://localhost:9000',
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
  },
  cache: { adapter: 'redis', host: 'localhost', port: 6379 },
  queue: { backend: 'rabbitmq', rabbitmq: { url: 'amqp://localhost:5672', exchange: 'proctira' } },
  admin: {
    username: 'admin@proctira.org',
    password: 'Str0ng!Passw0rd',
    firstName: 'Platform',
    lastName: 'Admin',
  },
};

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe('Installer default dependencies (PRC-H102)', () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('fails with a not-implemented migration error when no runner is injected', async () => {
    const result = await new Installer({ logger: silentLogger }).install(config);
    expect(result.success).toBe(false);
    expect(result.migrationsRun).toBe(false);
    expect(result.error).toContain(NOT_IMPLEMENTED_MIGRATIONS);
  });

  it('fails with a not-implemented admin error when no admin creator is injected', async () => {
    const result = await new Installer({ logger: silentLogger }).install(config, {
      skipMigrations: true,
    });
    expect(result.success).toBe(false);
    expect(result.adminCreated).toBe(false);
    expect(result.error).toContain(NOT_IMPLEMENTED_ADMIN);
  });

  it('run() without deps exits non-zero with a clear not-implemented error', async () => {
    const tmpFile = path.join(__dirname, '__test_defaults.json');
    fs.writeFileSync(tmpFile, JSON.stringify(config));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await run(['node', 'script', '--config', tmpFile, '--output', 'json']);
      expect(result?.success).toBe(false);
      expect(result?.error).toMatch(/not implemented/);
      expect(process.exitCode).toBe(1);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
