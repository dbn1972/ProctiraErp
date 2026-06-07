/**
 * Session Service - Session creation, validation, and invalidation.
 *
 * Sessions track active user sessions with device info and last activity.
 * Sessions are valid across all platform modules for a configurable duration (1h–24h, default 8h).
 * All sessions are tenant-scoped.
 */
import type { Session, AuthConfig } from '@proctira/auth';
import { v4 as uuidv4 } from 'uuid';

/**
 * Interface for session storage (PostgreSQL).
 */
export interface SessionStore {
  /** Create a new session */
  create(session: Session): Promise<Session>;
  /** Find a session by ID */
  findById(sessionId: string): Promise<Session | null>;
  /** Update session last activity */
  updateLastActivity(sessionId: string, timestamp: Date): Promise<void>;
  /** Invalidate a session */
  invalidate(sessionId: string): Promise<void>;
  /** Invalidate all sessions for a user in a tenant */
  invalidateAllForUser(userId: string, tenantId: string): Promise<void>;
  /** Find all active sessions for a user in a tenant */
  findActiveByUser(userId: string, tenantId: string): Promise<Session[]>;
}

/**
 * Session Service manages user sessions across the platform.
 */
export class SessionService {
  constructor(
    private readonly config: AuthConfig,
    private readonly sessionStore: SessionStore,
  ) {}

  /**
   * Create a new session for an authenticated user.
   */
  async createSession(
    userId: string,
    tenantId: string,
    options?: {
      userAgent?: string;
      ipAddress?: string;
    },
  ): Promise<Session> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.session.duration * 1000);

    const session: Session = {
      id: uuidv4(),
      userId,
      tenantId,
      createdAt: now,
      expiresAt,
      lastActivityAt: now,
      isActive: true,
      userAgent: options?.userAgent,
      ipAddress: options?.ipAddress,
    };

    return this.sessionStore.create(session);
  }

  /**
   * Validate a session is still active and not expired.
   * Updates last activity timestamp on successful validation.
   */
  async validateSession(sessionId: string): Promise<Session | null> {
    const session = await this.sessionStore.findById(sessionId);

    if (!session) {
      return null;
    }

    if (!session.isActive) {
      return null;
    }

    if (session.expiresAt < new Date()) {
      // Session expired - invalidate it
      await this.sessionStore.invalidate(sessionId);
      return null;
    }

    // Update last activity
    const now = new Date();
    await this.sessionStore.updateLastActivity(sessionId, now);

    return {
      ...session,
      lastActivityAt: now,
    };
  }

  /**
   * Invalidate a session (e.g., on logout).
   */
  async invalidateSession(sessionId: string): Promise<void> {
    await this.sessionStore.invalidate(sessionId);
  }

  /**
   * Invalidate all sessions for a user in a tenant.
   */
  async invalidateAllUserSessions(userId: string, tenantId: string): Promise<void> {
    await this.sessionStore.invalidateAllForUser(userId, tenantId);
  }

  /**
   * Get all active sessions for a user.
   */
  async getActiveSessions(userId: string, tenantId: string): Promise<Session[]> {
    return this.sessionStore.findActiveByUser(userId, tenantId);
  }
}
