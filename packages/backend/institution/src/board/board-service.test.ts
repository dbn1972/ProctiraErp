import { ConflictError, NotFoundError } from '@proctira/common';
import { describe, expect, it, vi } from 'vitest';

import { BoardService } from './board-service.js';

function createMockPrisma() {
  return {
    board: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
}

const TENANT_ID = 'tenant-001';

describe('BoardService', () => {
  it('creates a CBSE national board', async () => {
    const prisma = createMockPrisma();
    prisma.board.findUnique.mockResolvedValue(null);
    const created = {
      id: 'board-1',
      tenantId: TENANT_ID,
      name: 'Central Board of Secondary Education',
      code: 'CBSE',
      type: 'NATIONAL',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    prisma.board.create.mockResolvedValue(created);
    const service = new BoardService({ prisma: prisma as never });

    const result = await service.create(TENANT_ID, {
      name: created.name,
      code: 'CBSE',
      type: 'NATIONAL',
    });

    expect(result.code).toBe('CBSE');
    expect(prisma.board.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT_ID,
        name: created.name,
        code: 'CBSE',
        type: 'NATIONAL',
        status: 'active',
      },
    });
  });

  it('rejects a duplicate active board code', async () => {
    const prisma = createMockPrisma();
    prisma.board.findUnique.mockResolvedValue({ id: 'existing', deletedAt: null });
    const service = new BoardService({ prisma: prisma as never });

    await expect(
      service.create(TENANT_ID, { name: 'CBSE', code: 'CBSE', type: 'NATIONAL' }),
    ).rejects.toThrow(ConflictError);
  });

  it('lists only live boards', async () => {
    const prisma = createMockPrisma();
    prisma.board.findMany.mockResolvedValue([]);
    const service = new BoardService({ prisma: prisma as never });

    await service.list(TENANT_ID);

    expect(prisma.board.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, deletedAt: null },
      orderBy: { code: 'asc' },
    });
  });

  it('throws when a board is missing', async () => {
    const prisma = createMockPrisma();
    prisma.board.findFirst.mockResolvedValue(null);
    const service = new BoardService({ prisma: prisma as never });

    await expect(service.getById(TENANT_ID, 'missing')).rejects.toThrow(NotFoundError);
  });
});
