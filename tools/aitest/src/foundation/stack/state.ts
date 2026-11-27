/**
 * Stack state on disk (<stateDir>/<project>/state.json) and the context a
 * running suite builds from it. Secrets are read lazily from the env file
 * and never written into state.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTokenFactory, type TokenFactory } from '../auth/tokens.js';
import { defaultStateDir } from '../guard.js';
import { ApiClient } from '../http/client.js';
import type { FixtureManifest } from '../seed/fixtures.js';

import {
  APP_USER,
  BOOTSTRAP_USER,
  MIGRATOR_USER,
  pgUrl,
  readEnvFile,
  secretsFromEnv,
  type StackSecrets,
} from './secrets.js';
import type { StackState, WebApp } from './types.js';

export function projectDirFor(project: string, stateDir = defaultStateDir()): string {
  return join(stateDir, project);
}

export function stateFileFor(project: string, stateDir = defaultStateDir()): string {
  return join(projectDirFor(project, stateDir), 'state.json');
}

export function saveState(s: StackState): void {
  mkdirSync(s.projectDir, { recursive: true, mode: 0o700 });
  writeFileSync(s.stateFile, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
}

export function loadState(file: string): StackState {
  return JSON.parse(readFileSync(file, 'utf8')) as StackState;
}

export function tryLoadState(file: string): StackState | undefined {
  return existsSync(file) ? loadState(file) : undefined;
}

export function stackSecrets(s: StackState): StackSecrets {
  return secretsFromEnv(readEnvFile(s.envFile));
}

export function stackDbUrls(s: StackState): {
  runtime: string;
  migrator: string;
  bootstrap: string;
} {
  const x = stackSecrets(s);
  return {
    runtime: pgUrl(APP_USER, x.appRolePassword, s.ports.postgres),
    migrator: pgUrl(MIGRATOR_USER, x.migratorPassword, s.ports.postgres),
    bootstrap: pgUrl(BOOTSTRAP_USER, x.postgresPassword, s.ports.postgres),
  };
}

export function redisUrl(s: StackState): string {
  return `redis://:${encodeURIComponent(stackSecrets(s).redisPassword)}@127.0.0.1:${s.ports.redis}`;
}

export interface StackContext {
  state: StackState;
  /** Read lazily from the env file; never log. */
  secrets(): StackSecrets;
  db: { runtimeUrl(): string; migratorUrl(): string; bootstrapUrl(): string };
  fixtures: FixtureManifest;
  tokens: TokenFactory;
  api(gatewayIndex?: 0 | 1): ApiClient;
  webUrl(app?: WebApp): string;
  outDir: string;
}

export function contextFromState(s: StackState, outDir: string): StackContext {
  const secrets = () => stackSecrets(s);
  const fixtures = existsSync(s.fixturesFile)
    ? (JSON.parse(readFileSync(s.fixturesFile, 'utf8')) as FixtureManifest)
    : ({
        generatedAt: '',
        gitSha: s.gitSha,
        tenants: {},
        ids: {},
        principals: { guardians: {}, students: {} },
      } as unknown as FixtureManifest);
  const tokens = createTokenFactory(secrets().jwtSecret, fixtures);
  mkdirSync(outDir, { recursive: true });
  return {
    state: s,
    secrets,
    db: {
      runtimeUrl: () => stackDbUrls(s).runtime,
      migratorUrl: () => stackDbUrls(s).migrator,
      bootstrapUrl: () => stackDbUrls(s).bootstrap,
    },
    fixtures,
    tokens,
    api(gatewayIndex = 0) {
      const url = s.urls.gateways[gatewayIndex];
      if (!url) throw new Error(`stack ${s.project} has no gateway #${gatewayIndex + 1}`);
      return new ApiClient(url, { mint: (p) => tokens.mint(p) });
    },
    webUrl(app = 'web') {
      const url = s.urls.web[app];
      if (!url) throw new Error(`stack ${s.project} does not serve ${app}`);
      return url;
    },
    outDir,
  };
}

/** From AITEST_STACK_STATE (state file path) and AITEST_OUT_DIR, as set by `aitest run`. */
export function loadStackContext(env: NodeJS.ProcessEnv = process.env): StackContext {
  const file = env['AITEST_STACK_STATE'];
  if (!file)
    throw new Error('AITEST_STACK_STATE is not set: start the suite with `aitest run <suite>`');
  const s = loadState(file);
  return contextFromState(s, env['AITEST_OUT_DIR'] ?? join(s.projectDir, 'out'));
}
