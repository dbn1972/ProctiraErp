/**
 * The only way aitest talks to docker compose.
 *
 * Every call is pinned to one `proctira-aitest-*` project, the repo compose
 * file plus the aitest overlay, and the stack's generated env file. Projects
 * outside that namespace (proctira-erp, proctira-uatenv, proctira-staging,
 * ...) are refused, and so are host-wide subcommands such as `system prune`.
 */
import { join } from 'node:path';

import { baseServiceEnv, run, type RunResult } from '../exec.js';
import { PORT_OFFSETS, PROJECT_RE, type PortMap, type PortName } from '../ports.js';

export const AITEST_DIR_REL = 'tools/aitest';
export const OVERLAY_REL = 'tools/aitest/stack/docker-compose.aitest.yml';

export interface ComposeTarget {
  project: string;
  repoRoot: string;
  envFile: string;
  /** Extra overlays, relative to tools/aitest (or absolute). */
  extraComposeFiles?: string[];
}

export function assertAitestProject(project: string): void {
  if (!PROJECT_RE.test(project)) {
    throw new Error(
      `refusing compose project ${JSON.stringify(project)}: only proctira-aitest-* projects are allowed`,
    );
  }
}

const REFUSED_SUBCOMMANDS = new Set(['system', 'context']);

export function assertSafeComposeArgs(args: string[]): void {
  const first = args[0];
  if (first === undefined) throw new Error('compose subcommand required');
  if (first.startsWith('-')) {
    throw new Error(`compose global flags are fixed by aitest; got ${first}`);
  }
  if (REFUSED_SUBCOMMANDS.has(first)) throw new Error(`refusing compose subcommand ${first}`);
  for (let i = 0; i < args.length - 1; i++) {
    if (
      ['volume', 'network', 'image', 'container', 'builder'].includes(args[i] ?? '') &&
      args[i + 1] === 'prune'
    ) {
      throw new Error(`refusing ${args[i] ?? ''} prune`);
    }
  }
  for (const a of args) {
    if (
      a === '-p' ||
      a === '--project-name' ||
      a.startsWith('--project-name=') ||
      a === '--env-file'
    ) {
      throw new Error(`compose ${a} is fixed by aitest and may not be overridden`);
    }
  }
}

export function composeFiles(t: ComposeTarget): string[] {
  const files = [join(t.repoRoot, 'docker-compose.yml'), join(t.repoRoot, OVERLAY_REL)];
  for (const f of t.extraComposeFiles ?? []) {
    files.push(f.startsWith('/') ? f : join(t.repoRoot, AITEST_DIR_REL, f));
  }
  return files;
}

export function buildComposeArgs(t: ComposeTarget, args: string[]): string[] {
  assertAitestProject(t.project);
  assertSafeComposeArgs(args);
  const out = ['compose', '-p', t.project, '--project-directory', t.repoRoot];
  for (const f of composeFiles(t)) out.push('-f', f);
  out.push('--env-file', t.envFile, ...args);
  return out;
}

/** Environment for the docker CLI: no inherited compose variables (they would override the env file). */
export function composeEnv(): NodeJS.ProcessEnv {
  const env = baseServiceEnv();
  for (const k of [
    'DOCKER_HOST',
    'DOCKER_CONFIG',
    'DOCKER_CONTEXT',
    'DOCKER_CERT_PATH',
    'DOCKER_TLS_VERIFY',
  ]) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

export async function composeRun(
  t: ComposeTarget,
  args: string[],
  o: { timeoutMs?: number; logFile?: string } = {},
): Promise<RunResult> {
  return run('docker', buildComposeArgs(t, args), {
    cwd: t.repoRoot,
    env: composeEnv(),
    ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
    ...(o.logFile ? { logFile: o.logFile } : {}),
  });
}

/**
 * Expands `${AITEST_PROJECT_DIR}` and `${PORT:<offset name>}` (for example
 * `${PORT:trackLocal}`) in per-service env overrides. Unknown placeholders throw.
 */
export function expandPlaceholders(
  values: Record<string, string>,
  ctx: { projectDir: string; ports: PortMap },
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = v.replace(
      /\$\{([A-Za-z_]+)(?::([A-Za-z0-9]+))?\}/g,
      (whole, name: string, arg?: string) => {
        if (name === 'AITEST_PROJECT_DIR' && arg === undefined) return ctx.projectDir;
        if (name === 'PORT' && arg !== undefined) {
          if (!(arg in PORT_OFFSETS)) throw new Error(`unknown port name in ${whole}`);
          return String(ctx.ports[arg as PortName]);
        }
        throw new Error(`unknown placeholder ${whole} in ${k}`);
      },
    );
  }
  return out;
}
