/**
 * PRC-M266: gradebook audit events reach the durable sink (survive a service restart).
 */
import { describe, expect, it } from 'vitest';

import { GradebookService, type GradebookAuditEntry } from './gradebook-service.js';
import { BOARD, SECTION, STUDENT, TENANT, setupGradebook } from './gradebook-test-setup.js';

describe('PRC-M266 durable gradebook audit', () => {
  it('transcript issue + download are written to the sink with actor and survive restart', async () => {
    const durable: GradebookAuditEntry[] = [];
    const { repo } = setupGradebook();
    const service = new GradebookService(repo, undefined, {
      auditSink: async (e) => {
        durable.push(e);
      },
    });
    await service.upsertGradeEntry(TENANT, {
      sectionId: SECTION,
      studentId: STUDENT,
      assessmentCode: 'MATH',
      numericScore: 95,
    });
    await service.computeGpa(TENANT, { studentId: STUDENT, boardId: BOARD });
    const t = await service.issueTranscript(TENANT, { studentId: STUDENT }, { sub: 'registrar-1' });
    await service.downloadTranscript(TENANT, t.id, 'pdf', { actorId: 'registrar-2' });

    // "restart": a fresh service has no in-process log, the durable rows remain.
    const restarted = new GradebookService(repo);
    expect(restarted.listAudits(TENANT)).toHaveLength(0);
    const issue = durable.find((e) => e.action === 'transcript.issue');
    expect(issue?.entityId).toBe(t.id);
    const download = durable.find((e) => e.action === 'transcript.download');
    expect(download?.actorId).toBe('registrar-2');
    expect(download?.details.format).toBe('pdf');
  });

  it('a failing durable sink surfaces instead of being silently dropped', async () => {
    const { repo } = setupGradebook();
    const service = new GradebookService(repo, undefined, {
      auditSink: async () => {
        throw new Error('audit store down');
      },
    });
    await expect(
      service.createCreditRule(TENANT, { code: 'X', name: 'X', credits: 1, boardId: BOARD }),
    ).resolves.toBeTruthy(); // credit rules are not audited
    await expect(
      service.upsertGradeEntry(TENANT, {
        sectionId: SECTION,
        studentId: STUDENT,
        assessmentCode: 'ENG',
        numericScore: 50,
      }),
    ).rejects.toThrow('audit store down');
  });
});
