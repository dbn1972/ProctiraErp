/**
 * PRC-H029 — contract test: the public web registration client (apps/web) against the
 * real registration routes, mounted under `/api/v1` the way the gateway serves the
 * `/registrations` proxy prefix. Guards against the client drifting back onto routes
 * the backend never implemented.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemoryRegistrationRepository,
  RegistrationService,
  registerRegistrationRoutes,
} from '@proctira/backend-registration';
import { getApplicationByTrackingNumber, searchSchools } from '../../web/src/lib/api/registration';

const TENANT = 'tenant-contract';
const INSTITUTION = '12345678-1234-4123-8123-123456789abc';
const FORM = '22345678-1234-4123-8123-123456789abc';
const DOB = '2012-03-15';

let app: FastifyInstance;
let trackingNumber = '';

/** Routes the client's `fetch` into the in-process Fastify app. */
const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), 'http://gateway.test');
  const res = await app.inject({
    method: (init?.method ?? 'GET') as 'GET',
    url: `${url.pathname}${url.search}`,
    headers: { accept: 'application/json' },
  });
  return new Response(res.body, {
    status: res.statusCode,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

beforeAll(async () => {
  const repository = new InMemoryRegistrationRepository();
  repository.seedInstitutions([
    {
      id: INSTITUTION,
      name: 'Contract School',
      code: 'CON-001',
      typeId: 'type-001',
      typeName: 'Primary',
      areaId: 'area-001',
      areaName: 'Central',
      tenantId: TENANT,
      status: 'ACTIVE',
      latitude: 12.97,
      longitude: 77.59,
      address: '1 Contract Rd',
      availableGrades: ['grade-1'],
    },
  ]);
  repository.seedFormConfigurations([
    {
      id: FORM,
      tenantId: TENANT,
      institutionId: INSTITUTION,
      version: 1,
      publishedAt: '2026-01-01T00:00:00.000Z',
      fields: [],
    },
  ]);
  app = Fastify();
  await app.register(
    async (scope) => {
      await registerRegistrationRoutes(scope, {
        registrationService: new RegistrationService(repository),
        defaultTenantId: TENANT,
      });
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
  const submit = await app.inject({
    method: 'POST',
    url: '/api/v1/registrations',
    headers: { 'idempotency-key': 'contract-submit' },
    payload: {
      institutionId: INSTITUTION,
      formConfigurationId: FORM,
      formConfigurationVersion: 1,
      firstName: 'Asha',
      lastName: 'Rao',
      dateOfBirth: DOB,
      gender: 'female',
      guardianName: 'Guardian Rao',
      guardianPhone: '+91-555-0100',
    },
  });
  expect(submit.statusCode, submit.body).toBe(201);
  trackingNumber = (JSON.parse(submit.body) as { trackingNumber: string }).trackingNumber;
});

afterAll(async () => {
  await app.close();
});

describe('public registration client ↔ registration routes (PRC-H029)', () => {
  it('returns kind "ok" with the correct DOB', async () => {
    const result = await getApplicationByTrackingNumber(trackingNumber, DOB, { fetcher });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data.trackingNumber).toBe(trackingNumber);
      expect(result.data.status).toBe('pending');
      expect(result.data.institutionName).toBe('Contract School');
      expect(result.data.interviewBookings).toEqual([]);
    }
  });

  it('returns kind "not_found" with a wrong DOB', async () => {
    const result = await getApplicationByTrackingNumber(trackingNumber, '2000-01-01', { fetcher });
    expect(result.kind).toBe('not_found');
  });

  it('returns kind "not_found" for an unknown tracking number', async () => {
    const result = await getApplicationByTrackingNumber('REG-ZZZZZZZZ', DOB, { fetcher });
    expect(result.kind).toBe('not_found');
  });

  it('School Finder search reaches the real route', async () => {
    const result = await searchSchools({ search: 'contract' }, { fetcher });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.data.map((s) => s.name)).toEqual(['Contract School']);
  });
});
