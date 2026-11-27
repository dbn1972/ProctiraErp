/**
 * Child-process helpers. Secrets travel only in `env` (or stdin), never in
 * argv, and nothing here logs the environment.
 */
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RunOptions {
  cwd?: string;
  /** Full child environment. Defaults to the parent environment. */
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  /** Append stdout/stderr to this file instead of buffering them. */
  logFile?: string;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(cmd: string, args: string[], o: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let logFd: number | undefined;
    if (o.logFile) {
      mkdirSync(dirname(o.logFile), { recursive: true, mode: 0o700 });
      logFd = openSync(o.logFile, 'a', 0o600);
    }
    const child = spawn(cmd, args, {
      cwd: o.cwd,
      env: o.env ?? process.env,
      stdio: [o.input === undefined ? 'ignore' : 'pipe', logFd ?? 'pipe', logFd ?? 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    let timer: NodeJS.Timeout | undefined;
    if (o.timeoutMs) {
      timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs);
    }
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      if (logFd !== undefined) closeSync(logFd);
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (logFd !== undefined) closeSync(logFd);
      resolve({ code: code ?? (signal ? 128 : 1), stdout, stderr });
    });
    if (o.input !== undefined) {
      child.stdin?.end(o.input);
    }
  });
}

export async function runOrThrow(
  cmd: string,
  args: string[],
  o: RunOptions & { label?: string } = {},
): Promise<RunResult> {
  const r = await run(cmd, args, o);
  if (r.code !== 0) {
    const where = o.logFile ? ` (log: ${o.logFile})` : '';
    const tail = (r.stderr || r.stdout).trim().split('\n').slice(-20).join('\n');
    throw new Error(`${o.label ?? cmd} exited ${r.code}${where}${tail ? `\n${tail}` : ''}`);
  }
  return r;
}

/**
 * Starts a long-running process in its own process group (detached), with
 * stdout/stderr appended to `logFile`. Returns the pid (= process group id).
 */
export function spawnDetached(
  cmd: string,
  args: string[],
  o: { cwd: string; env: NodeJS.ProcessEnv; logFile: string },
): number {
  mkdirSync(dirname(o.logFile), { recursive: true, mode: 0o700 });
  const fd = openSync(o.logFile, 'a', 0o600);
  const child = spawn(cmd, args, {
    cwd: o.cwd,
    env: o.env,
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  child.unref();
  if (child.pid === undefined) throw new Error(`could not start ${cmd}`);
  return child.pid;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Minimal environment for host-run services: no inherited app configuration. */
export function baseServiceEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'USER', 'SHELL', 'TZ'];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}
