/**
 * PRC-L469 — the in-memory result repository must honour tenantId like RLS
 * does on the Prisma repository: cross-tenant reads return nothing.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import type { PublicationResult, ResultAnalysis } from './result-repository.js';

const EXAM = 'exam-shared-id';

describe('InMemoryResultRepository tenant isolation (PRC-L469)', () => {
  it('cross-tenant publication read returns null', async () => {
    const repo = new InMemoryResultRepository();
    await repo.savePublicationResult({
      examinationId: EXAM,
      tenantId: 'tenant-a',
    } as PublicationResult);
    expect(await repo.getPublicationResult(EXAM, 'tenant-a')).not.toBeNull();
    expect(await repo.getPublicationResult(EXAM, 'tenant-b')).toBeNull();
  });

  it('cross-tenant analysis read returns null', async () => {
    const repo = new InMemoryResultRepository();
    await repo.saveResultAnalysis({ examinationId: EXAM, tenantId: 'tenant-a' } as ResultAnalysis);
    expect(await repo.getResultAnalysis(EXAM, 'tenant-b')).toBeNull();
  });

  it('candidates are scoped per tenant', async () => {
    const repo = new InMemoryResultRepository();
    await repo.upsertCandidates('tenant-a', [
      { id: 'c1', examinationId: EXAM, studentId: 's1', subjectResults: [] } as never,
    ]);
    expect(await repo.getCandidates(EXAM, 'tenant-a')).toHaveLength(1);
    expect(await repo.getCandidates(EXAM, 'tenant-b')).toEqual([]);
  });
});
