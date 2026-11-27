import type { PortMap } from '../ports.js';

/** 'none' = no containers (scanners, mutation testing). */
export type Profile = 'none' | 'db' | 'core' | 'full';
export type WebApp =
  | 'web'
  | 'registration-portal'
  | 'public-website'
  | 'admin-console'
  | 'developer-portal'
  | 'install-wizard';
export type Worker = 'etl-worker' | 'exam-document-worker';
export type NodeService = 'gateway' | 'gateway2' | Worker | WebApp;

export const WEB_APPS: readonly WebApp[] = [
  'web',
  'registration-portal',
  'public-website',
  'admin-console',
  'developer-portal',
  'install-wizard',
];

export interface StackOptions {
  unit: string;
  profile: Profile;
  portBase?: number;
  project?: string;
  /** Default: 0 for none/db, 1 otherwise. */
  gateways?: 0 | 1 | 2;
  /** full profile only. */
  workers?: Worker[];
  /** Built once per worktree under withBuildLock, served with `next start`. */
  webApps?: WebApp[];
  /** full profile only. Puts the gateway in Keycloak (RS256) mode: HS256 tokens are then refused. */
  keycloak?: boolean;
  /** Gateway NODE_ENV, default development (e2e harness parity). */
  nodeEnv?: 'development' | 'production';
  /**
   * Per-service env overrides. Values expand ${AITEST_PROJECT_DIR} and
   * ${PORT:<offset name>} (for example ${PORT:trackLocal}).
   */
  serviceEnv?: Partial<Record<NodeService, Record<string, string>>>;
  /** Extra node flags per service, e.g. ['--import', '<abs>/clock-preload.mjs']. */
  serviceNodeOptions?: Partial<Record<NodeService, string[]>>;
  /** Extra compose overlays on the same project; paths relative to tools/aitest. */
  extraComposeFiles?: string[];
  /** Default true. */
  seed?: boolean;
  /** Default $AITEST_STATE_DIR ?? ~/.local/state/proctira-aitest. */
  stateDir?: string;
  /** Repo root (worktree) under test. Default: the checkout holding this file. */
  repoRoot?: string;
}

export interface ServiceRecord {
  pid: number;
  port: number;
  log: string;
}

export interface StackState {
  unit: string;
  project: string;
  portBase: number;
  profile: Profile;
  repoRoot: string;
  gitSha: string;
  createdAt: string;
  ports: PortMap;
  /** No credentials in any URL. */
  urls: {
    gateways: string[];
    web: Partial<Record<WebApp, string>>;
    keycloak?: string;
    kafkaBrokers?: string;
    rabbitmqMgmt?: string;
    minio?: string;
  };
  /** mode 600, generated secrets. */
  envFile: string;
  services: Partial<Record<NodeService, ServiceRecord>>;
  fixturesFile: string;
  stateFile: string;
  /** <stateDir>/<project>: env file, logs, fixtures, keycloak users, track files. */
  projectDir: string;
  /** Options the stack was started with (secrets never included). */
  options: Omit<StackOptions, 'stateDir' | 'repoRoot'>;
  keycloak?: boolean;
  migrated?: boolean;
  seeded?: boolean;
}
