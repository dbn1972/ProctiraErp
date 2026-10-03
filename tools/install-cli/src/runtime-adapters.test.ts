/**
 * PRC-H102: real install-cli adapters — persisted bootstrap state, script-driven
 * migrations (fail closed), protocol-level connectivity probes, IdP discovery and the
 * install-time admin decision.
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { Installer } from './installer';
import {
  countRequiredSqlMigrations,
  createNetworkConnectivityTester,
  FileBootstrapStore,
  IdpDelegatedAdminCreator,
  migratorUrlFrom,
  probeIdentityProvider,
  resolveInstallAdminMode,
  ScriptMigrationRunner,
} from './runtime-adapters';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const servers: Server[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakeServer(reply: (data: Buffer) => Buffer | string): Promise<number> {
  return new Promise((done) => {
    const server = createServer((socket) => {
      socket.once('data', (data) => socket.end(reply(data)));
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => done((server.address() as { port: number }).port));
  });
}

async function closedPort(): Promise<number> {
  const port = await fakeServer(() => '');
  servers.pop()!.close();
  return port;
}

describe('FileBootstrapStore', () => {
  it('persists runs across instances with 0600 permissions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pcb1-install-'));
    dirs.push(dir);
    const path = join(dir, 'nested', 'state.json');
    const a = new FileBootstrapStore(path);
    await a.createRun({
      id: 'run-1',
      status: 'in_progress',
      completedSteps: [],
      adapterConfigs: {} as never,
      startedAt: new Date().toISOString(),
    });
    await a.updateRun('run-1', { status: 'completed', completedSteps: ['cdn'] as never });
    const b = new FileBootstrapStore(path);
    expect((await b.getLatestRun())?.status).toBe('completed');
    expect((await b.getRun('run-1'))?.completedSteps).toEqual(['cdn']);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('ScriptMigrationRunner', () => {
  function fakeSpawn(code: number, stderr = '') {
    const calls: Array<{ args: string[]; env: Record<string, string | undefined> }> = [];
    const impl = ((_cmd: string, args: string[], opts: { env: Record<string, string> }) => {
      calls.push({ args, env: opts.env });
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => {
        if (stderr) child.stderr.emit('data', Buffer.from(stderr));
        child.emit('close', code);
      });
      return child;
    }) as never;
    return { impl, calls };
  }

  it('runs run-target-database-migrations.sh with the migrator URL only in env', async () => {
    const { impl, calls } = fakeSpawn(0);
    const runner = new ScriptMigrationRunner({
      migratorUrl: 'postgresql://proctira:s3cret@db:5432/proctira',
      logger: silentLogger,
      spawnImpl: impl,
    });
    const result = await runner.runMigrations();
    expect(result.success).toBe(true);
    expect(result.migrationsApplied).toBe(countRequiredSqlMigrations());
    expect(result.migrationsApplied).toBeGreaterThan(100);
    expect(calls[0]!.args[0]).toMatch(/run-target-database-migrations\.sh$/);
    expect(calls[0]!.args.join(' ')).not.toContain('s3cret');
    expect(calls[0]!.env['MIGRATOR_DATABASE_URL']).toContain('s3cret');
  });

  it('fails closed with the script error on non-zero exit', async () => {
    const { impl } = fakeSpawn(
      1,
      'run-target-database-migrations: migrator role must be NOSUPERUSER',
    );
    const result = await new ScriptMigrationRunner({
      migratorUrl: 'postgresql://x:y@db/z',
      logger: silentLogger,
      spawnImpl: impl,
    }).runMigrations();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/NOSUPERUSER/);
  });

  it('builds the migrator URL from MIGRATOR_DATABASE_URL first, else the db config', () => {
    const db = {
      provider: 'postgresql' as const,
      host: 'h',
      port: 5432,
      database: 'd',
      username: 'u@x',
      password: 'p/w',
    };
    expect(migratorUrlFrom(db, { MIGRATOR_DATABASE_URL: 'postgresql://m' })).toBe('postgresql://m');
    expect(migratorUrlFrom(db, {})).toBe('postgresql://u%40x:p%2Fw@h:5432/d');
  });
});

describe('createNetworkConnectivityTester', () => {
  const tester = createNetworkConnectivityTester({ timeoutMs: 1000 });

  it('accepts a PostgreSQL SSLRequest answer and rejects a closed port', async () => {
    const port = await fakeServer(() => 'N');
    const ok = await tester.testDatabase!({
      provider: 'postgresql',
      host: '127.0.0.1',
      port,
      database: 'd',
      username: 'u',
      password: 'p',
    });
    expect(ok.healthy).toBe(true);
    const down = await tester.testDatabase!({
      provider: 'postgresql',
      host: '127.0.0.1',
      port: await closedPort(),
      database: 'd',
      username: 'u',
      password: 'p',
    });
    expect(down.healthy).toBe(false);
  });

  it('rejects a non-Postgres endpoint on the database port', async () => {
    const port = await fakeServer(() => 'HTTP/1.1 400 Bad Request\r\n\r\n');
    const res = await tester.testDatabase!({
      provider: 'postgresql',
      host: '127.0.0.1',
      port,
      database: 'd',
      username: 'u',
      password: 'p',
    });
    expect(res.healthy).toBe(false);
  });

  it('probes Redis with PING (and AUTH when a password is set)', async () => {
    let seen = '';
    const port = await fakeServer((data) => {
      seen = data.toString();
      return seen.includes('AUTH') ? '+OK\r\n+PONG\r\n' : '-NOAUTH Authentication required.\r\n';
    });
    expect((await tester.testCache!({ adapter: 'redis', host: '127.0.0.1', port })).healthy).toBe(
      false,
    );
    const ok = await tester.testCache!({
      adapter: 'redis',
      host: '127.0.0.1',
      port,
      password: 'pw',
    });
    expect(ok.healthy).toBe(true);
    expect(seen).toContain('AUTH');
  });

  it('requires an AMQP Connection.Start frame from RabbitMQ', async () => {
    const amqp = await fakeServer(() => Buffer.from([1, 0, 0, 0, 0, 0, 4]));
    const ok = await tester.testQueue!({
      backend: 'rabbitmq',
      rabbitmq: { url: `amqp://guest:guest@127.0.0.1:${amqp}`, exchange: 'x' },
    });
    expect(ok.healthy).toBe(true);
    const notAmqp = await fakeServer(() => 'hello');
    const bad = await tester.testQueue!({
      backend: 'rabbitmq',
      rabbitmq: { url: `amqp://127.0.0.1:${notAmqp}`, exchange: 'x' },
    });
    expect(bad.healthy).toBe(false);
  });
});

describe('IdP probe and admin decision', () => {
  const fetchOk = (async () =>
    new Response(JSON.stringify({ issuer: 'https://idp.example/realms/proctira' }), {
      status: 200,
    })) as unknown as typeof fetch;

  it('checks the OIDC discovery issuer', async () => {
    expect(
      (await probeIdentityProvider('https://idp.example/realms/proctira', fetchOk)).healthy,
    ).toBe(true);
    expect((await probeIdentityProvider('https://evil.example/realms/x', fetchOk)).healthy).toBe(
      false,
    );
  });

  it('defaults to refusing admin creation; idp-delegated never creates an account', async () => {
    expect(resolveInstallAdminMode({})).toBe('refuse');
    expect(resolveInstallAdminMode({ INSTALL_ADMIN_MODE: 'idp-delegated' })).toBe('idp-delegated');
    const creator = new IdpDelegatedAdminCreator({
      issuer: 'https://idp.example/realms/proctira',
      logger: silentLogger,
      fetchImpl: fetchOk,
    });
    const result = await creator.createAdmin({
      username: 'admin@example.test',
      password: 'x',
      firstName: 'A',
      lastName: 'B',
    } as never);
    expect(result).toEqual({ success: true, delegated: true });
  });

  it('a failing post-install probe fails the install', async () => {
    const installer = new Installer({
      logger: silentLogger,
      migrationRunner: { runMigrations: async () => ({ success: true, migrationsApplied: 1 }) },
      adminCreator: { createAdmin: async () => ({ success: true, delegated: true }) },
      extraHealthChecks: [
        { name: 'identity_provider', check: async () => ({ healthy: false, error: 'down' }) },
      ],
    });
    const result = await installer.install({
      cdn: { adapter: 'nginx', baseUrl: 'http://localhost:8080', tenantAware: true },
      database: {
        provider: 'postgresql',
        host: 'localhost',
        port: 5432,
        database: 'p',
        username: 'u',
        password: 'p',
      },
      storage: {
        adapter: 'minio',
        bucket: 'b',
        endpoint: 'http://localhost:9000',
        accessKeyId: 'k',
        secretAccessKey: 's',
      },
      cache: { adapter: 'memory' },
      queue: { backend: 'rabbitmq', rabbitmq: { url: 'amqp://localhost', exchange: 'x' } },
      admin: { username: 'a', password: 'b', firstName: 'c', lastName: 'd' },
    } as never);
    expect(result.success).toBe(false);
    expect(result.adminCreated).toBe(false);
    expect(result.error).toMatch(/identity_provider/);
  });
});
