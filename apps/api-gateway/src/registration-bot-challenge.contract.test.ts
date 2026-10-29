/**
 * PRC-M332 — contract test: the registration portal's real submit client
 * (apps/registration-portal/src/lib/api.ts) solves the real backend's
 * proof-of-work challenge and the deployed-mode submit accepts it. Guards the
 * client and the server against drifting apart on the token format.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemoryChallengeNonceStore,
  InMemoryRegistrationRepository,
  InMemorySessionStore,
  RegistrationService,
  registerRegistrationRoutes,
} from '@proctira/backend-registration';

import {
  submitRegistration,
  type RegistrationRequestInit,
} from '../../registration-portal/src/lib/api';

const TENANT = '7a1c2f30-3333-4333-8333-000000000332';
const INSTITUTION = '12345678-1234-4123-8123-123456780332';
const FORM = '22345678-1234-4123-8123-123456780332';

let app: FastifyInstance;
let savedNodeEnv: string | undefined;

beforeAll(async () => {
  savedNodeEnv = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';
  const repo = new InMemoryRegistrationRepository();
  repo.seedInstitutions([
    {
      id: INSTITUTION,
      name: 'Contract School',
      code: 'CS',
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
  app = Fastify();
  await app.register(
    async (scope) => {
      await registerRegistrationRoutes(scope, {
        registrationService: new RegistrationService(repo),
        publicTenantResolver: { resolveHostname: async () => TENANT },
        sessionStore: new InMemorySessionStore(),
        submitChallenge: {
          secret: 'contract-challenge-secret-0123456789abcdef',
          nonceStore: new InMemoryChallengeNonceStore(),
          difficulty: 8,
        },
      });
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
});

afterAll(async () => {
  await app.close();
  process.env['NODE_ENV'] = savedNodeEnv;
});

/** Portal transport into the in-process gateway routes (`/api/v1` prefix). */
const transport = async (path: string, init: RegistrationRequestInit = {}) => {
  const res = await app.inject({
    method: (init.method ?? 'GET') as 'GET',
    url: `/api/v1${path}`,
    headers: init.headers ?? {},
    ...(init.body ? { payload: init.body } : {}),
  });
  return new Response(res.body, {
    status: res.statusCode,
    headers: { 'content-type': 'application/json' },
  });
};

describe('PRC-M332 portal client ↔ deployed registration submit', () => {
  it('the portal client solves the challenge and the submit is accepted (201)', async () => {
    const result = await submitRegistration(
      {
        institutionId: INSTITUTION,
        formConfigurationId: FORM,
        formConfigurationVersion: 1,
        firstName: 'Contract',
        lastName: 'Applicant',
        dateOfBirth: '2013-05-05',
        gender: 'female',
        guardianName: 'Guardian',
        guardianPhone: '+1-555-0332',
      },
      'contract-key-0332',
      transport,
    );
    expect(result.trackingNumber).toMatch(/^REG-/);
  });

  it('a submit that skips the challenge is refused (400 CHALLENGE_REQUIRED)', async () => {
    const res = await transport('/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'contract-key-skip' },
      body: JSON.stringify({
        institutionId: INSTITUTION,
        formConfigurationId: FORM,
        formConfigurationVersion: 1,
        firstName: 'No',
        lastName: 'Token',
        dateOfBirth: '2013-05-05',
        gender: 'male',
        guardianName: 'Guardian',
        guardianPhone: '+1-555-0333',
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('CHALLENGE_REQUIRED');
  });
});
