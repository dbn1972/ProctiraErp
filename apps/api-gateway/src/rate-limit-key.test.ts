/**
 * G-731 — rate-limit bucket keys never trust `x-tenant-id`; MFA_EXPOSE_OTP is
 * refused in production.
 */
import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp, rateLimitKeyFor } from './app.js';
import type { GatewayConfig } from './config.js';

function fakeRequest(input: {
  ip?: string;
  tenantId?: string;
  headerTenant?: string;
  user?: { sub?: string; tenantId?: string };
}): FastifyRequest {
  return {
    ip: input.ip ?? '203.0.113.9',
    tenantId: input.tenantId,
    headers: input.headerTenant ? { 'x-tenant-id': input.headerTenant } : {},
    user: input.user,
  } as unknown as FastifyRequest;
}

describe('rateLimitKeyFor (G-731)', () => {
  it('buckets anonymous callers by IP even when x-tenant-id is supplied', () => {
    expect(rateLimitKeyFor(fakeRequest({ headerTenant: 'spoofed-tenant' }))).toBe('ip:203.0.113.9');
    expect(rateLimitKeyFor(fakeRequest({ headerTenant: 'other-tenant' }))).toBe('ip:203.0.113.9');
  });

  it('prefers the JWT tenant over the resolved/header tenant for authenticated callers', () => {
    const key = rateLimitKeyFor(
      fakeRequest({
        tenantId: 'host-tenant',
        headerTenant: 'spoofed-tenant',
        user: { sub: 'user-1', tenantId: 'jwt-tenant' },
      }),
    );
    expect(key).toBe('jwt-tenant:user-1');
  });

  it('falls back to the host-resolved tenant when the token has none', () => {
    expect(rateLimitKeyFor(fakeRequest({ tenantId: 'host-tenant', user: { sub: 'user-2' } }))).toBe(
      'host-tenant:user-2',
    );
    expect(rateLimitKeyFor(fakeRequest({ user: { sub: 'user-3' } }))).toBe('user:user-3');
  });
});

describe('MFA_EXPOSE_OTP production guard (G-731)', () => {
  const previous = { ...process.env };

  afterEach(() => {
    process.env = { ...previous };
  });

  it('refuses to boot with MFA_EXPOSE_OTP=true in production', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['MFA_EXPOSE_OTP'] = 'true';
    process.env['JWT_SECRET'] = 'a-very-long-production-grade-secret-value-1234567890';
    delete process.env['DATABASE_URL'];
    process.env['REQUIRE_DATABASE'] = '0';
    process.env['ALLOW_IN_MEMORY_FALLBACK'] = '1';

    const config: GatewayConfig = {
      port: 0,
      host: '127.0.0.1',
      env: 'production',
      rateLimiting: { windowMs: 60000, maxRequests: 100 },
      cors: { origins: ['https://app.example.com'], methods: ['GET'], credentials: true },
      jwt: {
        secret: process.env['JWT_SECRET']!,
        issuer: 'proctira',
        audience: 'proctira-api',
        accessTokenExpiresIn: '15m',
      },
      tenant: { baseDomain: 'proctira.org', headerName: 'x-tenant-id' },
      services: {
        auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
      },
    };

    await expect(buildApp({ config })).rejects.toThrow(/MFA_EXPOSE_OTP/);
  });
});
