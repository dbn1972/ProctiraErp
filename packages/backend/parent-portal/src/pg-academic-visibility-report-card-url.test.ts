/**
 * PRC-L083 (failing-first, privacy): the parent/student report-card reads must never return the
 * raw `report_card_jobs.output_url` storage key. `outputUrl` keeps its name and `string | null`
 * type, but now carries the authenticated download path (mirroring assessment's
 * `report-card-routes.ts` `downloadUrl`) when output exists, and `null` otherwise.
 */
import { describe, expect, it } from 'vitest';
import { PgAcademicVisibilityStore } from './pg-academic-visibility-store.js';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';
const READY_JOB = '00000000-0000-4000-8000-0000000000a1';
const EMPTY_JOB = '00000000-0000-4000-8000-0000000000a2';
const STORAGE_KEY = 'tenants/t-1/report-cards/2026/secret-object-key.pdf';

/** A pg-like pool that serves two completed report-card jobs: one with output, one without. */
function fakeReportCardPool() {
  return {
    query: async (sql: string) => {
      if (sql.includes('FROM report_card_jobs')) {
        return {
          rows: [
            {
              id: READY_JOB,
              academic_period_id: null,
              status: 'completed',
              output_url: STORAGE_KEY,
              completed_at: new Date('2026-10-01T00:00:00Z'),
            },
            {
              id: EMPTY_JOB,
              academic_period_id: null,
              status: 'completed',
              output_url: null,
              completed_at: new Date('2026-10-02T00:00:00Z'),
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
}

describe('PgAcademicVisibilityStore report-card outputUrl (PRC-L083)', () => {
  it('grades summary returns the download path, never the storage key', async () => {
    const store = new PgAcademicVisibilityStore(fakeReportCardPool() as never);
    const grades = await store.getGrades(TENANT_A, STUDENT_ID);
    expect(JSON.stringify(grades)).not.toContain(STORAGE_KEY);
    const byId = new Map(grades.reportCards.map((card) => [card.id, card]));
    expect(byId.get(READY_JOB)?.outputUrl).toBe(`/report-cards/jobs/${READY_JOB}/download`);
    expect(byId.get(EMPTY_JOB)?.outputUrl).toBeNull();
  });

  it('report-card detail returns the download path, never the storage key', async () => {
    const store = new PgAcademicVisibilityStore(fakeReportCardPool() as never);
    const cards = await store.getReportCards(TENANT_A, STUDENT_ID);
    expect(JSON.stringify(cards)).not.toContain(STORAGE_KEY);
    const byId = new Map(cards.data.map((card) => [card.id, card]));
    expect(byId.get(READY_JOB)?.outputUrl).toBe(`/report-cards/jobs/${READY_JOB}/download`);
    expect(byId.get(EMPTY_JOB)?.outputUrl).toBeNull();
  });
});
