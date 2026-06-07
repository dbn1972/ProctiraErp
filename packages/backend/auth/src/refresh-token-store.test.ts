/**
 * Unit tests for PrismaRefreshTokenStore.
 * Uses a mocked PrismaClient to verify store operations.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaRefreshTokenStore } from './refresh-token-store.js';

// Mock PrismaClient
function createMockPrismaClient() {
  const tokens: Map<string, Record<string, unknown>> = new Map();

  return {
    refreshToken: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = {
          id: `rt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          ...data,
          createdAt: new Date(),
        };
        tokens.set(data['token'] as string, record);
        return record;
      }),
      findUnique: vi.fn(async ({ where }: { where: { token: string } }) => {
        return tokens.get(where.token) ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { token: string }; data: Record<string, unknown> }) => {
        const existing = tokens.get(where.token);
        if (existing) {
          Object.assign(existing, data);
        }
        return existing;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const [, token] of tokens) {
          let matches = true;
          for (const [key, value] of Object.entries(where)) {
            if (token[key] !== value) {
              matches = false;
              break;
            }
          }
          if (matches) {
            Object.assign(token, data);
            count++;
          }
        }
        return { count };
      }),
    },
    _tokens: tokens,
  };
}

describe('PrismaRefreshTokenStore', () => {
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let store: PrismaRefreshTokenStore;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new PrismaRefreshTokenStore(mockPrisma as any);
  });

  describe('create', () => {
    it('should create a refresh token record', async () => {
      const input = {
        token: 'test-token-123',
        userId: 'user-1',
        tenantId: 'tenant-1',
        sessionId: 'session-1',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        revoked: false,
        createdByIp: '192.168.1.1',
      };

      const result = await store.create(input);

      expect(result.id).toBeDefined();
      expect(result.token).toBe('test-token-123');
      expect(result.userId).toBe('user-1');
      expect(result.tenantId).toBe('tenant-1');
      expect(result.sessionId).toBe('session-1');
      expect(result.revoked).toBe(false);
      expect(result.createdByIp).toBe('192.168.1.1');
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should call prisma.refreshToken.create with correct data', async () => {
      const expiresAt = new Date(Date.now() + 1000000);
      await store.create({
        token: 'token-abc',
        userId: 'user-2',
        tenantId: 'tenant-2',
        sessionId: 'session-2',
        expiresAt,
        revoked: false,
      });

      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          token: 'token-abc',
          userId: 'user-2',
          tenantId: 'tenant-2',
          sessionId: 'session-2',
          expiresAt,
          revoked: false,
          createdByIp: null,
        }),
      });
    });
  });

  describe('findByToken', () => {
    it('should return a token when found', async () => {
      await store.create({
        token: 'find-me-token',
        userId: 'user-1',
        tenantId: 'tenant-1',
        sessionId: 'session-1',
        expiresAt: new Date(Date.now() + 1000000),
        revoked: false,
      });

      const result = await store.findByToken('find-me-token');

      expect(result).not.toBeNull();
      expect(result!.token).toBe('find-me-token');
      expect(result!.userId).toBe('user-1');
    });

    it('should return null when token not found', async () => {
      const result = await store.findByToken('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('revoke', () => {
    it('should revoke a token with reason', async () => {
      await store.create({
        token: 'revoke-me',
        userId: 'user-1',
        tenantId: 'tenant-1',
        sessionId: 'session-1',
        expiresAt: new Date(Date.now() + 1000000),
        revoked: false,
      });

      await store.revoke('revoke-me', 'Token rotation');

      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith({
        where: { token: 'revoke-me' },
        data: expect.objectContaining({
          revoked: true,
          revokedReason: 'Token rotation',
          replacedByToken: null,
        }),
      });
    });

    it('should revoke a token with replacement token', async () => {
      await store.create({
        token: 'old-token',
        userId: 'user-1',
        tenantId: 'tenant-1',
        sessionId: 'session-1',
        expiresAt: new Date(Date.now() + 1000000),
        revoked: false,
      });

      await store.revoke('old-token', 'Rotated', 'new-token');

      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith({
        where: { token: 'old-token' },
        data: expect.objectContaining({
          revoked: true,
          revokedReason: 'Rotated',
          replacedByToken: 'new-token',
        }),
      });
    });
  });

  describe('revokeAllForSession', () => {
    it('should revoke all tokens for a session', async () => {
      await store.revokeAllForSession('session-1', 'Logout');

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          sessionId: 'session-1',
          revoked: false,
        },
        data: expect.objectContaining({
          revoked: true,
          revokedReason: 'Logout',
        }),
      });
    });
  });

  describe('revokeAllForUser', () => {
    it('should revoke all tokens for a user in a tenant', async () => {
      await store.revokeAllForUser('user-1', 'tenant-1', 'Security reset');

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          tenantId: 'tenant-1',
          revoked: false,
        },
        data: expect.objectContaining({
          revoked: true,
          revokedReason: 'Security reset',
        }),
      });
    });
  });
});
