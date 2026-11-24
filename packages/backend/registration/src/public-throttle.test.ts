/**
 * PRC-M332 — anonymous status lookups are throttled per tracking number and
 * submit can require a bot-challenge token (fail closed without a verifier).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import {
  createPublicRegistrationThrottle,
  PublicRegistrationThrottle,
  type RedisLikeForThrottle,
  SlidingWindowLimiter,
} from './public-throttle.js';
import { RegistrationService } from './registration-service.js';
import { registerRegistrationRoutes, type RegistrationRoutesOptions } from './routes.js';

const TENANT = 'tenant-throttle';
const INSTITUTION = '12345678-1234-4123-8123-123456789abd';
const FORM = '22345678-1234-4123-8123-123456789abd';
const body = {
  institutionId: INSTITUTION,
  formConfigurationId: FORM,
  formConfigurationVersion: 1,
  firstName: 'Tom',
  lastName: 'Thumb',
  dateOfBirth: '2012-03-15',
  gender: 'male',
  guardianName: 'P',
  guardianPhone: '+1-555-0200',
};

const apps: FastifyInstance[] = [];
async function build(
  extra: Partial<RegistrationRoutesOptions> = {},
  repo = new InMemoryRegistrationRepository(),
) {
  repo.seedInstitutions([
    {
      id: INSTITUTION,
      name: 'S',
      code: 'S',
      typeId: 't',
      areaId: 'a',
      tenantId: TENANT,
      status: 'ACTIVE',
      latitude: null,
      longitude: null,
      address: null,
    },
  ]);
  repo.seedFormConfigurations([
    {
      id: FORM,
      tenantId: TENANT,
      institutionId: INSTITUTION,
      version: 1,
      publishedAt: '2026-09-19T00:00:00.000Z',
      fields: [],
    },
  ]);
  const app = Fastify();
  apps.push(app);
  await registerRegistrationRoutes(app, {
    registrationService: new RegistrationService(repo),
    defaultTenantId: TENANT,
    ...extra,
  });
  await app.ready();
  return app;
}

afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
  vi.unstubAllEnvs();
});

/** In-process stand-in for one Redis server shared by two gateway replicas. */
class FakeRedis implements RedisLikeForThrottle {
  private readonly counters = new Map<string, { value: number; expiresAt: number | null }>();
  constructor(private readonly now: () => number = Date.now) {}
  private live(key: string) {
    const entry = this.counters.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.counters.delete(key);
      return undefined;
    }
    return entry;
  }
  async incr(key: string) {
    const entry = this.live(key) ?? { value: 0, expiresAt: null };
    entry.value += 1;
    this.counters.set(key, entry);
    return entry.value;
  }
  async pexpire(key: string, ms: number) {
    const entry = this.live(key);
    if (!entry) return 0;
    entry.expiresAt = this.now() + ms;
    return 1;
  }
  async pttl(key: string) {
    const entry = this.live(key);
    if (!entry) return -2;
    return entry.expiresAt === null ? -1 : entry.expiresAt - this.now();
  }
  async get(key: string) {
    const entry = this.live(key);
    return entry ? String(entry.value) : null;
  }
}

describe('PRC-M332 public throttles', () => {
  it('sliding window allows max then blocks with retry-after', () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter(2, 1000, () => now);
    expect(limiter.hit('k').allowed).toBe(true);
    expect(limiter.hit('k').allowed).toBe(true);
    const blocked = limiter.hit('k');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    now = 1500;
    expect(limiter.hit('k').allowed).toBe(true);
  });

  it('burst of 20 status calls for one tracking number -> 429', async () => {
    const app = await build({ publicThrottle: new PublicRegistrationThrottle() });
    const submit = await app.inject({
      method: 'POST',
      url: '/registrations',
      headers: { 'idempotency-key': 'throttle-burst' },
      payload: body,
    });
    const { trackingNumber } = submit.json() as { trackingNumber: string };
    const codes: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/registrations/status',
        payload: { trackingNumber, dateOfBirth: body.dateOfBirth },
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it('submit without challenge token -> 400 when required', async () => {
    const app = await build({ submitChallenge: { required: true, verify: async () => true } });
    const res = await app.inject({
      method: 'POST',
      url: '/registrations',
      headers: { 'idempotency-key': 'challenge-missing' },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'CHALLENGE_REQUIRED' });
    const ok = await app.inject({
      method: 'POST',
      url: '/registrations',
      headers: { 'idempotency-key': 'challenge-ok', 'x-registration-challenge': 'tok' },
      payload: body,
    });
    expect(ok.statusCode).toBe(201);
  });

  it('required challenge uses the default proof-of-work verifier; bad token -> 400', async () => {
    // PRC-M332: a default verifier now exists, so an unsolved token is rejected
    // (400 CHALLENGE_FAILED) instead of the old "no verifier" 503.
    const closed = await build({ submitChallenge: { required: true } });
    const res = await closed.inject({
      method: 'POST',
      url: '/registrations',
      headers: { 'idempotency-key': 'challenge-closed', 'x-registration-challenge': 'tok' },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'CHALLENGE_FAILED' });
    const strict = await build({ submitChallenge: { required: true, verify: async () => false } });
    const bad = await strict.inject({
      method: 'POST',
      url: '/registrations',
      headers: { 'idempotency-key': 'challenge-bad', 'x-registration-challenge': 'tok' },
      payload: body,
    });
    expect(bad.statusCode).toBe(400);
  });

  it('status lookups share one budget across replicas when Redis-backed', async () => {
    const redis = new FakeRedis();
    // Two replicas: one database, one Redis, separate processes.
    const database = new InMemoryRegistrationRepository();
    const replicaOne = await build(
      { publicThrottle: createPublicRegistrationThrottle({ redis }) },
      database,
    );
    const replicaTwo = await build(
      { publicThrottle: createPublicRegistrationThrottle({ redis }) },
      database,
    );
    const submit = await replicaOne.inject({
      method: 'POST',
      url: '/registrations',
      headers: { 'idempotency-key': 'shared-status' },
      payload: body,
    });
    const { trackingNumber } = submit.json() as { trackingNumber: string };
    const codes: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const replica = i % 2 === 0 ? replicaOne : replicaTwo;
      const res = await replica.inject({
        method: 'POST',
        url: '/registrations/status',
        payload: { trackingNumber, dateOfBirth: body.dateOfBirth },
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  it('submits are throttled per applicant identity across replicas', async () => {
    const redis = new FakeRedis();
    const replicaOne = await build({
      publicThrottle: createPublicRegistrationThrottle({ redis }),
    });
    const replicaTwo = await build({
      publicThrottle: createPublicRegistrationThrottle({ redis }),
    });
    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const replica = i % 2 === 0 ? replicaOne : replicaTwo;
      const res = await replica.inject({
        method: 'POST',
        url: '/registrations',
        headers: { 'idempotency-key': `same-applicant-${i}` },
        // Case, spacing and phone punctuation do not make a new identity.
        payload: i === 3 ? { ...body, firstName: ' TOM ', guardianPhone: '+1 555 0200' } : body,
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 5).every((c) => c === 201)).toBe(true);
    expect(codes[5]).toBe(429);
    const other = await replicaTwo.inject({
      method: 'POST',
      url: '/registrations',
      headers: { 'idempotency-key': 'other-applicant' },
      payload: { ...body, firstName: 'Tina' },
    });
    expect(other.statusCode).toBe(201);
  });

  it('a deployed process without Redis refuses to build the throttles', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('REDIS_URL', '');
    expect(() => createPublicRegistrationThrottle()).toThrow(/PRC-M332/);
  });
});
