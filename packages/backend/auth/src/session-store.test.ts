/**
 * Unit tests for PrismaSessionStore.
 * Uses a mocked PrismaClient to verify store operations.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaSessionStore } from './session-store.js';

// Mock PrismaClient
function createMockPrismaClient() {
  const sessions: Map<string, Record<string, unknown>> = new Map();

  return {
    userSession: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sessions.set(data['id'] as string, { ...data });
        return { ...data };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return sessions.get(where.id) ?? null;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = sessions.get(where.id);
          if (existing) {
            Object.assign(existing, data);
          }
          return existing;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const [, session] of sessions) {
            let matches = true;
            for (const [key, value] of Object.entries(where)) {
              if (session[key] !== value) {
                matches = false;
                break;
              }
            }
            if (matches) {
              Object.assign(session, data);
              count++;
            }
          }
          return { count };
        },
      ),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const results: Record<string, unknown>[] = [];
        for (const [, session] of sessions) {
          let matches = true;
          for (const [key, value] of Object.entries(where)) {
            if (session[key] !== value) {
              matches = false;
              break;
            }
          }
          if (matches) {
            results.push(session);
          }
        }
        return results;
      }),
    },
    _sessions: sessions,
  };
}

describe('PrismaSessionStore', () => {
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let store: PrismaSessionStore;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new PrismaSessionStore(mockPrisma as any);
  });

  describe('create', () => {
    it('should create a session record', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000);

      const session = {
        id: 'session-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        createdAt: now,
        expiresAt,
        lastActivityAt: now,
        isActive: true,
        userAgent: 'Mozilla/5.0',
        ipAddress: '192.168.1.1',
      };

      const result = await store.create(session);

      expect(result.id).toBe('session-1');
      expect(result.userId).toBe('user-1');
      expect(result.tenantId).toBe('tenant-1');
      expect(result.isActive).toBe(true);
      expect(result.userAgent).toBe('Mozilla/5.0');
      expect(result.ipAddress).toBe('192.168.1.1');
    });

    it('should call prisma.userSession.create with correct data', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000);

      await store.create({
        id: 'session-2',
        userId: 'user-2',
        tenantId: 'tenant-2',
        createdAt: now,
        expiresAt,
        lastActivityAt: now,
        isActive: true,
      });

      expect(mockPrisma.userSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'session-2',
          userId: 'user-2',
          tenantId: 'tenant-2',
          isActive: true,
          userAgent: null,
          ipAddress: null,
        }),
      });
    });
  });

  describe('findById', () => {
    it('should return a session when found', async () => {
      const now = new Date();
      await store.create({
        id: 'find-session',
        userId: 'user-1',
        tenantId: 'tenant-1',
        createdAt: now,
        expiresAt: new Date(now.getTime() + 1000000),
        lastActivityAt: now,
        isActive: true,
      });

      const result = await store.findById('find-session');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('find-session');
      expect(result!.userId).toBe('user-1');
    });

    it('should return null when session not found', async () => {
      const result = await store.findById('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('updateLastActivity', () => {
    it('should update the last activity timestamp', async () => {
      const now = new Date();
      await store.create({
        id: 'activity-session',
        userId: 'user-1',
        tenantId: 'tenant-1',
        createdAt: now,
        expiresAt: new Date(now.getTime() + 1000000),
        lastActivityAt: now,
        isActive: true,
      });

      const newTimestamp = new Date(now.getTime() + 5000);
      await store.updateLastActivity('activity-session', newTimestamp);

      expect(mockPrisma.userSession.update).toHaveBeenCalledWith({
        where: { id: 'activity-session' },
        data: { lastActivityAt: newTimestamp },
      });
    });
  });

  describe('invalidate', () => {
    it('should invalidate a session', async () => {
      const now = new Date();
      await store.create({
        id: 'invalidate-session',
        userId: 'user-1',
        tenantId: 'tenant-1',
        createdAt: now,
        expiresAt: new Date(now.getTime() + 1000000),
        lastActivityAt: now,
        isActive: true,
      });

      await store.invalidate('invalidate-session');

      expect(mockPrisma.userSession.update).toHaveBeenCalledWith({
        where: { id: 'invalidate-session' },
        data: expect.objectContaining({
          isActive: false,
        }),
      });
    });
  });

  describe('invalidateAllForUser', () => {
    it('should invalidate all sessions for a user in a tenant', async () => {
      await store.invalidateAllForUser('user-1', 'tenant-1');

      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          tenantId: 'tenant-1',
          isActive: true,
        },
        data: expect.objectContaining({
          isActive: false,
        }),
      });
    });
  });

  describe('findActiveByUser', () => {
    it('should return active sessions for a user', async () => {
      const now = new Date();
      await store.create({
        id: 'active-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        createdAt: now,
        expiresAt: new Date(now.getTime() + 1000000),
        lastActivityAt: now,
        isActive: true,
      });
      await store.create({
        id: 'active-2',
        userId: 'user-1',
        tenantId: 'tenant-1',
        createdAt: now,
        expiresAt: new Date(now.getTime() + 1000000),
        lastActivityAt: now,
        isActive: true,
      });

      const results = await store.findActiveByUser('user-1', 'tenant-1');

      expect(results).toHaveLength(2);
      expect(results[0]!.userId).toBe('user-1');
    });
  });
});
