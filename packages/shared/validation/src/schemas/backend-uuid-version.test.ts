/**
 * UATENV-D35: gateway request schemas must accept every RFC 9562 UUID version
 * (1-8), as {@link UuidSchema} does. Seeded and migrated ids are not always
 * version 4 (the Sunrise seed uses uuid_generate_v5), and a v4-only pattern
 * refused them with 400 VALIDATION_ERROR (attendance roster and bulk marking).
 *
 * This scans the backend module sources for a hand-written pattern that pins
 * the version nibble to 4.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import { UuidSchema } from './uuid';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const BACKEND_DIR = join(REPO_ROOT, 'packages/backend');

/** `-4[0-9a-f]{3}-` style version pin, in string or regex-literal form. */
const V4_ONLY = /-4\[(?:0-9a-f|0-9a-fA-F|0-9A-Fa-f|a-f0-9|0-9A-F)\]\{3\}-/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name) && !full.includes('__tests__'))
      out.push(full);
  }
  return out;
}

describe('backend UUID patterns (UATENV-D35)', () => {
  it('no backend module source pins UUIDs to version 4', () => {
    const offenders: string[] = [];
    for (const pkg of readdirSync(BACKEND_DIR)) {
      const src = join(BACKEND_DIR, pkg, 'src');
      try {
        if (!statSync(src).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const file of sourceFiles(src)) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (V4_ONLY.test(line)) offenders.push(`${relative(REPO_ROOT, file)}:${i + 1}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the shared schema accepts a seed-style version-5 id', () => {
    expect(Value.Check(UuidSchema, '9e1a3c1e-0d8f-5b7a-9f43-2c6b1d0e8a77')).toBe(true);
  });
});
