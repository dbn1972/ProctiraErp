/**
 * PRC-M343 — exam_results against the real migrated schema. Rows come only from
 * published marks (examination_academic_records, written at result publication),
 * with explicit columns and a PASS/FAIL result. Draft double-entry marks
 * (exam_marks_entries) never appear. Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';

import { fetchCatalogueTable } from './providers.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'providers-exam-results.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

describe.skipIf(!live)('PRC-M343 exam_results reads published marks only (live)', () => {
  it('returns published academic records with explicit columns; drafts are absent', async () => {
    const tenantId = randomUUID();
    const published = randomUUID();
    const draftOnly = randomUUID();
    const examId = randomUUID();
    const subjectA = randomUUID();
    const subjectB = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    await ensurePgTestStudent(pool!, tenantId, published);
    await ensurePgTestStudent(pool!, tenantId, draftOnly);
    await withPgTenant(pool!, tenantId, async (client) => {
      await client.query(
        `INSERT INTO examinations (id, tenant_id, name, code, academic_period_id, start_date, end_date, status, updated_at)
         VALUES ($1, $2, 'Annual 2026', $3, $4, '2026-03-01', '2026-03-20', 'PUBLISHED', now())`,
        [examId, tenantId, `ANN-${tenantId.slice(0, 8)}`, randomUUID()],
      );
      for (const [subjectId, score, grade, passed] of [
        [subjectA, 78, 'B1', true],
        [subjectB, 21, 'E', false],
      ] as const) {
        await client.query(
          `INSERT INTO examination_academic_records
             (tenant_id, student_id, examination_id, subject_id, score, grade, passed, published_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-04-01T10:00:00Z')`,
          [tenantId, published, examId, subjectId, score, grade, passed],
        );
      }
      // Unpublished double-entry marks for another candidate.
      await client.query(
        `INSERT INTO exam_marks_entries
           (id, tenant_id, examination_id, candidate_id, subject_id, entry_no, marks, entered_by)
         VALUES ($1, $2, $3, $4, $5, 1, 99, 'teacher-1')`,
        [randomUUID(), tenantId, examId, draftOnly, subjectA],
      );
    });

    const table = await fetchCatalogueTable(tenantId, 'exam_results');
    expect(table.columns.map((c) => c.name)).toEqual([
      'examinationCode',
      'examination',
      'studentId',
      'subjectId',
      'score',
      'grade',
      'result',
      'publishedAt',
      'tenantId',
    ]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows.every((r) => r.studentId === published)).toBe(true);
    expect(table.rows.map((r) => [r.score, r.grade, r.result]).sort()).toEqual(
      [
        [21, 'E', 'FAIL'],
        [78, 'B1', 'PASS'],
      ].sort(),
    );
    expect(table.rows[0]?.examination).toBe('Annual 2026');
  });

  it('another tenant sees none of these results', async () => {
    const other = randomUUID();
    await ensurePgTestTenant(pool!, other);
    const table = await fetchCatalogueTable(other, 'exam_results');
    expect(table.rows).toEqual([]);
  });
});
