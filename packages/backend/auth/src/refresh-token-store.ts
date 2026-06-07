/**
 * PostgreSQL implementation of RefreshTokenStore using Prisma.
 *
 * Stores refresh tokens with revocation tracking for token rotation.
 * All operations are tenant-scoped via the stored tenantId.
 */
import type { RefreshToken } from '@proctira/auth';
import type { PrismaClient } from '@prisma/client';

import type { RefreshTokenStore } from './token-service.js';

/**
 * Prisma-based refresh token store for PostgreSQL persistence.
 */
export class PrismaRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: Omit<RefreshToken, 'id' | 'createdAt'>,
  ): Promise<RefreshToken> {
    const record = await this.prisma.refreshToken.create({
      data: {
        token: input.token,
        userId: input.userId,
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        expiresAt: input.expiresAt,
        revoked: input.revoked,
        revokedAt: input.revokedAt ?? null,
        revokedReason: input.revokedReason ?? null,
        replacedByToken: input.replacedByToken ?? null,
        createdByIp: input.createdByIp ?? null,
      },
    });

    return this.mapToRefreshToken(record);
  }

  async findByToken(token: string): Promise<RefreshToken | null> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { token },
    });

    if (!record) return null;
    return this.mapToRefreshToken(record);
  }

  async revoke(
    token: string,
    reason: string,
    replacedByToken?: string,
  ): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { token },
      data: {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: reason,
        replacedByToken: replacedByToken ?? null,
      },
    });
  }

  async revokeAllForSession(sessionId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        sessionId,
        revoked: false,
      },
      data: {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });
  }

  async revokeAllForUser(
    userId: string,
    tenantId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        tenantId,
        revoked: false,
      },
      data: {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });
  }

  /**
   * Map a Prisma record to the RefreshToken interface.
   */
  private mapToRefreshToken(record: {
    id: string;
    token: string;
    userId: string;
    tenantId: string;
    sessionId: string;
    expiresAt: Date;
    revoked: boolean;
    revokedAt: Date | null;
    revokedReason: string | null;
    replacedByToken: string | null;
    createdByIp: string | null;
    createdAt: Date;
  }): RefreshToken {
    return {
      id: record.id,
      token: record.token,
      userId: record.userId,
      tenantId: record.tenantId,
      sessionId: record.sessionId,
      expiresAt: record.expiresAt,
      revoked: record.revoked,
      revokedAt: record.revokedAt ?? undefined,
      revokedReason: record.revokedReason ?? undefined,
      replacedByToken: record.replacedByToken ?? undefined,
      createdByIp: record.createdByIp ?? undefined,
      createdAt: record.createdAt,
    };
  }
}
