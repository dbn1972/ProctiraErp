/**
 * W1-DATA-14 — Pg gradebook path: GUCs on mutate; no app INSERT into grade_change_audit.
 */
import { describe, expect, it, vi } from 'vitest';

import { PgGradebookExtrasStore } from './extras-store.js';
import { GradebookService } from './gradebook-service.js';
import { PgGradebookRepository } from './pg-gradebook-repository.js';

describe('W1-DATA-14 PgGradebook single audit writer', () => {
  it('PgGradebookRepository advertises writesAuditViaDatabase', () => {
    const repo = new PgGradebookRepository({ query: vi.fn() } as never);
    expect(repo.writesAuditViaDatabase).toBe(true);
  });

  it('createGradeEntry sets grade_change GUCs and never INSERTs grade_change_audit', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const entryId = '22222222-2222-4222-8222-222222222222';
    const actorId = '33333333-3333-4333-8333-333333333333';
    const row = {
      id: entryId,
      tenant_id: tenantId,
      section_id: null,
      student_id: '44444444-4444-4444-8444-444444444444',
      assessment_code: 'MATH',
      numeric_score: 90,
      letter_grade: 'A',
      entered_by: actorId,
      entered_at: new Date().toISOString(),
      locked_at: null,
      published_at: null,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
        if (text.includes('set_config')) return { rows: [] };
        if (text.includes('INSERT INTO grade_entries')) return { rows: [row] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const repo = new PgGradebookRepository(pool as never);

    await repo.createGradeEntry(
      {
        id: entryId,
        tenantId,
        sectionId: null,
        studentId: String(row.student_id),
        assessmentCode: 'MATH',
        numericScore: 90,
        letterGrade: 'A',
        enteredBy: actorId,
        enteredAt: row.entered_at,
        lockedAt: null,
        publishedAt: null,
        metadata: {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      { action: 'grade.upsert', actorId },
    );

    const texts = queries.map((q) => q.text);
    expect(texts.some((t) => t.includes("set_config('app.grade_change_action'"))).toBe(true);
    expect(texts.some((t) => t.includes("set_config('app.grade_change_actor_id'"))).toBe(true);
    expect(texts.some((t) => t.includes('INSERT INTO grade_entries'))).toBe(true);
    expect(texts.some((t) => t.includes('INSERT INTO grade_change_audit'))).toBe(false);

    const actionCall = queries.find((q) => q.text.includes("set_config('app.grade_change_action'"));
    expect(actionCall?.values?.[0]).toBe('grade.upsert');
  });

  it('PgGradebookExtrasStore.appendAudit is a no-op (no INSERT)', async () => {
    const client = {
      query: vi.fn(async () => {
        throw new Error('appendAudit must not query');
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const store = new PgGradebookExtrasStore(pool as never);
    expect(store.writesAuditViaDatabase).toBe(true);

    const row = await store.appendAudit({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      gradeEntryId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      action: 'grade.upsert',
      fromStatus: null,
      toStatus: 'DRAFT',
      fromNumericScore: null,
      toNumericScore: 80,
      fromLetterGrade: null,
      toLetterGrade: 'B',
      actorId: null,
      details: {},
      createdAt: new Date().toISOString(),
    });

    expect(row.action).toBe('grade.upsert');
    expect(client.query).not.toHaveBeenCalled();
  });

  it('GradebookService does not call extras.appendAudit when repo writes via DB', async () => {
    const appendAudit = vi.fn();
    const createGradeEntry = vi.fn(async (row: unknown) => row);
    const findGradeEntry = vi.fn(async () => null);
    const repo = {
      writesAuditViaDatabase: true as const,
      findGradeEntry,
      createGradeEntry,
      updateGradeEntry: vi.fn(),
      getGradeEntry: vi.fn(),
      listGradeEntries: vi.fn(async () => []),
      listCreditRules: vi.fn(async () => []),
      getCreditRuleByCode: vi.fn(),
      createCreditRule: vi.fn(),
      listGradingScales: vi.fn(async () => []),
      getGradingScale: vi.fn(),
      getDefaultGradingScale: vi.fn(),
      createGpaSnapshot: vi.fn(),
      listGpaSnapshots: vi.fn(async () => []),
      getGpaSnapshot: vi.fn(),
      listTranscripts: vi.fn(async () => []),
      getTranscript: vi.fn(),
      getLatestTranscriptVersion: vi.fn(),
      createTranscript: vi.fn(),
      createExportJob: vi.fn(),
      getExportJob: vi.fn(),
      updateExportJob: vi.fn(),
      listExportJobs: vi.fn(async () => []),
      listSections: vi.fn(async () => []),
      listBoards: vi.fn(async () => []),
      listInstitutions: vi.fn(async () => []),
      listBoardCodes: vi.fn(async () => []),
      listBoardExportCandidates: vi.fn(async () => []),
    };
    const extras = {
      writesAuditViaDatabase: true as const,
      appendAudit,
      listAudits: vi.fn(async () => []),
      createComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      listComments: vi.fn(async () => []),
      getComment: vi.fn(),
      saveRankBatch: vi.fn(),
      listLatestRanks: vi.fn(async () => []),
    };

    const service = new GradebookService(repo as never, extras as never);
    await service.upsertGradeEntry('dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
      studentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      assessmentCode: 'SCI',
      numericScore: 88,
    });

    expect(createGradeEntry).toHaveBeenCalledTimes(1);
    expect(createGradeEntry.mock.calls[0]?.[1]).toEqual({
      action: 'grade.upsert',
      actorId: null,
    });
    expect(appendAudit).not.toHaveBeenCalled();
  });
});
