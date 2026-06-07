/**
 * Unit tests for SessionService - session lifecycle management.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionService } from './session-service.js';
import type { SessionStore } from './session-service.js';
import type { AuthConfig, Session } from '@proctira/auth';
import { createAuthConfig } from '@proctira/auth';

function createMockSessionStore(): SessionStore & { sessions: Map<string, Session> } {
  const sessions = new Map<string, Session>();

  return {
    sessions,
    create: vi.fn(async (session: Session) => {
      sessions.set(session.id, session);
      return session;
    }),
    findById: vi.fn(async (sessionId: string) => {
      return sessions.get(sessionId) ?? null;
    }),
    updateLastActivity: vi.fn(async (sessionId: string, timestamp: Date) => {
      const session = sessions.get(sessionId);
      if (session) {
        session.lastActivityAt = timestamp;
      }
    }),
    invalidate: vi.fn(async (sessionId: string) => {
      const session = sessions.get(sessionId);
      if (session) {
        session.isActive = false;
        session.invalidatedAt = new Date();
      }
    }),
    invalidateAllForUser: vi.fn(async (userId: string, tenantId: string) => {
      for (const [, session] of sessions) {
        if (session.userId === userId && session.tenantId === tenantId) {
          session.isActive = false;
          session.invalidatedAt = new Date();
        }
      }
    }),
    findActiveByUser: vi.fn(async (userId: string, tenantId: string) => {
      const result: Session[] = [];
      for (const [, session] of sessions) {
        if (session.userId === userId && session.tenantId === tenantId && session.isActive) {
          result.push(session);
        }
      }
      return result;
    }),
  };
}

describe('SessionService', () => {
  let config: AuthConfig;
  let sessionStore: ReturnType<typeof createMockSessionStore>;
  let sessionService: SessionService;

  beforeEach(() => {
    config = createAuthConfig({
      session: { duration: 28800 }, // 8 hours
    });
    sessionStore = createMockSessionStore();
    sessionService = new SessionService(config, sessionStore);
  });

  describe('createSession', () => {
    it('should create a new session with correct properties', async () => {
      const session = await sessionService.createSession('user-1', 'tenant-1', {
        userAgent: 'Mozilla/5.0',
        ipAddress: '192.168.1.1',
      });

      expect(session.id).toBeDefined();
      expect(session.userId).toBe('user-1');
      expect(session.tenantId).toBe('tenant-1');
      expect(session.isActive).toBe(true);
      expect(session.userAgent).toBe('Mozilla/5.0');
      expect(session.ipAddress).toBe('192.168.1.1');
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.lastActivityAt).toBeInstanceOf(Date);
    });

    it('should set expiration based on config duration', async () => {
      const before = Date.now();
      const session = await sessionService.createSession('user-1', 'tenant-1');
      const after = Date.now();

      const expectedExpiry = before + config.session.duration * 1000;
      const actualExpiry = session.expiresAt.getTime();

      // Allow tolerance for test execution time
      expect(actualExpiry).toBeGreaterThanOrEqual(expectedExpiry - 100);
      expect(actualExpiry).toBeLessThanOrEqual(after + config.session.duration * 1000 + 100);
    });

    it('should create session without optional fields', async () => {
      const session = await sessionService.createSession('user-1', 'tenant-1');

      expect(session.userAgent).toBeUndefined();
      expect(session.ipAddress).toBeUndefined();
    });
  });

  describe('validateSession', () => {
    it('should return session and update last activity for valid session', async () => {
      const session = await sessionService.createSession('user-1', 'tenant-1');

      // Wait a tiny bit to ensure lastActivityAt changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      const validated = await sessionService.validateSession(session.id);

      expect(validated).not.toBeNull();
      expect(validated!.id).toBe(session.id);
      expect(validated!.lastActivityAt.getTime()).toBeGreaterThanOrEqual(
        session.lastActivityAt.getTime(),
      );
    });

    it('should return null for non-existent session', async () => {
      const result = await sessionService.validateSession('non-existent');
      expect(result).toBeNull();
    });

    it('should return null for inactive session', async () => {
      const session = await sessionService.createSession('user-1', 'tenant-1');
      await sessionService.invalidateSession(session.id);

      const result = await sessionService.validateSession(session.id);
      expect(result).toBeNull();
    });

    it('should return null and invalidate expired session', async () => {
      const session = await sessionService.createSession('user-1', 'tenant-1');

      // Manually expire the session
      const stored = sessionStore.sessions.get(session.id);
      if (stored) {
        stored.expiresAt = new Date(Date.now() - 1000);
      }

      const result = await sessionService.validateSession(session.id);
      expect(result).toBeNull();
      expect(sessionStore.invalidate).toHaveBeenCalledWith(session.id);
    });
  });

  describe('invalidateSession', () => {
    it('should invalidate a session', async () => {
      const session = await sessionService.createSession('user-1', 'tenant-1');
      await sessionService.invalidateSession(session.id);

      const stored = sessionStore.sessions.get(session.id);
      expect(stored?.isActive).toBe(false);
      expect(stored?.invalidatedAt).toBeInstanceOf(Date);
    });
  });

  describe('invalidateAllUserSessions', () => {
    it('should invalidate all sessions for a user in a tenant', async () => {
      await sessionService.createSession('user-1', 'tenant-1');
      await sessionService.createSession('user-1', 'tenant-1');
      await sessionService.createSession('user-2', 'tenant-1'); // Different user

      await sessionService.invalidateAllUserSessions('user-1', 'tenant-1');

      expect(sessionStore.invalidateAllForUser).toHaveBeenCalledWith('user-1', 'tenant-1');
    });
  });

  describe('getActiveSessions', () => {
    it('should return active sessions for a user', async () => {
      await sessionService.createSession('user-1', 'tenant-1');
      await sessionService.createSession('user-1', 'tenant-1');

      const sessions = await sessionService.getActiveSessions('user-1', 'tenant-1');
      expect(sessions).toHaveLength(2);
    });

    it('should not return invalidated sessions', async () => {
      const session1 = await sessionService.createSession('user-1', 'tenant-1');
      await sessionService.createSession('user-1', 'tenant-1');
      await sessionService.invalidateSession(session1.id);

      const sessions = await sessionService.getActiveSessions('user-1', 'tenant-1');
      expect(sessions).toHaveLength(1);
    });
  });
});
