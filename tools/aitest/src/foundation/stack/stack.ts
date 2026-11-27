/**
 * Throwaway stack lifecycle (program plan D4, section 4.3): compose datastores
 * for one proctira-aitest-* project + host-run Node services from the
 * worktree under test. upStack is idempotent; downStack removes the
 * containers, volumes, processes and state it created, and proves it.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { ensureKeycloakUsers } from '../auth/keycloak.js';
import { isAlive, run, type RunResult } from '../exec.js';
import { defaultStateDir, serverGuard } from '../guard.js';
import {
  assertPortsFree,
  portsFor,
  resolveUnit,
  waitPortsUnbound,
  type PortName,
} from '../ports.js';
import { gitSha, repoRootFromHere } from '../repo.js';
import { buildFixtureManifest, writeFixtureManifest } from '../seed/fixtures.js';
import { applySyntheticSeed } from '../seed/seed.js';

import { assertAitestProject, composeEnv, composeRun, type ComposeTarget } from './compose.js';
import { migrateStack, waitForPostgres } from './migrate.js';
import { generateSecrets, renderEnvFile, writeEnvFile } from './secrets.js';
import { killGroup, launchService, SERVICE_DEFS, serviceUrl, waitForHttp } from './services.js';
import { projectDirFor, saveState, tryLoadState } from './state.js';
import type { NodeService, Profile, StackOptions, StackState, WebApp } from './types.js';

export type { NodeService, Profile, StackOptions, StackState, WebApp, Worker } from './types.js';

const DATASTORES: Record<Profile, string[]> = {
  none: [],
  db: ['postgres'],
  core: ['postgres', 'redis'],
  full: ['postgres', 'redis', 'kafka', 'rabbitmq', 'minio'],
};

const DATASTORE_PORTS: Record<string, PortName[]> = {
  postgres: ['postgres'],
  redis: ['redis'],
  kafka: ['kafka'],
  rabbitmq: ['rabbitmq', 'rabbitmqMgmt'],
  minio: ['minio', 'minioConsole'],
  keycloak: ['keycloak'],
};

export function validateOptions(o: StackOptions): void {
  if (o.keycloak && o.profile !== 'full') throw new Error('keycloak needs profile full');
  if (o.workers?.length && o.profile !== 'full') throw new Error('workers need profile full');
  if (o.profile === 'none' && (o.gateways || o.webApps?.length)) {
    throw new Error('profile none starts no services');
  }
  if (o.webApps?.length && gatewayCount(o) === 0) throw new Error('web apps need a gateway');
}

export function gatewayCount(o: Pick<StackOptions, 'profile' | 'gateways'>): number {
  if (o.gateways !== undefined) return o.gateways;
  return o.profile === 'none' || o.profile === 'db' ? 0 : 1;
}

export function datastoresFor(o: Pick<StackOptions, 'profile' | 'keycloak'>): string[] {
  return [...DATASTORES[o.profile], ...(o.keycloak ? ['keycloak'] : [])];
}

export function servicesFor(o: StackOptions): NodeService[] {
  const out: NodeService[] = [];
  const n = gatewayCount(o);
  if (n >= 1) out.push('gateway');
  if (n >= 2) out.push('gateway2');
  out.push(...(o.workers ?? []), ...(o.webApps ?? []));
  return out;
}

/** Every host port the stack binds, for the pre-flight free-port check. */
export function portsUsed(o: StackOptions, base: number): number[] {
  const ports = portsFor(base);
  const names: PortName[] = datastoresFor(o).flatMap((d) => DATASTORE_PORTS[d] ?? []);
  for (const svc of servicesFor(o)) names.push(SERVICE_DEFS[svc].port);
  return names.map((n) => ports[n]);
}

function target(s: StackState): ComposeTarget {
  return {
    project: s.project,
    repoRoot: s.repoRoot,
    envFile: s.envFile,
    ...(s.options.extraComposeFiles ? { extraComposeFiles: s.options.extraComposeFiles } : {}),
  };
}

export async function composeExec(s: StackState, args: string[]): Promise<RunResult> {
  return composeRun(target(s), args);
}

function log(line: string): void {
  process.stderr.write(`[aitest] ${line}\n`);
}

function comparable(o: Omit<StackOptions, 'stateDir' | 'repoRoot'>): string {
  return JSON.stringify(o, Object.keys(o).sort());
}

async function projectContainers(
  project: string,
): Promise<Array<{ name: string; status: string }>> {
  assertAitestProject(project);
  const r = await run(
    'docker',
    [
      'ps',
      '-a',
      '--filter',
      `label=com.docker.compose.project=${project}`,
      '--format',
      '{{.Names}}\t{{.Status}}',
    ],
    { env: composeEnv() },
  );
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [name = '', status = ''] = l.split('\t');
      return { name, status };
    });
}

async function projectVolumes(project: string): Promise<string[]> {
  assertAitestProject(project);
  const r = await run(
    'docker',
    ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`],
    {
      env: composeEnv(),
    },
  );
  return r.stdout.split('\n').filter(Boolean);
}

async function isHealthy(s: StackState): Promise<boolean> {
  const containers = await projectContainers(s.project);
  const wanted = datastoresFor(s.options);
  if (containers.length < wanted.length) return false;
  if (containers.some((c) => !c.status.startsWith('Up') || c.status.includes('unhealthy')))
    return false;
  for (const [svc, rec] of Object.entries(s.services) as Array<[NodeService, { pid: number }]>) {
    if (!isAlive(rec.pid)) return false;
    try {
      await waitForHttp(`${serviceUrl(s, svc)}${SERVICE_DEFS[svc].health}`, { timeoutMs: 5_000 });
    } catch {
      return false;
    }
  }
  return true;
}

export async function upStack(o: StackOptions): Promise<StackState> {
  validateOptions(o);
  const repoRoot = resolve(o.repoRoot ?? repoRootFromHere());
  const { unit, project, portBase } = resolveUnit(o.unit, {
    ...(o.portBase !== undefined ? { portBase: o.portBase } : {}),
    ...(o.project !== undefined ? { project: o.project } : {}),
  });
  const stateDir = o.stateDir ?? defaultStateDir();
  const projectDir = projectDirFor(project, stateDir);
  const stateFile = join(projectDir, 'state.json');
  const { stateDir: _sd, repoRoot: _rr, ...options } = o;
  const optionsKey = comparable({ ...options, unit, portBase, project });

  const existing = tryLoadState(stateFile);
  if (existing) {
    if (
      comparable({ ...existing.options, unit, portBase, project }) === optionsKey &&
      existing.repoRoot === repoRoot &&
      (await isHealthy(existing))
    ) {
      log(`reusing healthy stack ${project}`);
      return existing;
    }
    log(`existing stack ${project} differs or is unhealthy; tearing it down first`);
    await downStack(existing);
  }

  const ports = portsFor(portBase);
  await assertPortsFree(portsUsed(o, portBase));
  await serverGuard(`stack up ${project}`);

  mkdirSync(projectDir, { recursive: true, mode: 0o700 });
  const envFile = join(projectDir, 'aitest.env');
  writeEnvFile(envFile, renderEnvFile(generateSecrets(), ports, { unit }));

  const s: StackState = {
    unit,
    project,
    portBase,
    profile: o.profile,
    repoRoot,
    gitSha: await gitSha(repoRoot),
    createdAt: new Date().toISOString(),
    ports,
    urls: { gateways: [], web: {} },
    envFile,
    services: {},
    fixturesFile: join(projectDir, 'fixtures.json'),
    stateFile,
    projectDir,
    options: { ...options, unit, portBase, project },
    ...(o.keycloak ? { keycloak: true } : {}),
  };
  if (o.profile === 'full') {
    s.urls.kafkaBrokers = `127.0.0.1:${ports.kafka}`;
    s.urls.rabbitmqMgmt = `http://127.0.0.1:${ports.rabbitmqMgmt}`;
    s.urls.minio = `http://127.0.0.1:${ports.minio}`;
  }
  if (o.keycloak) s.urls.keycloak = `http://127.0.0.1:${ports.keycloak}`;
  saveState(s);

  try {
    const stores = datastoresFor(o);
    if (stores.length > 0) {
      await waitPortsUnbound(
        stores.flatMap((d) => (DATASTORE_PORTS[d] ?? []).map((n) => ports[n])),
      );
      log(`compose up ${project}: ${stores.join(', ')}`);
      const r = await composeRun(
        target(s),
        ['up', '-d', '--wait', '--wait-timeout', '300', ...stores],
        {
          logFile: join(projectDir, 'logs', 'compose.log'),
        },
      );
      if (r.code !== 0)
        throw new Error(`compose up failed (log: ${join(projectDir, 'logs', 'compose.log')})`);
    }
    if (o.profile !== 'none') {
      await waitForPostgres(s);
      log('migrating (prisma migrate deploy + apply-sql.sh)');
      await migrateStack(s);
      s.migrated = true;
      saveState(s);
      if (o.seed !== false) {
        log('seeding synthetic tenants');
        await applySyntheticSeed(s);
        writeFixtureManifest(s.fixturesFile, await buildFixtureManifest(s));
        s.seeded = true;
        saveState(s);
      }
    }
    if (o.keycloak) {
      log('Keycloak: client secret + role users');
      await ensureKeycloakUsers(s);
    }
    for (const svc of servicesFor(o)) {
      if (svc === 'gateway' || svc === 'gateway2') {
        s.urls.gateways.push(serviceUrl(s, svc));
      }
    }
    for (const svc of servicesFor(o)) {
      await serverGuard(`start ${svc}`);
      log(`starting ${svc}`);
      s.services[svc] = await launchService(s, svc);
      if (SERVICE_DEFS[svc].entry === 'next') s.urls.web[svc as WebApp] = serviceUrl(s, svc);
      saveState(s);
    }
    return s;
  } catch (err) {
    const keep = join(stateDir, 'failed', `${project}-${Date.now()}`);
    if (existsSync(join(projectDir, 'logs'))) {
      mkdirSync(keep, { recursive: true, mode: 0o700 });
      cpSync(join(projectDir, 'logs'), join(keep, 'logs'), { recursive: true });
      log(`stack up failed; logs kept in ${keep}`);
    }
    await downStack(s).catch((e: unknown) =>
      log(`teardown after failure also failed: ${String(e)}`),
    );
    throw err;
  }
}

export interface DownOptions {
  project?: string;
  portBase?: number;
  stateDir?: string;
  repoRoot?: string;
}

/**
 * Stops host services (process groups), runs compose down -v --remove-orphans,
 * verifies no container or volume of the project is left, deletes the state dir.
 */
export async function downStack(t: string | StackState, o: DownOptions = {}): Promise<void> {
  let s: StackState | undefined;
  let project: string;
  let unit: string;
  let portBase: number;
  const stateDir = o.stateDir ?? defaultStateDir();
  if (typeof t === 'string') {
    const r = resolveUnit(t, {
      ...(o.portBase !== undefined ? { portBase: o.portBase } : {}),
      ...(o.project !== undefined ? { project: o.project } : {}),
    });
    ({ project, unit, portBase } = r);
    s = tryLoadState(join(projectDirFor(project, stateDir), 'state.json'));
  } else {
    s = t;
    ({ project, unit, portBase } = t);
  }
  assertAitestProject(project);
  for (const rec of Object.values(s?.services ?? {})) {
    if (rec) await killGroup(rec.pid);
  }
  const repoRoot = s?.repoRoot ?? resolve(o.repoRoot ?? repoRootFromHere());
  let envFile = s?.envFile;
  let tmp: string | undefined;
  if (!envFile || !existsSync(envFile)) {
    tmp = mkdtempSync(join(tmpdir(), 'aitest-down-'));
    envFile = join(tmp, 'aitest.env');
    writeEnvFile(envFile, renderEnvFile(generateSecrets(), portsFor(portBase), { unit }));
  }
  try {
    const r = await composeRun(
      {
        project,
        repoRoot,
        envFile,
        ...(s?.options.extraComposeFiles ? { extraComposeFiles: s.options.extraComposeFiles } : {}),
      },
      ['down', '-v', '--remove-orphans', '--timeout', '20'],
    );
    if (r.code !== 0)
      throw new Error(`compose down failed: ${r.stderr.trim().split('\n').slice(-5).join('\n')}`);
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
  const left = await projectContainers(project);
  const vols = await projectVolumes(project);
  if (left.length > 0 || vols.length > 0) {
    throw new Error(
      `teardown of ${project} incomplete: containers [${left.map((c) => c.name).join(', ')}], volumes [${vols.join(', ')}]`,
    );
  }
  const dir = s?.projectDir ?? projectDirFor(project, stateDir);
  // Only ever a <stateDir>/proctira-aitest-* directory (project asserted above).
  if (basename(dir) === project && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

export async function stackStatus(
  unit: string,
  o: DownOptions = {},
): Promise<{ state?: StackState; containers: Array<{ name: string; status: string }> }> {
  const { project } = resolveUnit(unit, {
    ...(o.portBase !== undefined ? { portBase: o.portBase } : {}),
    ...(o.project !== undefined ? { project: o.project } : {}),
  });
  const state = tryLoadState(
    join(projectDirFor(project, o.stateDir ?? defaultStateDir()), 'state.json'),
  );
  return { ...(state ? { state } : {}), containers: await projectContainers(project) };
}

/** Chaos helper: stop one host service (its whole process group). */
export async function stopService(
  s: StackState,
  svc: NodeService,
  signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM',
): Promise<void> {
  const rec = s.services[svc];
  if (!rec) throw new Error(`${svc} is not part of stack ${s.project}`);
  await killGroup(rec.pid, signal, signal === 'SIGKILL' ? 0 : 10_000);
}

/** Restart one host service and wait for its health URL; updates the state file. */
export async function startService(s: StackState, svc: NodeService): Promise<void> {
  const rec = s.services[svc];
  if (rec && isAlive(rec.pid)) return;
  s.services[svc] = await launchService(s, svc);
  saveState(s);
}
