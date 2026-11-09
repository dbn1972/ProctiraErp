/**
 * UAT-API-005 — turbo runs `test` tasks in strict env mode, so a variable that is
 * not listed in turbo.json `tasks.test.env` never reaches vitest. The RLS / owner-role
 * cases gated on MIGRATOR_DATABASE_URL then skip silently even when it is exported.
 *
 * Every *_DATABASE_URL / *_REDIS_URL name a package test reads must be listed, unless
 * it is an optional override that falls back to DATABASE_URL (still gated correctly).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Optional overrides read as `process.env[X] ?? process.env['DATABASE_URL']`. */
const FALLBACK_OVERRIDES = new Set(['TEST_DATABASE_URL', 'OUTBOX_LIVE_DATABASE_URL']);

const ENV_NAME = /process\.env(?:\.|\[['"])([A-Z0-9_]*(?:DATABASE_URL|REDIS_URL))\b/g;

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, out);
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('UAT-API-005 turbo test env passes the DB/Redis names tests gate on', () => {
  const turbo = JSON.parse(readFileSync(join(root, 'turbo.json'), 'utf8')) as {
    tasks: { test: { env?: string[] } };
  };
  const testEnv = new Set(turbo.tasks.test.env ?? []);

  it('lists DATABASE_URL, MIGRATOR_DATABASE_URL and REDIS_URL', () => {
    for (const name of ['DATABASE_URL', 'MIGRATOR_DATABASE_URL', 'REDIS_URL']) {
      expect(testEnv.has(name), `turbo.json tasks.test.env lacks ${name}`).toBe(true);
    }
  });

  it('lists every *_DATABASE_URL / *_REDIS_URL name read by packages/ and apps/ tests', () => {
    const missing = new Set<string>();
    for (const file of [...testFiles(join(root, 'packages')), ...testFiles(join(root, 'apps'))]) {
      for (const match of readFileSync(file, 'utf8').matchAll(ENV_NAME)) {
        const name = match[1]!;
        if (!testEnv.has(name) && !FALLBACK_OVERRIDES.has(name)) missing.add(name);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
