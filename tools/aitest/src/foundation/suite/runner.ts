/**
 * `aitest run <suite>`: stack up → run the suite with AITEST_STACK_STATE /
 * AITEST_OUT_DIR → stack down. Database and Redis URLs go to the suite
 * process environment only (backend packages read them at import time).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { serverGuard } from '../guard.js';
import { repoRootFromHere } from '../repo.js';
import { downStack, upStack } from '../stack/stack.js';
import { loadState, redisUrl, stackDbUrls } from '../stack/state.js';
import type { StackState } from '../stack/types.js';

import { discoverSuites } from './discover.js';
import type { SuiteSpec } from './spec.js';

export interface RunSuiteOptions {
  out?: string;
  keepStack?: boolean;
  reuseStateFile?: string;
  portBase?: number;
  project?: string;
  unit?: string;
  repoRoot?: string;
}

export function suiteCommand(spec: SuiteSpec, aitestDir: string): { cmd: string; args: string[] } {
  const bin = (name: string) => join(aitestDir, 'node_modules', '.bin', name);
  if (spec.runner === 'vitest') {
    return {
      cmd: bin('vitest'),
      args: ['run', '--config', 'vitest.aitest.config.ts', ...(spec.include ?? [])],
    };
  }
  if (spec.runner === 'playwright') {
    return {
      cmd: bin('playwright'),
      args: ['test', '-c', 'playwright.aitest.config.ts', ...(spec.include ?? [])],
    };
  }
  return { cmd: process.execPath, args: ['--import', 'tsx', spec.entry ?? ''] };
}

export function suiteEnv(spec: SuiteSpec, s: StackState, outDir: string): NodeJS.ProcessEnv {
  // Spec env holds defaults (e.g. AITEST_NUM_RUNS); a value exported by the
  // caller wins, so a local or replay run can override it.
  const env: NodeJS.ProcessEnv = {
    ...spec.env,
    ...process.env,
    AITEST_STACK_STATE: s.stateFile,
    AITEST_OUT_DIR: outDir,
    AITEST_SUITE: spec.id,
  };
  for (const k of ['DATABASE_URL', 'MIGRATOR_DATABASE_URL', 'REDIS_URL']) delete env[k];
  if (s.profile !== 'none') {
    const urls = stackDbUrls(s);
    env['DATABASE_URL'] = urls.runtime;
    env['MIGRATOR_DATABASE_URL'] = urls.migrator;
    if (s.profile !== 'db') env['REDIS_URL'] = redisUrl(s);
  }
  return env;
}

function failedCount(outDir: string): number {
  const f = join(outDir, 'results.json');
  if (!existsSync(f)) return 0;
  const doc = JSON.parse(readFileSync(f, 'utf8')) as { counts?: { fail?: number } };
  return doc.counts?.fail ?? 0;
}

/** Returns the exit code: non-zero when the suite process failed or recorded failures. */
export async function runSuite(id: string, o: RunSuiteOptions = {}): Promise<number> {
  const repoRoot = o.repoRoot ?? repoRootFromHere();
  const spec = discoverSuites(repoRoot).find((x) => x.id === id);
  if (!spec) throw new Error(`unknown suite ${id}`);
  const aitestDir = join(repoRoot, 'tools/aitest');
  let s: StackState;
  let owned = false;
  if (o.reuseStateFile) {
    s = loadState(o.reuseStateFile);
  } else {
    s = await upStack({
      unit: o.unit ?? spec.unit,
      profile: spec.profile,
      repoRoot,
      ...(o.portBase !== undefined ? { portBase: o.portBase } : {}),
      ...(o.project !== undefined ? { project: o.project } : {}),
      ...(spec.gateways !== undefined ? { gateways: spec.gateways } : {}),
      ...(spec.workers ? { workers: spec.workers } : {}),
      ...(spec.webApps ? { webApps: spec.webApps } : {}),
      ...(spec.keycloak ? { keycloak: spec.keycloak } : {}),
      ...(spec.nodeEnv ? { nodeEnv: spec.nodeEnv } : {}),
      ...spec.stack,
    });
    owned = true;
  }
  const outDir = o.out ?? join(s.projectDir, 'out', spec.id);
  try {
    await serverGuard(`suite ${spec.id}`);
    const { cmd, args } = suiteCommand(spec, aitestDir);
    const child = await runInherit(cmd, args, {
      cwd: aitestDir,
      env: suiteEnv(spec, s, outDir),
      timeoutMs: spec.timeoutMinutes * 60_000,
    });
    const failed = failedCount(outDir);
    process.stderr.write(
      `[aitest] suite ${spec.id}: exit ${child}, recorded failures ${failed}, out ${outDir}\n`,
    );
    return child !== 0 || failed > 0 ? 1 : 0;
  } finally {
    if (owned && !o.keepStack) await downStack(s);
  }
}

/** Runs with inherited stdio (suite output goes to the caller's log). */
function runInherit(
  cmd: string,
  args: string[],
  o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: 'inherit' });
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}
