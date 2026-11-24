/**
 * PR B1 (FKB-015): createCreditRule resolves `boardId` inside the caller's tenant,
 * so another tenant's board and an unknown id give the same NotFoundError.
 */
import { NotFoundError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { GradebookService } from './gradebook-service.js';
import { InMemoryGradebookRepository } from './in-memory-repository.js';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';
const TENANT_B = '11111111-1111-4111-8111-1111111111bb';
const BOARD_A = '22222222-2222-4222-8222-2222222222aa';
const BOARD_B = '22222222-2222-4222-8222-2222222222bb';
const UNKNOWN = '22222222-2222-4222-8222-222222222299';

function setup() {
  const repo = new InMemoryGradebookRepository();
  repo.seedBoard({ id: BOARD_A, tenantId: TENANT_A, code: 'CBSE', name: 'CBSE' });
  repo.seedBoard({ id: BOARD_B, tenantId: TENANT_B, code: 'ICSE', name: 'ICSE' });
  return { repo, service: new GradebookService(repo) };
}

describe('FKB-015 credit rule board tenancy', () => {
  it('accepts the caller tenant board and a board-less rule', async () => {
    const { service } = setup();
    const own = await service.createCreditRule(TENANT_A, {
      code: 'MATH',
      name: 'Maths',
      credits: 4,
      boardId: BOARD_A,
    });
    expect(own.boardId).toBe(BOARD_A);
    const none = await service.createCreditRule(TENANT_A, {
      code: 'ART',
      name: 'Art',
      credits: 1,
      boardId: null,
    });
    expect(none.boardId).toBeNull();
  });

  it.each([
    ['another tenant board', BOARD_B],
    ['an unknown board', UNKNOWN],
  ])('rejects %s with the same NotFoundError and writes nothing', async (_label, boardId) => {
    const { repo, service } = setup();
    const attempt = service.createCreditRule(TENANT_A, {
      code: 'SCI',
      name: 'Science',
      credits: 2,
      boardId,
    });
    await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
    await expect(attempt).rejects.toThrow(`Board with id '${boardId}' not found`);
    expect(await repo.listCreditRules(TENANT_A)).toEqual([]);
  });
});
