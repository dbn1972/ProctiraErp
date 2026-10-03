/**
 * PRC-H102: real install-time adapters for the headless installer.
 *
 * - ScriptMigrationRunner: runs tools/scripts/run-target-database-migrations.sh (the same
 *   fail-closed migrator stage deploy.yml uses). The migrator credential travels only in the
 *   child environment (MIGRATOR_DATABASE_URL), never on argv or in logs.
 * - FileBootstrapStore: persists bootstrap runs to a 0600 JSON file (atomic rename), so a
 *   re-run sees the previous completed/failed run.
 * - NetworkConnectivityTester: real protocol probes — Postgres SSLRequest, Redis PING, AMQP
 *   protocol header, TCP for Kafka, HTTP(S) for CDN / storage / SQS.
 * - probeIdentityProvider: OIDC discovery document fetch for the IdP issuer.
 * - Install-time admin creation (decision): the CLI never creates platform admins. Defaulted:
 *   refuse (install fails until the admin step is skipped or delegated); owner may change via
 *   INSTALL_ADMIN_MODE=idp-delegated (admin is provisioned in the IdP; step reported as
 *   delegated, adminCreated=false).
 */
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { connect, type Socket } from 'node:net';
import { dirname, join, resolve } from 'node:path';

import type { BootstrapStore, ConnectivityTester } from '@proctira/backend-install';

import type { AdminAccountCreator, InstallerLogger, MigrationRunner } from './installer';
import type { AdminAccountConfig, InstallConfig } from './types';

type BootstrapRunRecord = Parameters<BootstrapStore['createRun']>[0];
type ProbeResult = { healthy: boolean; latencyMs: number; error?: string };

/** Repository root (tools/install-cli/src → repo). */
export function repoRoot(): string {
  return resolve(__dirname, '..', '..', '..');
}

export function countRequiredSqlMigrations(root = repoRoot()): number {
  const dir = join(root, 'db', 'sql');
  if (!existsSync(dir)) return 0;
  return readdirSync(dir)
    .filter((n) => /^[0-9].*\.sql$/.test(n))
    .filter((n) => !/^[0-9]+b_.*_seed\.sql$/.test(n)).length;
}

export function migratorUrlFrom(
  config: InstallConfig['database'],
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env['MIGRATOR_DATABASE_URL']?.trim();
  if (explicit) return explicit;
  const user = encodeURIComponent(config.username);
  const pass = encodeURIComponent(config.password);
  const ssl = config.ssl ? '?sslmode=require' : '';
  return `postgresql://${user}:${pass}@${config.host}:${config.port}/${config.database}${ssl}`;
}

export class ScriptMigrationRunner implements MigrationRunner {
  constructor(
    private readonly options: {
      migratorUrl: string;
      logger: InstallerLogger;
      root?: string;
      spawnImpl?: typeof spawn;
    },
  ) {}

  runMigrations(): Promise<{ success: boolean; migrationsApplied: number; error?: string }> {
    const root = this.options.root ?? repoRoot();
    const script = join(root, 'tools', 'scripts', 'run-target-database-migrations.sh');
    if (!existsSync(script)) {
      return Promise.resolve({
        success: false,
        migrationsApplied: 0,
        error: `migration script not found: ${script}`,
      });
    }
    const spawnImpl = this.options.spawnImpl ?? spawn;
    return new Promise((done) => {
      const child = spawnImpl('bash', [script], {
        cwd: root,
        env: { ...process.env, MIGRATOR_DATABASE_URL: this.options.migratorUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderrTail = '';
      child.stdout?.on('data', (chunk: Buffer) => this.options.logger.debug(chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-2000);
      });
      child.on('error', (err) =>
        done({ success: false, migrationsApplied: 0, error: err.message }),
      );
      child.on('close', (code) => {
        if (code === 0) {
          done({ success: true, migrationsApplied: countRequiredSqlMigrations(root) });
        } else {
          // Never echo the URL: the script's own messages do not include it.
          done({
            success: false,
            migrationsApplied: 0,
            error: `run-target-database-migrations.sh exited ${String(code)}: ${stderrTail.trim()}`,
          });
        }
      });
    });
  }
}

export class FileBootstrapStore implements BootstrapStore {
  constructor(private readonly path: string) {}

  private read(): BootstrapRunRecord[] {
    if (!existsSync(this.path)) return [];
    const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as { runs?: BootstrapRunRecord[] };
    return Array.isArray(parsed.runs) ? parsed.runs : [];
  }

  private write(runs: BootstrapRunRecord[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, runs }, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  async createRun(run: BootstrapRunRecord): Promise<void> {
    this.write([...this.read().filter((r) => r.id !== run.id), run]);
  }

  async updateRun(id: string, updates: Partial<BootstrapRunRecord>): Promise<void> {
    this.write(this.read().map((r) => (r.id === id ? { ...r, ...updates, id } : r)));
  }

  async getLatestRun(): Promise<BootstrapRunRecord | null> {
    const runs = this.read();
    return runs.length ? runs[runs.length - 1]! : null;
  }

  async getRun(id: string): Promise<BootstrapRunRecord | null> {
    return this.read().find((r) => r.id === id) ?? null;
  }
}

/** Open a TCP connection, optionally write `hello`, resolve with the first bytes received. */
export function tcpExchange(
  host: string,
  port: number,
  hello: Buffer | null,
  timeoutMs = 3000,
): Promise<Buffer> {
  return new Promise((done, fail) => {
    let socket: Socket | null = null;
    const timer = setTimeout(() => {
      socket?.destroy();
      fail(new Error(`timeout connecting to ${host}:${port}`));
    }, timeoutMs);
    socket = connect({ host, port }, () => {
      if (hello) socket!.write(hello);
      else {
        clearTimeout(timer);
        socket!.end();
        done(Buffer.alloc(0));
      }
    });
    socket.once('data', (data) => {
      clearTimeout(timer);
      socket.destroy();
      done(data);
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      fail(err);
    });
  });
}

async function timed(fn: () => Promise<string | null>): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const error = await fn();
    return error
      ? { healthy: false, latencyMs: Date.now() - start, error }
      : { healthy: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function httpReachable(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  const res = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
  // Any HTTP answer (incl. 403 from a private bucket) proves the endpoint is reachable.
  return res.status >= 500 ? `HTTP ${res.status} from ${url}` : null;
}

/** Postgres SSLRequest: a real server answers a single 'S' or 'N' byte. */
const PG_SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);
/** AMQP 0-9-1 protocol header: a broker answers with a Connection.Start method frame. */
const AMQP_HEADER = Buffer.from('AMQP\x00\x00\x09\x01', 'latin1');

export function createNetworkConnectivityTester(
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): ConnectivityTester {
  const fetchImpl = options.fetchImpl ?? fetch;
  const t = options.timeoutMs ?? 3000;
  return {
    testCdn: (config) => timed(() => httpReachable(config.baseUrl, fetchImpl)),
    testDatabase: (config) =>
      timed(async () => {
        const reply = await tcpExchange(config.host, config.port, PG_SSL_REQUEST, t);
        const b = String.fromCharCode(reply[0] ?? 0);
        return b === 'S' || b === 'N' ? null : 'endpoint did not answer like PostgreSQL';
      }),
    testStorage: (config) =>
      timed(() =>
        httpReachable(
          config.endpoint ?? `https://s3.${config.region ?? 'us-east-1'}.amazonaws.com`,
          fetchImpl,
        ),
      ),
    testCache: (config) =>
      timed(async () => {
        if (config.adapter === 'memory') return null;
        const auth = config.password
          ? `*2\r\n$4\r\nAUTH\r\n$${Buffer.byteLength(config.password)}\r\n${config.password}\r\n`
          : '';
        const reply = (
          await tcpExchange(
            config.host ?? 'localhost',
            config.port ?? 6379,
            Buffer.from(`${auth}PING\r\n`),
            t,
          )
        ).toString();
        if (reply.startsWith('+PONG') || reply.startsWith('+OK')) return null;
        return `Redis answered: ${reply.split('\r\n')[0] ?? ''}`;
      }),
    testQueue: (config) =>
      timed(async () => {
        if (config.backend === 'rabbitmq' && config.rabbitmq) {
          const u = new URL(config.rabbitmq.url);
          const port = Number(u.port || (u.protocol === 'amqps:' ? 5671 : 5672));
          const reply = await tcpExchange(u.hostname, port, AMQP_HEADER, t);
          return reply[0] === 1 ? null : 'endpoint did not answer like an AMQP 0-9-1 broker';
        }
        if (config.backend === 'kafka' && config.kafka) {
          const [host, port] = (config.kafka.brokers[0] ?? '').split(':');
          await tcpExchange(host ?? 'localhost', Number(port || 9092), null, t);
          return null;
        }
        if (config.backend === 'sqs' && config.sqs) {
          return httpReachable(
            config.sqs.endpoint ?? `https://sqs.${config.sqs.region}.amazonaws.com`,
            fetchImpl,
          );
        }
        return `queue backend ${config.backend} has no connection settings`;
      }),
  };
}

/** OIDC discovery probe for the platform IdP (KEYCLOAK_ISSUER / INSTALL_IDP_ISSUER). */
export async function probeIdentityProvider(
  issuer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult> {
  return timed(async () => {
    const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return `IdP discovery returned HTTP ${res.status}`;
    const doc = (await res.json()) as { issuer?: string };
    return doc.issuer === issuer.replace(/\/$/, '') || doc.issuer === issuer
      ? null
      : `IdP discovery issuer mismatch (${doc.issuer ?? 'missing'})`;
  });
}

export type InstallAdminMode = 'refuse' | 'idp-delegated';

export function resolveInstallAdminMode(
  env: Record<string, string | undefined> = process.env,
): InstallAdminMode {
  return env['INSTALL_ADMIN_MODE']?.trim().toLowerCase() === 'idp-delegated'
    ? 'idp-delegated'
    : 'refuse';
}

export const ADMIN_REFUSED =
  'install CLI does not create platform admins (INSTALL_ADMIN_MODE=refuse). Provision the admin ' +
  'in the identity provider, then re-run with --skip-admin or INSTALL_ADMIN_MODE=idp-delegated.';

/** Admin step for idp-delegated mode: verifies the IdP is reachable, never creates accounts. */
export class IdpDelegatedAdminCreator implements AdminAccountCreator {
  constructor(
    private readonly options: {
      issuer?: string;
      logger: InstallerLogger;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async createAdmin(
    admin: AdminAccountConfig,
  ): Promise<{ success: boolean; userId?: string; error?: string; delegated?: boolean }> {
    if (!this.options.issuer) {
      return {
        success: false,
        error: 'idp-delegated admin mode needs KEYCLOAK_ISSUER / INSTALL_IDP_ISSUER',
      };
    }
    const probe = await probeIdentityProvider(this.options.issuer, this.options.fetchImpl);
    if (!probe.healthy) return { success: false, error: probe.error };
    this.options.logger.info(
      `Admin ${admin.username} is delegated to the identity provider (${this.options.issuer}); no local account created`,
    );
    return { success: true, delegated: true };
  }
}
