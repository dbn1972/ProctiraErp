/**
 * PRC-L081: deleting a report-card template that generated report cards still
 * reference (report_card_jobs.template_id ON DELETE RESTRICT) maps the
 * Postgres FK violation (23503) to a 409 ConflictError instead of a raw 500.
 */
import { ConflictError } from '@proctira/common';
import { describe, expect, it, vi } from 'vitest';

import { PgReportCardTemplateRepository } from './pg-report-card-repository.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const TEMPLATE = '22222222-2222-4222-8222-222222222222';

/** Pool that passes the schema-readiness probe and fails DELETE with `deleteError`. */
function poolFailingDelete(deleteError: Error) {
  const client = {
    query: vi.fn(async (text: string) => {
      if (/^\s*DELETE/i.test(text)) throw deleteError;
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    // Readiness probe: report every requested relation/migration as present.
    query: vi.fn(async (_text: string, params?: unknown[]) => {
      const [relations, migrations] = (params ?? [[], []]) as [string[], string[]];
      return {
        rows: [
          ...relations.map((name) => ({
            requirement_type: 'relation',
            requirement_name: name,
            requirement_exists: true,
          })),
          ...migrations.map((name) => ({
            requirement_type: 'migration',
            requirement_name: name,
            requirement_exists: true,
          })),
        ],
      };
    }),
    connect: vi.fn(async () => client),
  };
}

describe('PRC-L081: PgReportCardTemplateRepository.delete FK mapping', () => {
  it('maps a 23503 foreign-key violation to ConflictError (409)', async () => {
    const fkError = Object.assign(new Error('violates foreign key constraint'), {
      code: '23503',
    });
    const repo = new PgReportCardTemplateRepository(poolFailingDelete(fkError) as never);
    const attempt = repo.delete(TEMPLATE, TENANT);
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rethrows any other database error unchanged', async () => {
    const other = Object.assign(new Error('connection reset'), { code: '08006' });
    const repo = new PgReportCardTemplateRepository(poolFailingDelete(other) as never);
    await expect(repo.delete(TEMPLATE, TENANT)).rejects.toBe(other);
  });
});
