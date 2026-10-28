/**
 * PRC-L139 — GET /registrations/language must not mint or persist a session.
 *
 * Before the fix every anonymous GET without a valid session wrote a new session record
 * (unauthenticated write amplification against Redis).
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { RegistrationService } from './registration-service.js';
import {
  registerRegistrationRoutes,
  type RegistrationSessionRecord,
  type RegistrationSessionStore,
} from './routes.js';

class CountingSessionStore implements RegistrationSessionStore {
  readonly rows = new Map<string, RegistrationSessionRecord>();
  writes = 0;
  async get(sessionId: string): Promise<RegistrationSessionRecord | null> {
    return this.rows.get(sessionId) ?? null;
  }
  async set(sessionId: string, record: RegistrationSessionRecord): Promise<void> {
    this.writes += 1;
    this.rows.set(sessionId, record);
  }
}

describe('PRC-L139: GET /registrations/language is read-only', () => {
  let app: FastifyInstance;
  let store: CountingSessionStore;

  beforeEach(async () => {
    store = new CountingSessionStore();
    app = Fastify();
    await registerRegistrationRoutes(app, {
      registrationService: new RegistrationService(new InMemoryRegistrationRepository()),
      defaultTenantId: '550e8400-e29b-41d4-a716-446655440000',
      sessionStore: store,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('a GET without a session writes nothing and issues no session id', async () => {
    for (let i = 0; i < 25; i += 1) {
      const response = await app.inject({ method: 'GET', url: '/registrations/language' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ language: 'en' });
      expect(response.headers['x-session-id']).toBeUndefined();
    }
    expect(store.writes).toBe(0);
    expect(store.rows.size).toBe(0);
  });

  it('a GET with a forged (unknown) session id writes nothing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/registrations/language',
      headers: { 'x-session-id': 'a'.repeat(32) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-session-id']).toBeUndefined();
    expect(store.writes).toBe(0);
  });

  it('a GET with a valid bound session returns its language without writing', async () => {
    const set = await app.inject({
      method: 'POST',
      url: '/registrations/language',
      headers: { 'user-agent': 'agent-a' },
      payload: { language: 'fr' },
    });
    const { sessionId } = set.json() as { sessionId: string };
    const writesAfterPost = store.writes;
    const get = await app.inject({
      method: 'GET',
      url: '/registrations/language',
      headers: { 'user-agent': 'agent-a', 'x-session-id': sessionId },
    });
    expect(get.json()).toEqual({ language: 'fr', sessionId });
    expect(get.headers['x-session-id']).toBe(sessionId);
    expect(store.writes).toBe(writesAfterPost);
  });
});
