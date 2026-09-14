/**
 * W1-SEC-05 — registration session store factory + replica survival.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  createRegistrationSessionStore,
  RedisRegistrationSessionStore,
  type RedisLikeForRegistrationSession,
} from './create-registration-session-store.js';
import { InMemorySessionStore, type RegistrationSessionRecord } from './routes.js';

function createSharedMockRedis(): RedisLikeForRegistrationSession & {
  data: Map<string, { value: string; exp: number }>;
} {
  const data = new Map<string, { value: string; exp: number }>();
  return {
    data,
    async get(key: string) {
      const entry = data.get(key);
      if (!entry) return null;
      if (entry.exp <= Date.now()) {
        data.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key: string, value: string, ...args: Array<string | number>) {
      let ttlSeconds = 60;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === 'EX' && typeof args[i + 1] === 'number') {
          ttlSeconds = args[i + 1] as number;
        }
      }
      data.set(key, { value, exp: Date.now() + ttlSeconds * 1000 });
      return 'OK';
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const key of keys) {
        if (data.delete(key)) n += 1;
      }
      return n;
    },
  };
}

function sampleRecord(overrides?: Partial<RegistrationSessionRecord>): RegistrationSessionRecord {
  return {
    data: { language: 'ar' },
    clientBinding: 'binding-hash',
    expiresAtMs: Date.now() + 60_000,
    ...overrides,
  };
}

describe('createRegistrationSessionStore (W1-SEC-05)', () => {
  const prev = {
    NODE_ENV: process.env['NODE_ENV'],
    DATABASE_URL: process.env['DATABASE_URL'],
    REDIS_URL: process.env['REDIS_URL'],
    REQUIRE_DATABASE: process.env['REQUIRE_DATABASE'],
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('prefers an injected Redis client', () => {
    const redis = createSharedMockRedis();
    const store = createRegistrationSessionStore({
      redis,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x',
    });
    expect(store).toBeInstanceOf(RedisRegistrationSessionStore);
  });

  it('uses REDIS_URL when redis is not injected', () => {
    const store = createRegistrationSessionStore({
      REDIS_URL: 'redis://127.0.0.1:6379',
      NODE_ENV: 'test',
      DATABASE_URL: undefined,
    });
    expect(store).toBeInstanceOf(RedisRegistrationSessionStore);
  });

  it('falls back to in-memory when REDIS_URL unset (assertInMemoryFallbackAllowed)', () => {
    delete process.env['DATABASE_URL'];
    delete process.env['REDIS_URL'];
    delete process.env['REQUIRE_DATABASE'];
    process.env['NODE_ENV'] = 'test';
    const store = createRegistrationSessionStore({
      NODE_ENV: 'test',
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
    });
    expect(store).toBeInstanceOf(InMemorySessionStore);
  });

  it('refuses in-memory in production without a durable backend', () => {
    expect(() =>
      createRegistrationSessionStore({
        NODE_ENV: 'production',
        DATABASE_URL: undefined,
        REDIS_URL: undefined,
      }),
    ).toThrow(/registration-session|NODE_ENV=production|W1-SEC-12/);
  });

  it('allows in-memory in non-production even when DATABASE_URL is set (sessions are Redis, not PG)', () => {
    const store = createRegistrationSessionStore({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://localhost/proctira',
      REDIS_URL: undefined,
    });
    expect(store).toBeInstanceOf(InMemorySessionStore);
  });

  it('refuses in-memory when REQUIRE_DATABASE is set without Redis', () => {
    expect(() =>
      createRegistrationSessionStore({
        NODE_ENV: 'test',
        DATABASE_URL: undefined,
        REDIS_URL: undefined,
        REQUIRE_DATABASE: '1',
      }),
    ).toThrow(/REQUIRE_DATABASE/);
  });
});

describe('RedisRegistrationSessionStore replica / restart survival (W1-SEC-05)', () => {
  it('serializes to the shared store so a new store instance reads the same key', async () => {
    const redis = createSharedMockRedis();
    const writer = new RedisRegistrationSessionStore(redis);
    const reader = new RedisRegistrationSessionStore(redis);

    const sessionId = 'a'.repeat(32);
    const record = sampleRecord({ data: { language: 'fr' } });
    await writer.set(sessionId, record);

    // Simulate restart / second replica: brand-new store instance, same Redis.
    const revived = await reader.get(sessionId);
    expect(revived).toEqual(record);
    expect(redis.data.has(`registration:session:${sessionId}`)).toBe(true);
  });

  it('returns null for expired records and deletes the key', async () => {
    const redis = createSharedMockRedis();
    const store = new RedisRegistrationSessionStore(redis);
    const sessionId = 'b'.repeat(32);
    const key = `registration:session:${sessionId}`;
    // Keep Redis TTL alive but mark payload expired (payload-level expiry).
    redis.data.set(key, {
      value: JSON.stringify(sampleRecord({ expiresAtMs: Date.now() - 1 })),
      exp: Date.now() + 60_000,
    });

    expect(await store.get(sessionId)).toBeNull();
    expect(redis.data.has(key)).toBe(false);
  });

  it('in-memory store does not survive a new process-local instance', async () => {
    const first = new InMemorySessionStore();
    const sessionId = 'c'.repeat(32);
    await first.set(sessionId, sampleRecord());
    const second = new InMemorySessionStore();
    expect(await second.get(sessionId)).toBeNull();
  });
});
