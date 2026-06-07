/**
 * Path helpers for resolving the monorepo root and key directories regardless
 * of the working directory the user invoked the check from.
 */
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Walk upward from the current file until we find a `pnpm-workspace.yaml`,
 * which marks the monorepo root. This works whether the script is invoked
 * from `pnpm`, an IDE, or directly with `node`.
 */
function findRepoRoot(startDir) {
  let current = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Fallback: assume tools/dod-checks/src/lib/ is 4 levels deep.
  return resolve(startDir, '../../../..');
}

export const REPO_ROOT = findRepoRoot(here);
export const BACKEND_DIR = resolve(REPO_ROOT, 'packages/backend');
export const SHARED_DIR = resolve(REPO_ROOT, 'packages/shared');
export const PACKAGES_DIR = resolve(REPO_ROOT, 'packages');
export const REPORTS_DIR = resolve(REPO_ROOT, 'tools/dod-checks/reports');

/**
 * Convert an absolute path into a path relative to the repo root.
 * Used everywhere we render filenames in human/JSON reports.
 */
export function toRepoRelative(absPath) {
  return relative(REPO_ROOT, absPath) || absPath;
}

/**
 * Derive a service id from any path under `packages/backend/<service>/...`.
 * Returns the empty string if the path is not within a backend service.
 */
export function getBackendServiceName(absPath) {
  const rel = relative(BACKEND_DIR, absPath);
  if (rel.startsWith('..') || rel.startsWith('/')) return '';
  return rel.split('/')[0] || '';
}
