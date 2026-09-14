import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyDeprecationHeaders,
  ERROR_CODE_REGISTRY,
  getErrorCodeDefinition,
} from '@proctira/common';

import { apiContractPlugin } from './api-contract.js';

describe('W2-API-02 / W2-API-03 api contract stability', () => {
  const apps: Array<Awaited<ReturnType<typeof Fastify>>> = [];

  afterEach(async () => {
    while (apps.length) {
      const app = apps.pop();
      if (app) await app.close();
    }
  });

  it('exposes the error-code registry over GET /api/v1/meta/error-codes', async () => {
    const app = Fastify();
    apps.push(app);
    await app.register(apiContractPlugin);
    const res = await app.inject({ method: 'GET', url: '/api/v1/meta/error-codes' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { codes: Array<{ code: string }> };
    expect(body.codes.length).toBe(ERROR_CODE_REGISTRY.length);
    expect(body.codes.map((c) => c.code)).toContain('VALIDATION_ERROR');
    expect(body.codes.map((c) => c.code)).toContain('GONE');
    expect(getErrorCodeDefinition('NOT_FOUND')?.httpStatus).toBe(404);
  });

  it('exposes deprecation policy and applies RFC-8594 headers on the example route', async () => {
    const app = Fastify();
    apps.push(app);
    await app.register(apiContractPlugin);
    const policy = await app.inject({ method: 'GET', url: '/api/v1/meta/deprecation-policy' });
    expect(policy.statusCode).toBe(200);
    expect(policy.json()).toMatchObject({ defaultSunsetDays: 180 });

    const example = await app.inject({ method: 'GET', url: '/api/v1/meta/deprecated-example' });
    expect(example.statusCode).toBe(200);
    expect(example.headers.deprecation).toBe('true');
    expect(example.headers.sunset).toBeTruthy();
    expect(String(example.headers.link)).toContain('rel="successor-version"');
  });

  it('applyDeprecationHeaders sets successor Link', () => {
    const headers = new Map<string, string>();
    applyDeprecationHeaders(
      {
        setHeader: (name, value) => {
          headers.set(name, value);
        },
      },
      {
        deprecation: 'true',
        sunset: 'Wed, 01 Jul 2026 00:00:00 GMT',
        successor: '/api/v2/widgets',
      },
    );
    expect(headers.get('Deprecation')).toBe('true');
    expect(headers.get('Sunset')).toContain('2026');
    expect(headers.get('Link')).toBe('</api/v2/widgets>; rel="successor-version"');
  });
});
