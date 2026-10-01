/**
 * Shared helpers for fixture-based DoD check tests. Builds a throw-away
 * `packages/backend` tree under the OS temp dir so checks run against
 * synthetic sources instead of the live monorepo.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * @param {Record<string, string>} files map of backend-relative path → contents
 * @param {(backendDir: string) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withBackendFixture(files, fn) {
  const root = await mkdtemp(join(tmpdir(), 'dod-fixture-'));
  const backendDir = join(root, 'packages', 'backend');
  try {
    for (const [rel, text] of Object.entries(files)) {
      const abs = join(backendDir, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, text, 'utf8');
    }
    return await fn(backendDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
