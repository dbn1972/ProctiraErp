/**
 * Host-run Node services (program plan D4, section 4.3 steps 6-7): the
 * gateway, workers and Next apps run from the worktree under test, each in its
 * own process group with its log under <projectDir>/logs/. Builds happen once
 * per worktree and git sha (marker file), Next builds under the host build lock.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { baseServiceEnv, isAlive, run, runOrThrow, sleep, spawnDetached } from '../exec.js';
import { withBuildLock } from '../guard.js';
import { waitPortsUnbound, type PortName } from '../ports.js';

import { expandPlaceholders } from './compose.js';
import { readEnvFile } from './secrets.js';
import { redisUrl, stackDbUrls, stackSecrets } from './state.js';
import { WEB_APPS, type NodeService, type StackState, type WebApp } from './types.js';

interface ServiceDef {
  pkg: string;
  dir: string;
  port: PortName;
  health: string;
  /** Backend bundle entry (dist/...), or the literal 'next' for Next apps. */
  entry: string;
}

const WEB_PORT_NAMES: Record<WebApp, PortName> = {
  web: 'web',
  'registration-portal': 'registrationPortal',
  'public-website': 'publicWebsite',
  'admin-console': 'adminConsole',
  'developer-portal': 'developerPortal',
  'install-wizard': 'installWizard',
};

export const SERVICE_DEFS: Readonly<Record<NodeService, ServiceDef>> = {
  gateway: {
    pkg: '@proctira/api-gateway',
    dir: 'apps/api-gateway',
    port: 'gateway',
    health: '/health',
    entry: 'dist/server.js',
  },
  gateway2: {
    pkg: '@proctira/api-gateway',
    dir: 'apps/api-gateway',
    port: 'gateway2',
    health: '/health',
    entry: 'dist/server.js',
  },
  'etl-worker': {
    pkg: '@proctira/etl-worker',
    dir: 'apps/etl-worker',
    port: 'etlWorker',
    health: '/health/ready',
    entry: 'dist/server.js',
  },
  'exam-document-worker': {
    pkg: '@proctira/exam-document-worker',
    dir: 'workers/exam-document',
    port: 'examDocumentWorker',
    health: '/health/ready',
    entry: 'dist/main.js',
  },
  ...(Object.fromEntries(
    WEB_APPS.map((app) => [
      app,
      {
        pkg: `@proctira/${app}`,
        dir: `apps/${app}`,
        port: WEB_PORT_NAMES[app],
        health: '/api/health',
        entry: 'next',
      },
    ]),
  ) as Record<WebApp, ServiceDef>),
};

export function serviceUrl(s: StackState, svc: NodeService): string {
  const def = SERVICE_DEFS[svc];
  // Next apps use localhost: session cookies are host-bound (fake-session.ts).
  const host = def.entry === 'next' ? 'localhost' : '127.0.0.1';
  return `http://${host}:${s.ports[def.port]}`;
}

function webOrigins(s: StackState): string {
  return WEB_APPS.flatMap((app) => {
    const p = s.ports[WEB_PORT_NAMES[app]];
    return [`http://localhost:${p}`, `http://127.0.0.1:${p}`];
  }).join(',');
}

function fullProfileEnv(s: StackState): Record<string, string> {
  if (s.profile !== 'full') return {};
  const x = stackSecrets(s);
  return {
    KAFKA_BROKERS: `127.0.0.1:${s.ports.kafka}`,
    RABBITMQ_URL: `amqp://proctira:${encodeURIComponent(x.rabbitPassword)}@127.0.0.1:${s.ports.rabbitmq}`,
    QUEUE_BACKEND: 'rabbitmq',
    RABBITMQ_EXCHANGE: 'proctira.events',
    S3_ENDPOINT: `http://127.0.0.1:${s.ports.minio}`,
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'proctira',
    S3_SECRET_KEY: x.minioPassword,
    S3_BUCKET: 'proctira-aitest',
    S3_FORCE_PATH_STYLE: 'true',
  };
}

export function keycloakIssuer(s: StackState): string {
  return `http://127.0.0.1:${s.ports.keycloak}/realms/proctira`;
}

/** Environment for one service (secrets included: child env only, never logged). */
export function serviceEnv(s: StackState, svc: NodeService): NodeJS.ProcessEnv {
  const def = SERVICE_DEFS[svc];
  const port = String(s.ports[def.port]);
  const x = stackSecrets(s);
  const urls = s.profile === 'none' ? undefined : stackDbUrls(s);
  const nodeEnv = s.options.nodeEnv ?? 'development';
  let env: Record<string, string> = {};
  if (svc === 'gateway' || svc === 'gateway2') {
    env = {
      PORT: port,
      HOST: '127.0.0.1',
      NODE_ENV: nodeEnv,
      LOG_LEVEL: 'info',
      ...(urls ? { DATABASE_URL: urls.runtime } : {}),
      ...(s.profile === 'core' || s.profile === 'full' ? { REDIS_URL: redisUrl(s) } : {}),
      JWT_SECRET: x.jwtSecret,
      COOKIE_SECRET: x.cookieSecret,
      CORS_ORIGINS: webOrigins(s),
      RATE_LIMIT_MAX_REQUESTS: '10000',
      FEES_STAFF_SANDBOX_PAYMENTS: 'true',
      TENANT_BASE_DOMAIN: 'proctira.localhost',
      NEXT_PUBLIC_WEB_URL: serviceUrl(s, 'web'),
      ...fullProfileEnv(s),
    };
    if (nodeEnv === 'production') {
      env['AUDIT_CHAIN_HMAC_KEY'] = x.auditChainKey;
      env['MFA_PRE_TICKET_SECRET'] = x.mfaTicketSecret;
      env['TRUSTED_PROXY_CIDRS'] = '127.0.0.1/32';
      if (!s.keycloak) env['ALLOW_LOCAL_HS_AUTH'] = '1';
    } else if (s.seeded) {
      // The gateway's demo seeders write into the seeded e2e tenants; with
      // strict tenant FKs they abort boot on an unseeded database.
      env['SEED_DEMO_DATA'] = '1';
    }
    if (s.keycloak) {
      const issuer = keycloakIssuer(s);
      const kcSecret = readEnvFile(s.envFile)['KEYCLOAK_CLIENT_SECRET'];
      if (!kcSecret)
        throw new Error(
          'Keycloak client secret missing: ensureKeycloakUsers runs before the gateway',
        );
      Object.assign(env, {
        KEYCLOAK_ISSUER: issuer,
        KEYCLOAK_JWKS_URI: `${issuer}/protocol/openid-connect/certs`,
        KEYCLOAK_CLIENT_ID: 'proctira-gateway',
        KEYCLOAK_CLIENT_SECRET: kcSecret,
        KEYCLOAK_REALM: 'proctira',
        KEYCLOAK_REDIRECT_URI: `${serviceUrl(s, 'gateway')}/api/v1/auth/callback`,
      });
    }
  } else if (svc === 'etl-worker') {
    env = {
      NODE_ENV: nodeEnv,
      LOG_LEVEL: 'info',
      ETL_WORKER_PORT: port,
      ETL_WORKER_HOST: '127.0.0.1',
      ...(urls ? { DATABASE_URL: urls.runtime } : {}),
      ...fullProfileEnv(s),
    };
  } else if (svc === 'exam-document-worker') {
    env = {
      NODE_ENV: nodeEnv,
      LOG_LEVEL: 'info',
      EXAM_DOCUMENT_WORKER_PORT: port,
      EXAM_DOCUMENT_WORKER_HOST: '127.0.0.1',
      ...(urls ? { DATABASE_URL: urls.runtime } : {}),
      ...fullProfileEnv(s),
    };
  } else {
    const gateway = s.urls.gateways[0] ?? serviceUrl(s, 'gateway');
    env = {
      NODE_ENV: 'production',
      PORT: port,
      HOSTNAME: '127.0.0.1',
      NEXT_PUBLIC_API_URL: gateway,
      NEXT_PUBLIC_GATEWAY_URL: gateway,
      GATEWAY_URL: gateway,
      AUTH_SERVICE_URL: gateway,
      COOKIE_SECRET: x.cookieSecret,
      TENANT_FALLBACK_SLUG: 'sunrise-public-school',
      TENANT_BASE_DOMAIN: 'proctira.localhost',
      FEES_STAFF_SANDBOX_PAYMENTS: 'true',
    };
  }
  const overrides = expandPlaceholders(s.options.serviceEnv?.[svc] ?? {}, {
    projectDir: s.projectDir,
    ports: s.ports,
  });
  return { ...baseServiceEnv(), ...env, ...overrides };
}

function markerFile(s: StackState, svc: NodeService): string {
  const def = SERVICE_DEFS[svc];
  return def.entry === 'next'
    ? join(s.repoRoot, def.dir, '.next', '.aitest-build')
    : join(s.repoRoot, def.dir, 'dist', '.aitest-build');
}

function buildStamp(s: StackState, svc: NodeService): string {
  // Next bakes NEXT_PUBLIC_* at build time, so the stamp includes the gateway URL.
  return SERVICE_DEFS[svc].entry === 'next' ? `${s.gitSha} ${s.urls.gateways[0] ?? ''}` : s.gitSha;
}

/** Builds the service's package unless this worktree already built it for this sha. */
export async function buildService(s: StackState, svc: NodeService): Promise<void> {
  const def = SERVICE_DEFS[svc];
  const marker = markerFile(s, svc);
  const stamp = buildStamp(s, svc);
  const entryOk = def.entry === 'next' || existsSync(join(s.repoRoot, def.dir, def.entry));
  if (entryOk && existsSync(marker) && readFileSync(marker, 'utf8') === stamp) return;
  const log = join(s.projectDir, 'logs', `build-${svc}.log`);
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ['DATABASE_URL', 'MIGRATOR_DATABASE_URL', 'REDIS_URL', 'JWT_SECRET'])
    delete env[k];
  if (def.entry === 'next') {
    const gateway = s.urls.gateways[0] ?? serviceUrl(s, 'gateway');
    Object.assign(env, {
      NEXT_PUBLIC_API_URL: gateway,
      NEXT_PUBLIC_GATEWAY_URL: gateway,
      GATEWAY_URL: gateway,
      NEXT_TELEMETRY_DISABLED: '1',
    });
  }
  const build = () =>
    runOrThrow('pnpm', ['--filter', def.pkg, 'build'], {
      cwd: s.repoRoot,
      env,
      logFile: log,
      label: `build ${def.pkg}`,
    });
  if (def.entry === 'next') {
    // `next build` rewrites the tracked next-env.d.ts; undo that when this
    // build is what dirtied it, so track worktrees stay clean.
    const nextEnv = join(def.dir, 'next-env.d.ts');
    const wasClean =
      (await run('git', ['-C', s.repoRoot, 'diff', '--quiet', '--', nextEnv])).code === 0;
    await withBuildLock(build);
    if (wasClean) await run('git', ['-C', s.repoRoot, 'checkout', '--', nextEnv]);
  } else await build();
  writeFileSync(marker, stamp);
}

export async function waitForHttp(
  url: string,
  o: { pid?: number; timeoutMs?: number; log?: string } = {},
): Promise<void> {
  const deadline = Date.now() + (o.timeoutMs ?? 120_000);
  let last = '';
  while (Date.now() < deadline) {
    if (o.pid !== undefined && !isAlive(o.pid)) break;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(1_000);
  }
  let tail = '';
  if (o.log && existsSync(o.log)) {
    tail = readFileSync(o.log, 'utf8').split('\n').slice(-80).join('\n');
  }
  const why = o.pid !== undefined && !isAlive(o.pid) ? 'process exited' : `timed out (${last})`;
  throw new Error(`${url} not healthy: ${why}${tail ? `\n--- last log lines ---\n${tail}` : ''}`);
}

/** Starts one service (building it first if needed) and waits for its health URL. */
export async function launchService(
  s: StackState,
  svc: NodeService,
): Promise<{ pid: number; port: number; log: string }> {
  const def = SERVICE_DEFS[svc];
  await buildService(s, svc);
  const log = join(s.projectDir, 'logs', `${svc}.log`);
  const port = s.ports[def.port];
  const cwd = join(s.repoRoot, def.dir);
  const nodeOpts = s.options.serviceNodeOptions?.[svc] ?? [];
  const args =
    def.entry === 'next'
      ? [
          ...nodeOpts,
          join(cwd, 'node_modules', 'next', 'dist', 'bin', 'next'),
          'start',
          '-p',
          String(port),
          '-H',
          '127.0.0.1',
        ]
      : [
          ...nodeOpts,
          '--import',
          join(s.repoRoot, 'tools/scripts/backend-runtime-resolve.mjs'),
          '--enable-source-maps',
          def.entry,
        ];
  // The block sits inside the ephemeral port range: an outgoing connection can
  // hold the port for a moment, so wait for it and retry a lost bind race.
  for (let attempt = 1; ; attempt++) {
    await waitPortsUnbound([port]);
    const logStart = existsSync(log) ? readFileSync(log, 'utf8').length : 0;
    const pid = spawnDetached(process.execPath, args, {
      cwd,
      env: serviceEnv(s, svc),
      logFile: log,
    });
    try {
      await waitForHttp(`${serviceUrl(s, svc)}${def.health}`, {
        pid,
        log,
        timeoutMs: def.entry === 'next' ? 180_000 : 120_000,
      });
      return { pid, port, log };
    } catch (err) {
      await killGroup(pid);
      const lostBind = readFileSync(log, 'utf8').slice(logStart).includes('EADDRINUSE');
      if (!lostBind || attempt >= 3) throw err;
    }
  }
}

/** SIGTERM the process group, wait up to graceMs, then SIGKILL. */
export async function killGroup(
  pid: number,
  signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM',
  graceMs = 10_000,
): Promise<void> {
  const send = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        // already gone
      }
    }
  };
  if (!isAlive(pid)) return;
  send(signal);
  const deadline = Date.now() + graceMs;
  while (isAlive(pid) && Date.now() < deadline) await sleep(250);
  if (isAlive(pid)) send('SIGKILL');
  const hard = Date.now() + 5_000;
  while (isAlive(pid) && Date.now() < hard) await sleep(100);
}
