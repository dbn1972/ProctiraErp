import { ConflictError, NotFoundError } from '@proctira/common';
import type { Board, PrismaClient } from '@proctira/database';

import type { CreateBoardDto, UpdateBoardDto } from './board-schemas.js';

export interface BoardServiceDeps {
  prisma: PrismaClient;
}

export class BoardService {
  private readonly prisma: PrismaClient;

  constructor(deps: BoardServiceDeps) {
    this.prisma = deps.prisma;
  }

  async create(tenantId: string, dto: CreateBoardDto): Promise<Board> {
    const existing = await this.prisma.board.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictError(`Board with code '${dto.code}' already exists`);
    }
    if (existing?.deletedAt) {
      return this.prisma.board.update({
        where: { id: existing.id },
        data: {
          name: dto.name,
          type: dto.type,
          status: dto.status ?? 'active',
          deletedAt: null,
        },
      });
    }

    return this.prisma.board.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
        type: dto.type,
        status: dto.status ?? 'active',
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateBoardDto): Promise<Board> {
    const board = await this.prisma.board.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!board) {
      throw new NotFoundError(`Board '${id}' not found`);
    }

    if (dto.code && dto.code !== board.code) {
      const existing = await this.prisma.board.findUnique({
        where: { tenantId_code: { tenantId, code: dto.code } },
      });
      if (existing && existing.id !== id && !existing.deletedAt) {
        throw new ConflictError(`Board with code '${dto.code}' already exists`);
      }
    }

    return this.prisma.board.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  async getById(tenantId: string, id: string): Promise<Board> {
    const board = await this.prisma.board.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!board) {
      throw new NotFoundError(`Board '${id}' not found`);
    }
    return board;
  }

  async list(tenantId: string): Promise<Board[]> {
    return this.prisma.board.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { code: 'asc' },
    });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const board = await this.prisma.board.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!board) {
      throw new NotFoundError(`Board '${id}' not found`);
    }
    await this.prisma.board.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
