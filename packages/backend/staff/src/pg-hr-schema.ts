/**
 * Read-only schema readiness for HR appraisal + training tables (G-717).
 * DDL is applied by the migrator path before application startup.
 */
import { createDatabaseSchemaReadinessCheck } from '@proctira/database';
import type pg from 'pg';

export type PgPoolLike = Pick<pg.Pool, 'query'> & Partial<Pick<pg.Pool, 'connect' | 'end'>>;

const ensureHrSchemaReady = createDatabaseSchemaReadinessCheck(
  'HR appraisals and training',
  'hrAppraisalTraining',
);

export async function ensureHrSchema(pool: PgPoolLike): Promise<void> {
  await ensureHrSchemaReady(pool);
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
