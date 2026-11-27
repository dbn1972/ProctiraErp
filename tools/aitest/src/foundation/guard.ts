/**
 * Host capacity controls (program plan D11).
 *
 * serverGuard runs `~/bin/server-guard.sh` (or AITEST_GUARD_CMD) before a
 * heavy phase and waits while the host is saturated. On hosts without the
 * guard (CI runners) it is a no-op. withBuildLock serialises heavy builds
 * host-wide through flock(1) on a lock file shared by every worktree.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { run, sleep } from './exec.js';

export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['AITEST_STATE_DIR'] ?? join(homedir(), '.local', 'state', 'proctira-aitest');
}

function guardCommand(env: NodeJS.ProcessEnv): string | undefined {
  const explicit = env['AITEST_GUARD_CMD'];
  if (explicit !== undefined) return explicit.trim() || undefined;
  const path = join(homedir(), 'bin', 'server-guard.sh');
  try {
    accessSync(path, constants.X_OK);
    return path;
  } catch {
    return undefined;
  }
}

export interface GuardOptions {
  retries?: number;
  delayMs?: number;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
}

export async function serverGuard(label: string, o: GuardOptions = {}): Promise<void> {
  const env = o.env ?? process.env;
  const cmd = guardCommand(env);
  if (!cmd) return;
  const retries = o.retries ?? 30;
  const delayMs = o.delayMs ?? 60_000;
  const log = o.log ?? ((l: string) => process.stderr.write(`${l}\n`));
  for (let attempt = 1; attempt <= retries; attempt++) {
    const r = await run('bash', ['-c', cmd], { env });
    if (r.code === 0) return;
    const reason = (r.stdout + r.stderr).trim().split('\n').slice(-1)[0] ?? '';
    log(`[aitest] server guard blocked ${label} (attempt ${attempt}/${retries}): ${reason}`);
    if (attempt < retries) await sleep(delayMs);
  }
  throw new Error(`server guard still failing after ${retries} attempts; not starting ${label}`);
}

export async function withBuildLock<T>(
  fn: () => Promise<T>,
  o: { stateDir?: string; lockName?: string } = {},
): Promise<T> {
  const dir = o.stateDir ?? defaultStateDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockFile = join(dir, o.lockName ?? 'build.lock');
  // flock holds the lock while `cat` waits on our stdin; closing stdin (or
  // this process dying) ends cat and releases the lock.
  const child = spawn('flock', ['-x', lockFile, 'sh', '-c', 'echo locked; exec cat'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`flock exited ${String(code)} before locking`)));
    child.stdout.once('data', () => resolve());
  });
  try {
    return await fn();
  } finally {
    child.removeAllListeners('exit');
    child.stdin.end();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', () => resolve());
    });
  }
}
