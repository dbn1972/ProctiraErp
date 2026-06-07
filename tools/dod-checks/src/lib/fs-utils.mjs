/**
 * Lightweight file-system utilities. We intentionally avoid third-party globbers
 * to keep this tool runnable without `pnpm install` (CI bootstrap).
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.turbo',
  'coverage',
  '.next',
  '.git',
  'build',
  'out',
  '__test_fixtures__',
  '__fixtures__',
]);

/**
 * Recursively walk `dir` collecting any file for which `predicate(name, fullPath)`
 * returns truthy. Hidden directories and common build outputs are skipped.
 */
export async function findFiles(dir, predicate) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      results.push(...(await findFiles(fullPath, predicate)));
    } else if (predicate(entry.name, fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Read a file, returning '' on failure (so checks can degrade gracefully). */
export async function safeReadFile(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

/** Convenience predicate: files matching extension and excluding tests. */
export function isProductionTsFile(name) {
  return (
    name.endsWith('.ts') &&
    !name.endsWith('.test.ts') &&
    !name.endsWith('.spec.ts') &&
    !name.endsWith('.d.ts')
  );
}
