/**
 * PRC-M515: ids bound to UUID columns are UUID-checked at the HTTP edge, so a
 * malformed id is a 400 VALIDATION_ERROR instead of a Postgres 22P02 -> 500.
 * The repository is never reached for a rejected request.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryGradebookExtrasStore } from './extras-store.js';
import { gradebookPlugin } from './gradebook-plugin.js';
import { InMemoryGradebookRepository } from './in-memory-repository.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const SECTION = '44444444-4444-4444-8444-444444444444';
const BAD = 'not-a-uuid';

describe('PRC-M515 gradebook id validation', () => {
  let app: FastifyInstance;
  let repo: InMemoryGradebookRepository;
  let extras: InMemoryGradebookExtrasStore;

  beforeEach(async () => {
    repo = new InMemoryGradebookRepository();
    extras = new InMemoryGradebookExtrasStore();
    repo.seedSection({
      id: SECTION,
      tenantId: TENANT,
      institutionId: '66666666-6666-4666-8666-666666666666',
      academicPeriodId: '77777777-7777-4777-8777-777777777777',
      code: '10-A',
      name: 'Class 10-A',
      status: 'PUBLISHED',
    });
    app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      (
        request as FastifyRequest & { user: { tenantId: string; id: string; roles: string[] } }
      ).user = { tenantId: TENANT, id: 'actor-1', roles: ['admin'] };
    });
    await app.register(gradebookPlugin, { repository: repo, extras, prefix: '/gradebook' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  function expect400(res: { statusCode: number; json: () => unknown }) {
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  }

  it.each([
    `/gradebook/sections?institutionId=${BAD}`,
    `/gradebook/sections?academicPeriodId=${BAD}`,
    `/gradebook/entries?sectionId=${BAD}`,
    `/gradebook/entries?studentId=${BAD}`,
    `/gradebook/published?studentId=${BAD}`,
    `/gradebook/published?sectionId=${BAD}`,
    `/gradebook/comments-bank?subjectId=${BAD}`,
    `/gradebook/comments-bank?institutionId=${BAD}`,
    `/gradebook/rank?sectionId=${BAD}`,
    `/gradebook/audits?gradeEntryId=${BAD}`,
    `/gradebook/credit-rules?boardId=${BAD}`,
    `/gradebook/grading-scales?boardId=${BAD}`,
    `/gradebook/gpa?studentId=${BAD}`,
    `/gradebook/transcripts?studentId=${BAD}`,
  ])('GET %s -> 400 without a repository read', async (url) => {
    const listEntries = vi.spyOn(repo, 'listGradeEntries');
    const listSections = vi.spyOn(repo, 'listSections');
    expect400(await app.inject({ method: 'GET', url }));
    expect(listEntries).not.toHaveBeenCalled();
    expect(listSections).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', `/gradebook/entries/${BAD}/transition`, { action: 'submit' }],
    ['PUT', `/gradebook/comments-bank/${BAD}`, { label: 'L', body: 'B' }],
    ['DELETE', `/gradebook/comments-bank/${BAD}`, undefined],
    ['GET', `/gradebook/report-cards/${BAD}`, undefined],
    ['GET', `/gradebook/transcripts/${BAD}`, undefined],
    ['GET', `/gradebook/transcripts/${BAD}/download`, undefined],
    ['GET', `/gradebook/board-exports/${BAD}`, undefined],
    ['GET', `/gradebook/board-exports/${BAD}/download`, undefined],
    ['POST', `/gradebook/board-exports/${BAD}/process`, undefined],
  ] as const)('%s %s (:id) -> 400', async (method, url, payload) => {
    const getEntry = vi.spyOn(repo, 'getGradeEntry');
    const getTranscript = vi.spyOn(repo, 'getTranscript');
    const getExportJob = vi.spyOn(repo, 'getExportJob');
    expect400(await app.inject({ method, url, payload }));
    expect(getEntry).not.toHaveBeenCalled();
    expect(getTranscript).not.toHaveBeenCalled();
    expect(getExportJob).not.toHaveBeenCalled();
  });

  it.each([
    ['PUT', '/gradebook/entries', { sectionId: SECTION, studentId: 'abc', numericScore: 50 }],
    ['PUT', '/gradebook/entries', { sectionId: 'sec-1', studentId: STUDENT, numericScore: 50 }],
    ['POST', '/gradebook/entries/bulk-transition', { ids: [BAD], action: 'submit' }],
    ['POST', '/gradebook/gpa/compute', { studentId: BAD }],
    ['POST', '/gradebook/gpa/compute', { studentId: STUDENT, gradingScaleId: BAD }],
    ['POST', '/gradebook/rank/compute', { sectionId: BAD }],
    ['POST', '/gradebook/report-cards', { studentId: STUDENT, boardId: BAD }],
    ['POST', '/gradebook/transcripts/issue', { studentId: STUDENT, gpaSnapshotId: BAD }],
    ['POST', '/gradebook/credit-rules', { code: 'C', name: 'N', credits: 1, boardId: BAD }],
    ['POST', '/gradebook/comments-bank', { label: 'L', body: 'B', subjectId: BAD }],
    ['POST', '/gradebook/board-exports', { boardId: BAD, institutionId: SECTION }],
    ['POST', '/gradebook/board-exports', { boardCode: 'CBSE', institutionId: BAD }],
    [
      'POST',
      '/gradebook/board-exports',
      { boardCode: 'CBSE', institutionId: SECTION, studentIds: [BAD] },
    ],
  ] as const)('%s %s with a non-UUID body id -> 400', async (method, url, payload) => {
    const upsert = vi.spyOn(repo, 'createGradeEntry');
    const listEntries = vi.spyOn(repo, 'listGradeEntries');
    expect400(await app.inject({ method, url, payload }));
    expect(upsert).not.toHaveBeenCalled();
    expect(listEntries).not.toHaveBeenCalled();
  });

  it('still accepts valid UUIDs (regression)', async () => {
    const entries = await app.inject({
      method: 'GET',
      url: `/gradebook/entries?sectionId=${SECTION}&studentId=${STUDENT}`,
    });
    expect(entries.statusCode).toBe(200);
    const blank = await app.inject({ method: 'GET', url: '/gradebook/entries?studentId=' });
    expect(blank.statusCode).toBe(200);
    const missing = await app.inject({
      method: 'GET',
      url: '/gradebook/transcripts/55555555-5555-4555-8555-555555555555',
    });
    expect(missing.statusCode).toBe(404);
  });
});
