/**
 * PRC-M332 — mandatory self-hosted bot control on anonymous registration submit
 * in deployed environments: HMAC-signed, tenant-bound, expiring, single-use
 * proof-of-work.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryChallengeNonceStore } from './bot-challenge-nonce-store.js';
import {
  formatChallengeToken,
  issueRegistrationChallenge,
  leadingZeroBits,
  proofOfWorkMeets,
  solveRegistrationChallenge,
} from './bot-challenge.js';
import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { RegistrationService } from './registration-service.js';
import {
  InMemorySessionStore,
  registerRegistrationRoutes,
  type RegistrationRoutesOptions,
} from './routes.js';

const TENANT = '7a1c2f30-1111-4111-8111-000000000332';
const OTHER_TENANT = '7a1c2f30-2222-4222-8222-000000000332';
const INSTITUTION = '12345678-1234-4123-8123-123456789332';
const FORM = '22345678-1234-4123-8123-123456789332';
const SECRET = 'm332-test-challenge-secret-0123456789abcdef';
const body = {
  institutionId: INSTITUTION,
  formConfigurationId: FORM,
  formConfigurationVersion: 1,
  firstName: 'Ada',
  lastName: 'Bot',
  dateOfBirth: '2013-04-01',
  gender: 'female',
  guardianName: 'G',
  guardianPhone: '+1-555-0332',
};

const apps: FastifyInstance[] = [];
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  process.env['NODE_ENV'] = 'production';
  delete process.env['REDIS_URL'];
  delete process.env['REGISTRATION_CHALLENGE_SECRET'];
  delete process.env['REGISTRATION_SUBMIT_CHALLENGE_REQUIRED'];
});

afterEach(async () => {
  process.env = savedEnv;
  while (apps.length) await apps.pop()!.close();
});

async function build(challenge: RegistrationRoutesOptions['submitChallenge'] = {}) {
  const repo = new InMemoryRegistrationRepository();
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
    publicTenantResolver: { resolveHostname: async () => TENANT },
    sessionStore: new InMemorySessionStore(),
    submitChallenge: {
      secret: SECRET,
      nonceStore: new InMemoryChallengeNonceStore(),
      difficulty: 8,
      ...challenge,
    },
  });
  await app.ready();
  return app;
}

let keySeq = 0;
const submit = (app: FastifyInstance, token?: string) =>
  app.inject({
    method: 'POST',
    url: '/registrations',
    headers: {
      'idempotency-key': `m332-submit-${(keySeq += 1)}`,
      ...(token ? { 'x-registration-challenge': token } : {}),
    },
    payload: body,
  });

async function fetchChallenge(app: FastifyInstance) {
  const res = await app.inject({ method: 'GET', url: '/registrations/challenge' });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ReturnType<typeof issueRegistrationChallenge>;
}

describe('PRC-M332 deployed submit requires a solved proof-of-work', () => {
  it('submit without x-registration-challenge -> 400 CHALLENGE_REQUIRED', async () => {
    const app = await build();
    const res = await submit(app);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CHALLENGE_REQUIRED');
  });

  it('a solved fresh challenge -> 201', async () => {
    const app = await build();
    const challenge = await fetchChallenge(app);
    expect(challenge).toMatchObject({ difficulty: 8, algorithm: 'sha256-leading-zero-bits' });
    const res = await submit(app, solveRegistrationChallenge(challenge));
    expect(res.statusCode, res.body).toBe(201);
  });

  it('a replayed solution -> 400 CHALLENGE_FAILED', async () => {
    const app = await build();
    const token = solveRegistrationChallenge(await fetchChallenge(app));
    expect((await submit(app, token)).statusCode).toBe(201);
    const replay = await submit(app, token);
    expect(replay.statusCode).toBe(400);
    expect(replay.json().code).toBe('CHALLENGE_FAILED');
  });

  it('a bad HMAC (or another tenant’s challenge) -> 400 CHALLENGE_FAILED', async () => {
    const app = await build();
    const challenge = await fetchChallenge(app);
    const forged = solveRegistrationChallenge({ ...challenge, sig: 'A'.repeat(43) });
    expect((await submit(app, forged)).json().code).toBe('CHALLENGE_FAILED');
    const otherTenant = issueRegistrationChallenge({
      secret: SECRET,
      tenantId: OTHER_TENANT,
      difficulty: 8,
    });
    const res = await submit(app, solveRegistrationChallenge(otherTenant));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CHALLENGE_FAILED');
  });

  it('an expired challenge -> 400 CHALLENGE_FAILED', async () => {
    const app = await build();
    const expired = issueRegistrationChallenge({
      secret: SECRET,
      tenantId: TENANT,
      difficulty: 8,
      ttlSeconds: 60,
      now: Date.now() - 10 * 60_000,
    });
    const res = await submit(app, solveRegistrationChallenge(expired));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CHALLENGE_FAILED');
  });

  it('insufficient work -> 400 CHALLENGE_FAILED', async () => {
    const app = await build();
    const challenge = await fetchChallenge(app);
    let counter = 0;
    while (proofOfWorkMeets(challenge.nonce, String(counter), challenge.difficulty)) counter += 1;
    const res = await submit(app, formatChallengeToken(challenge, counter));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CHALLENGE_FAILED');
  });

  it('a signed lower difficulty than the server minimum is refused', async () => {
    const app = await build({ difficulty: 12 });
    const weak = issueRegistrationChallenge({ secret: SECRET, tenantId: TENANT, difficulty: 8 });
    let token = '';
    for (let counter = 0; ; counter += 1) {
      if (
        proofOfWorkMeets(weak.nonce, String(counter), 8) &&
        !proofOfWorkMeets(weak.nonce, String(counter), 12)
      ) {
        token = formatChallengeToken(weak, counter);
        break;
      }
    }
    expect((await submit(app, token)).json().code).toBe('CHALLENGE_FAILED');
  });
});

describe('PRC-M332 deployed boot refuses an unusable bot control', () => {
  const minimal = (challenge: RegistrationRoutesOptions['submitChallenge']) => {
    const app = Fastify();
    apps.push(app);
    return registerRegistrationRoutes(app, {
      registrationService: new RegistrationService(new InMemoryRegistrationRepository()),
      publicTenantResolver: { resolveHostname: async () => TENANT },
      sessionStore: new InMemorySessionStore(),
      ...(challenge ? { submitChallenge: challenge } : {}),
    });
  };

  it('no REGISTRATION_CHALLENGE_SECRET -> registration throws at boot', async () => {
    await expect(minimal(undefined)).rejects.toThrow(/REGISTRATION_CHALLENGE_SECRET/);
  });

  it('a secret but no shared Redis store -> registration throws at boot', async () => {
    process.env['REGISTRATION_CHALLENGE_SECRET'] = SECRET;
    await expect(minimal(undefined)).rejects.toThrow(/Redis/);
  });

  it('a short secret, or JWT_SECRET reused as the challenge key, is refused', async () => {
    await expect(
      minimal({ secret: 'short', nonceStore: new InMemoryChallengeNonceStore() }),
    ).rejects.toThrow(/at least 32/);
    process.env['JWT_SECRET'] = SECRET;
    await expect(
      minimal({ secret: SECRET, nonceStore: new InMemoryChallengeNonceStore() }),
    ).rejects.toThrow(/JWT_SECRET/);
  });
});

describe('PRC-M332 proof-of-work primitives', () => {
  it('counts leading zero bits', () => {
    expect(leadingZeroBits(new Uint8Array([0, 0, 0x10]))).toBe(19);
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0, 0]))).toBe(16);
  });
});
