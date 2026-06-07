/**
 * Tests for the Install CLI tool.
 *
 * Tests configuration loading from file, environment variables,
 * argument parsing, and the full installation flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs, formatResultText, createConsoleLogger, run } from './cli';
import { loadConfigFromFile, loadConfigFromEnv, validateConfigStructure } from './config-loader';
import { Installer } from './installer';
import type { InstallConfig, InstallResult } from './types';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

const validConfig: InstallConfig = {
  cdn: {
    adapter: 'nginx',
    baseUrl: 'http://localhost:8080',
    tenantAware: true,
  },
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
  cache: {
    adapter: 'redis',
    host: 'localhost',
    port: 6379,
  },
  queue: {
    backend: 'rabbitmq',
    rabbitmq: {
      url: 'amqp://localhost:5672',
      exchange: 'proctira',
    },
  },
  admin: {
    username: 'admin@proctira.org',
    password: 'Admin123!',
    firstName: 'System',
    lastName: 'Administrator',
  },
};

// ─── parseArgs Tests ─────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses --config flag', () => {
    const opts = parseArgs(['node', 'script', '--config', './install.json']);
    expect(opts.configFile).toBe('./install.json');
  });

  it('parses -c shorthand', () => {
    const opts = parseArgs(['node', 'script', '-c', './install.json']);
    expect(opts.configFile).toBe('./install.json');
  });

  it('parses --env flag', () => {
    const opts = parseArgs(['node', 'script', '--env']);
    expect(opts.useEnv).toBe(true);
  });

  it('parses --interactive flag', () => {
    const opts = parseArgs(['node', 'script', '--interactive']);
    expect(opts.interactive).toBe(true);
  });

  it('parses --skip-migrations flag', () => {
    const opts = parseArgs(['node', 'script', '--skip-migrations']);
    expect(opts.skipMigrations).toBe(true);
  });

  it('parses --skip-admin flag', () => {
    const opts = parseArgs(['node', 'script', '--skip-admin']);
    expect(opts.skipAdmin).toBe(true);
  });

  it('parses --output json', () => {
    const opts = parseArgs(['node', 'script', '--output', 'json']);
    expect(opts.outputFormat).toBe('json');
  });

  it('parses --verbose flag', () => {
    const opts = parseArgs(['node', 'script', '--verbose']);
    expect(opts.verbose).toBe(true);
  });

  it('parses --help flag', () => {
    const opts = parseArgs(['node', 'script', '--help']);
    expect(opts.help).toBe(true);
  });

  it('parses --version flag', () => {
    const opts = parseArgs(['node', 'script', '--version']);
    expect(opts.version).toBe(true);
  });

  it('parses multiple flags together', () => {
    const opts = parseArgs(['node', 'script', '--config', 'f.json', '--skip-migrations', '--verbose', '--output', 'json']);
    expect(opts.configFile).toBe('f.json');
    expect(opts.skipMigrations).toBe(true);
    expect(opts.verbose).toBe(true);
    expect(opts.outputFormat).toBe('json');
  });
});

// ─── loadConfigFromEnv Tests ─────────────────────────────────────────────────

describe('loadConfigFromEnv', () => {
  it('loads database config from environment variables', () => {
    const env = {
      OPENEMIS_DB_PROVIDER: 'postgresql',
      OPENEMIS_DB_HOST: 'db.example.com',
      OPENEMIS_DB_PORT: '5433',
      OPENEMIS_DB_NAME: 'mydb',
      OPENEMIS_DB_USERNAME: 'user',
      OPENEMIS_DB_PASSWORD: 'pass',
      OPENEMIS_DB_SSL: 'true',
      OPENEMIS_ADMIN_USERNAME: 'admin@test.org',
      OPENEMIS_ADMIN_PASSWORD: 'password123',
      OPENEMIS_ADMIN_FIRST_NAME: 'Test',
      OPENEMIS_ADMIN_LAST_NAME: 'Admin',
    };

    const config = loadConfigFromEnv(env);
    expect(config.database.provider).toBe('postgresql');
    expect(config.database.host).toBe('db.example.com');
    expect(config.database.port).toBe(5433);
    expect(config.database.database).toBe('mydb');
    expect(config.database.username).toBe('user');
    expect(config.database.password).toBe('pass');
    expect(config.database.ssl).toBe(true);
  });

  it('loads queue config for kafka from environment', () => {
    const env = {
      OPENEMIS_QUEUE_BACKEND: 'kafka',
      OPENEMIS_QUEUE_KAFKA_BROKERS: 'broker1:9092,broker2:9092',
      OPENEMIS_QUEUE_KAFKA_CLIENT_ID: 'my-client',
      OPENEMIS_ADMIN_USERNAME: 'admin@test.org',
      OPENEMIS_ADMIN_PASSWORD: 'password123',
      OPENEMIS_ADMIN_FIRST_NAME: 'Test',
      OPENEMIS_ADMIN_LAST_NAME: 'Admin',
    };

    const config = loadConfigFromEnv(env);
    expect(config.queue.backend).toBe('kafka');
    expect(config.queue.kafka?.brokers).toEqual(['broker1:9092', 'broker2:9092']);
    expect(config.queue.kafka?.clientId).toBe('my-client');
  });

  it('uses defaults when env vars are not set', () => {
    const config = loadConfigFromEnv({});
    expect(config.cdn.adapter).toBe('nginx');
    expect(config.database.provider).toBe('postgresql');
    expect(config.database.host).toBe('localhost');
    expect(config.database.port).toBe(5432);
    expect(config.cache.adapter).toBe('redis');
    expect(config.queue.backend).toBe('rabbitmq');
  });

  it('loads storage config for minio', () => {
    const env = {
      OPENEMIS_STORAGE_ADAPTER: 'minio',
      OPENEMIS_STORAGE_BUCKET: 'my-bucket',
      OPENEMIS_STORAGE_ENDPOINT: 'http://minio:9000',
      OPENEMIS_STORAGE_ACCESS_KEY: 'key123',
      OPENEMIS_STORAGE_SECRET_KEY: 'secret456',
      OPENEMIS_STORAGE_FORCE_PATH_STYLE: 'true',
      OPENEMIS_ADMIN_USERNAME: 'admin@test.org',
      OPENEMIS_ADMIN_PASSWORD: 'password123',
      OPENEMIS_ADMIN_FIRST_NAME: 'Test',
      OPENEMIS_ADMIN_LAST_NAME: 'Admin',
    };

    const config = loadConfigFromEnv(env);
    expect(config.storage.adapter).toBe('minio');
    expect(config.storage.bucket).toBe('my-bucket');
    expect(config.storage.endpoint).toBe('http://minio:9000');
    expect(config.storage.accessKeyId).toBe('key123');
    expect(config.storage.secretAccessKey).toBe('secret456');
    expect(config.storage.forcePathStyle).toBe(true);
  });
});

// ─── validateConfigStructure Tests ───────────────────────────────────────────

describe('validateConfigStructure', () => {
  it('accepts a valid configuration', () => {
    expect(() => validateConfigStructure(validConfig)).not.toThrow();
  });

  it('rejects null config', () => {
    expect(() => validateConfigStructure(null)).toThrow('must be a non-null object');
  });

  it('rejects config missing sections', () => {
    const partial = { cdn: {}, database: {} };
    expect(() => validateConfigStructure(partial)).toThrow('missing required sections');
  });

  it('rejects config with missing admin username', () => {
    const config = { ...validConfig, admin: { ...validConfig.admin, username: '' } };
    expect(() => validateConfigStructure(config)).toThrow('admin.username');
  });

  it('rejects config with short admin password', () => {
    const config = { ...validConfig, admin: { ...validConfig.admin, password: 'short' } };
    expect(() => validateConfigStructure(config)).toThrow('at least 8 characters');
  });

  it('rejects config with missing admin firstName', () => {
    const config = { ...validConfig, admin: { ...validConfig.admin, firstName: '' } };
    expect(() => validateConfigStructure(config)).toThrow('admin.firstName');
  });
});

// ─── loadConfigFromFile Tests ────────────────────────────────────────────────

describe('loadConfigFromFile', () => {
  it('throws when file does not exist', () => {
    expect(() => loadConfigFromFile('/nonexistent/path.json')).toThrow('not found');
  });

  it('throws on invalid JSON', () => {
    const tmpFile = path.join(__dirname, '__test_invalid.json');
    fs.writeFileSync(tmpFile, 'not valid json {{{');
    try {
      expect(() => loadConfigFromFile(tmpFile)).toThrow('Invalid JSON');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('loads and validates a valid config file', () => {
    const tmpFile = path.join(__dirname, '__test_valid.json');
    fs.writeFileSync(tmpFile, JSON.stringify(validConfig));
    try {
      const config = loadConfigFromFile(tmpFile);
      expect(config.database.host).toBe('localhost');
      expect(config.admin.username).toBe('admin@proctira.org');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

// ─── Installer Tests ─────────────────────────────────────────────────────────

describe('Installer', () => {
  const silentLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  it('runs full installation with valid config', async () => {
    const installer = new Installer({
      logger: silentLogger,
      migrationRunner: {
        runMigrations: async () => ({ success: true, migrationsApplied: 3 }),
      },
      adminCreator: {
        createAdmin: async () => ({ success: true, userId: 'user-1' }),
      },
    });

    const result = await installer.install(validConfig);
    expect(result.success).toBe(true);
    expect(result.migrationsRun).toBe(true);
    expect(result.adminCreated).toBe(true);
    expect(result.health.status).toBe('healthy');
    expect(result.adapterResults['cdn']?.success).toBe(true);
    expect(result.adapterResults['database']?.success).toBe(true);
    expect(result.adapterResults['storage']?.success).toBe(true);
    expect(result.adapterResults['cache']?.success).toBe(true);
    expect(result.adapterResults['queue']?.success).toBe(true);
  });

  it('skips migrations when option is set', async () => {
    const installer = new Installer({
      logger: silentLogger,
      migrationRunner: {
        runMigrations: async () => ({ success: true, migrationsApplied: 0 }),
      },
      adminCreator: {
        createAdmin: async () => ({ success: true, userId: 'user-1' }),
      },
    });

    const result = await installer.install(validConfig, { skipMigrations: true });
    expect(result.success).toBe(true);
    expect(result.migrationsRun).toBe(false);
  });

  it('skips admin creation when option is set', async () => {
    const installer = new Installer({
      logger: silentLogger,
      migrationRunner: {
        runMigrations: async () => ({ success: true, migrationsApplied: 0 }),
      },
      adminCreator: {
        createAdmin: async () => ({ success: true, userId: 'user-1' }),
      },
    });

    const result = await installer.install(validConfig, { skipAdmin: true });
    expect(result.success).toBe(true);
    expect(result.adminCreated).toBe(false);
  });

  it('fails when CDN config is invalid', async () => {
    const installer = new Installer({ logger: silentLogger });
    const badConfig = {
      ...validConfig,
      cdn: { ...validConfig.cdn, baseUrl: '' },
    };

    const result = await installer.install(badConfig);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('fails when database config is invalid', async () => {
    const installer = new Installer({ logger: silentLogger });
    const badConfig = {
      ...validConfig,
      database: { ...validConfig.database, host: '', username: '' },
    };

    const result = await installer.install(badConfig);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('fails when migration runner fails', async () => {
    const installer = new Installer({
      logger: silentLogger,
      migrationRunner: {
        runMigrations: async () => ({ success: false, migrationsApplied: 0, error: 'Connection refused' }),
      },
    });

    const result = await installer.install(validConfig);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection refused');
  });

  it('fails when admin creator fails', async () => {
    const installer = new Installer({
      logger: silentLogger,
      migrationRunner: {
        runMigrations: async () => ({ success: true, migrationsApplied: 1 }),
      },
      adminCreator: {
        createAdmin: async () => ({ success: false, error: 'Duplicate email' }),
      },
    });

    const result = await installer.install(validConfig);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Duplicate email');
  });
});

// ─── formatResultText Tests ──────────────────────────────────────────────────

describe('formatResultText', () => {
  it('formats a successful result', () => {
    const result: InstallResult = {
      success: true,
      completedAt: '2024-01-01T00:00:00.000Z',
      adapterResults: {
        cdn: { success: true, message: 'CDN configured', latencyMs: 5 },
        database: { success: true, message: 'Database configured', latencyMs: 12 },
      },
      migrationsRun: true,
      adminCreated: true,
      health: {
        status: 'healthy',
        adapters: {
          cdn: { healthy: true, message: 'CDN is reachable' },
          database: { healthy: true, message: 'Database is connected' },
        },
      },
    };

    const output = formatResultText(result);
    expect(output).toContain('SUCCESS');
    expect(output).toContain('✓ cdn');
    expect(output).toContain('✓ database');
    expect(output).toContain('Migrations: ✓ Applied');
    expect(output).toContain('Admin Account: ✓ Created');
    expect(output).toContain('HEALTHY');
  });

  it('formats a failed result', () => {
    const result: InstallResult = {
      success: false,
      completedAt: '2024-01-01T00:00:00.000Z',
      adapterResults: {
        cdn: { success: false, message: 'CDN base URL is required' },
      },
      migrationsRun: false,
      adminCreated: false,
      health: { status: 'unhealthy', adapters: {} },
      error: 'CDN configuration failed',
    };

    const output = formatResultText(result);
    expect(output).toContain('FAILED');
    expect(output).toContain('✗ cdn');
    expect(output).toContain('CDN configuration failed');
  });
});

// ─── run() Integration Tests ─────────────────────────────────────────────────

describe('run', () => {
  it('shows help when --help is passed', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await run(['node', 'script', '--help']);
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('ProctiraERP Unified Platform');
    consoleSpy.mockRestore();
  });

  it('shows version when --version is passed', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await run(['node', 'script', '--version']);
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('0.1.0');
    consoleSpy.mockRestore();
  });

  it('runs installation from config file', async () => {
    const tmpFile = path.join(__dirname, '__test_run.json');
    fs.writeFileSync(tmpFile, JSON.stringify(validConfig));

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await run(
        ['node', 'script', '--config', tmpFile, '--output', 'json'],
        {
          migrationRunner: {
            runMigrations: async () => ({ success: true, migrationsApplied: 1 }),
          },
          adminCreator: {
            createAdmin: async () => ({ success: true, userId: 'u-1' }),
          },
        },
      );
      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
    } finally {
      fs.unlinkSync(tmpFile);
      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('fails gracefully when config file not found', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await run(['node', 'script', '--config', '/nonexistent.json']);
    expect(result).toBeNull();

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
