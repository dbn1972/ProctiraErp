/**
 * PostgreSQL implementation of SessionStore using Prisma.
 *
 * Stores user sessions with activity tracking and invalidation support.
 * Sessions are valid across all platform modules for a configurable duration.
 */
import type { Session } from '@proctira/auth';
import type { PrismaClient } from '@prisma/client';

import type { SessionStore } from './session-service.js';

/**
 * Prisma-based session store for PostgreSQL persistence.
 */
export class PrismaSessionStore implements SessionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(session: Session): Promise<Session> {
    const record = await this.prisma.userSession.create({
      data: {
        id: session.id,
        userId: session.userId,
        tenantId: session.tenantId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        lastActivityAt: session.lastActivityAt,
        isActive: session.isActive,
        userAgent: session.userAgent ?? null,
        ipAddress: session.ipAddress ?? null,
        invalidatedAt: session.invalidatedAt ?? null,
      },
    });

    return this.mapToSession(record);
  }

  async findById(sessionId: string): Promise<Session | null> {
    const record = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
    });

    if (!record) return null;
    return this.mapToSession(record);
  }

  async updateLastActivity(sessionId: string, timestamp: Date): Promise<void> {
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { lastActivityAt: timestamp },
    });
  }

  async invalidate(sessionId: string): Promise<void> {
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: {
        isActive: false,
        invalidatedAt: new Date(),
      },
    });
  }

  async invalidateAllForUser(userId: string, tenantId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: {
        userId,
        tenantId,
        isActive: true,
      },
      data: {
        isActive: false,
        invalidatedAt: new Date(),
      },
    });
  }

  async findActiveByUser(userId: string, tenantId: string): Promise<Session[]> {
    const records = await this.prisma.userSession.findMany({
      where: {
        userId,
        tenantId,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return records.map((record: {
      id: string;
      userId: string;
      tenantId: string;
      createdAt: Date;
      expiresAt: Date;
      lastActivityAt: Date;
      isActive: boolean;
      userAgent: string | null;
      ipAddress: string | null;
      invalidatedAt: Date | null;
    }) => this.mapToSession(record));
  }

  /**
   * Map a Prisma record to the Session interface.
   */
  private mapToSession(record: {
    id: string;
    userId: string;
    tenantId: string;
    createdAt: Date;
    expiresAt: Date;
    lastActivityAt: Date;
    isActive: boolean;
    userAgent: string | null;
    ipAddress: string | null;
    invalidatedAt: Date | null;
  }): Session {
    return {
      id: record.id,
      userId: record.userId,
      tenantId: record.tenantId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      lastActivityAt: record.lastActivityAt,
      isActive: record.isActive,
      userAgent: record.userAgent ?? undefined,
      ipAddress: record.ipAddress ?? undefined,
      invalidatedAt: record.invalidatedAt ?? undefined,
    };
  }
}
