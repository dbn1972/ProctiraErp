/**
 * PostgreSQL implementation of RefreshTokenStore using Prisma.
 *
 * Stores refresh tokens with revocation tracking for token rotation.
 * All operations are tenant-scoped via the stored tenantId.
 */
import { createHash } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import type { RefreshToken } from '@proctira/auth';

import type { RefreshTokenStore } from './token-service.js';

/**
 * Hash a refresh token value for at-rest storage and lookup (PRC-M585).
 * Refresh tokens are high-entropy opaque UUIDs, so a fast SHA-256 (no salt)
 * is sufficient to make a database disclosure non-replayable while keeping
 * lookups a single indexed equality match.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Prisma-based refresh token store for PostgreSQL persistence.
 *
 * Tokens are never persisted or queried in plaintext: the raw value lives only
 * in the caller's possession, and the store keeps SHA-256(token) in the `token`
 * column (PRC-M585). Rotation/revocation uses a conditional updateMany so two
 * concurrent refreshes cannot both win (PRC-L444).
 */
export class PrismaRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: Omit<RefreshToken, 'id' | 'createdAt'>): Promise<RefreshToken> {
    const record = await this.prisma.refreshToken.create({
      data: {
        token: hashRefreshToken(input.token),
        userId: input.userId,
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        expiresAt: input.expiresAt,
        revoked: input.revoked,
        revokedAt: input.revokedAt ?? null,
        revokedReason: input.revokedReason ?? null,
        replacedByToken: input.replacedByToken ? hashRefreshToken(input.replacedByToken) : null,
        createdByIp: input.createdByIp ?? null,
      },
    });

    // Return the raw token to the caller (the stored value is the hash).
    return { ...this.mapToRefreshToken(record), token: input.token };
  }

  async findByToken(token: string): Promise<RefreshToken | null> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { token: hashRefreshToken(token) },
    });

    if (!record) return null;
    return this.mapToRefreshToken(record);
  }

  async revoke(token: string, reason: string, replacedByToken?: string): Promise<void> {
    // PRC-L444: compare-and-set — only an active (not-yet-revoked) row may be
    // revoked, so concurrent rotations cannot both succeed (token fork).
    const result = await this.prisma.refreshToken.updateMany({
      where: { token: hashRefreshToken(token), revoked: false },
      data: {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: reason,
        replacedByToken: replacedByToken ? hashRefreshToken(replacedByToken) : null,
      },
    });
    if (result.count !== 1) {
      throw new RefreshTokenRotationConflictError(
        'Refresh token already revoked (concurrent rotation)',
      );
    }
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

  async revokeAllForUser(userId: string, tenantId: string, reason: string): Promise<void> {
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
   * Note: `token`/`replacedByToken` are hashes at rest; callers that need the
   * raw rotated value receive it directly from create().
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

/**
 * Thrown when a conditional (compare-and-set) revoke affects zero rows, meaning
 * the token was already revoked/rotated by a concurrent request (PRC-L444).
 */
export class RefreshTokenRotationConflictError extends Error {
  public readonly code = 'REFRESH_TOKEN_ROTATION_CONFLICT';
  public readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'RefreshTokenRotationConflictError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
