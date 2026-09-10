/**
 * Schema bootstrap for HR appraisal + training tables (G-717).
 * Applies db/sql/024_wave7_domain_persistence_schema.sql once per process.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type pg from 'pg';

export type PgPoolLike = Pick<pg.Pool, 'query'> & Partial<Pick<pg.Pool, 'connect' | 'end'>>;

let schemaReady: Promise<void> | null = null;

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const name = '024_wave7_domain_persistence_schema.sql';
  const roots = [
    join(here, '../../../../db/sql'),
    join(process.cwd(), 'db/sql'),
    join(process.cwd(), '../../db/sql'),
  ];
  for (const root of roots) {
    const path = join(root, name);
    try {
      readFileSync(path, 'utf8');
      return path;
    } catch {
      // try next
    }
  }
  return join(roots[0]!, name);
}

export async function ensureHrSchema(pool: PgPoolLike): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(readFileSync(schemaSqlPath(), 'utf8'));
    })().catch((err: unknown) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

export function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

export function toDateStr(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}
