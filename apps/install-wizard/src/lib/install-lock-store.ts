/**
 * PRC-M467: global, persisted "installed" lock and operator bootstrap secret for the Install
 * Wizard BFF (server-only; Node runtime).
 *
 * - The lock is one file (`INSTALL_LOCK_FILE`), written once with `O_EXCL` at finalize. Every
 *   session — a fresh one, one in another process, one after a restart — sees it, so a new
 *   session can no longer bypass the one-time lock. When NODE_ENV is production-like the path
 *   must be configured (point it at a persistent volume); without it the BFF fails closed (503).
 * - Session issuance requires the operator's bootstrap secret (`INSTALL_BOOTSTRAP_SECRET`, from
 *   the secret manager), compared in constant time. Unset or too short -> 503, never open.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const BOOTSTRAP_SECRET_HEADER = 'x-install-bootstrap-secret';
export const MIN_BOOTSTRAP_SECRET_LENGTH = 16;

/** Anything other than development/test (including unset) is production-like. */
function isProductionLike(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== 'development' && nodeEnv !== 'test';
}

/** Resolved lock path, or null when it is required but not configured. */
export function resolveInstallLockPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.INSTALL_LOCK_FILE?.trim();
  if (configured) return configured;
  if (isProductionLike(env.NODE_ENV)) return null;
  return join(tmpdir(), 'proctira-install-wizard.lock');
}

export type InstallLockState = 'locked' | 'unlocked' | 'unconfigured';

export function installLockState(): InstallLockState {
  const path = resolveInstallLockPath();
  if (!path) return 'unconfigured';
  return existsSync(path) ? 'locked' : 'unlocked';
}

/**
 * Engage the global lock exactly once. Returns `conflict` when another finalize already won.
 */
export function persistInstallLock(record: {
  runId: string;
  completedAt: string;
}): 'locked' | 'conflict' | 'unconfigured' | 'error' {
  const path = resolveInstallLockPath();
  if (!path) return 'unconfigured';
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 });
    return 'locked';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'conflict' : 'error';
  }
}

/** Test-only: drop the lock file. Refused when NODE_ENV is production-like. */
export function resetInstallLockForTests(): void {
  if (isProductionLike()) return;
  const path = resolveInstallLockPath();
  if (path && existsSync(path)) unlinkSync(path);
}

export type BootstrapSecretCheck = 'ok' | 'invalid' | 'unconfigured';

/** Constant-time check of the operator bootstrap secret. */
export function checkBootstrapSecret(
  provided: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): BootstrapSecretCheck {
  const expected = env.INSTALL_BOOTSTRAP_SECRET?.trim();
  if (!expected || expected.length < MIN_BOOTSTRAP_SECRET_LENGTH) return 'unconfigured';
  if (!provided) return 'invalid';
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b) ? 'ok' : 'invalid';
}
