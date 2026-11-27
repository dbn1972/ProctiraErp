import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from './exec.js';

/** Root of the checkout (worktree) that holds this file: tools/aitest/src/foundation → repo. */
export function repoRootFromHere(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
}

export function aitestDir(repoRoot = repoRootFromHere()): string {
  return join(repoRoot, 'tools', 'aitest');
}

export async function gitSha(repoRoot: string): Promise<string> {
  const r = await run('git', ['-C', repoRoot, 'rev-parse', 'HEAD']);
  return r.code === 0 ? r.stdout.trim() : 'unknown';
}
