import { createHmac } from 'node:crypto';

import type { Page } from '@playwright/test';

/**
 * Mint an unsigned JWT the App Router middleware accepts (exp/tenant only).
 * Cookie `url` must match PLAYWRIGHT_BASE_URL host (localhost ≠ 127.0.0.1).
 * Does **not** satisfy gateway `jwtVerify` — use `createSignedJwt` for live writes.
 */
export function createFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

/**
 * HS256 JWT accepted by api-gateway `@fastify/jwt` when `JWT_SECRET` / issuer / audience match.
 * E2E-only helper — does not change production verification.
 */
export function createSignedJwt(
  payload: Record<string, unknown>,
  options: {
    secret?: string;
    issuer?: string;
    audience?: string;
  } = {},
): string {
  const secret =
    options.secret ?? process.env.JWT_SECRET?.trim() ?? 'dev-secret-change-in-production';
  const now = Math.floor(Date.now() / 1000);
  const body = {
    iss: options.issuer ?? process.env.JWT_ISSUER ?? 'proctira-platform',
    aud: options.audience ?? process.env.JWT_AUDIENCE ?? 'proctira-api',
    iat: now,
    exp: now + 60 * 60 * 8,
    ...payload,
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const encodedBody = Buffer.from(JSON.stringify(body)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${header}.${encodedBody}`)
    .digest('base64url');
  return `${header}.${encodedBody}.${signature}`;
}

export async function setupFakeTenantSession(
  page: Page,
  overrides: Partial<{
    sub: string;
    email: string;
    displayName: string;
    tenantId: string;
  }> = {},
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = createFakeJwt({
    sub: overrides.sub ?? 'e2e-user',
    email: overrides.email ?? 'admin@tenant-a.test',
    displayName: overrides.displayName ?? 'E2E Admin',
    tenantId: overrides.tenantId ?? '00000000-0000-4000-8000-0000000000aa',
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
    iat: now,
    exp: now + 60 * 60 * 8,
  });

  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

  await page.context().addCookies([
    { name: 'access_token', value: token, url: baseUrl },
    { name: 'refresh_token', value: token, url: baseUrl },
  ]);
}

/**
 * Session cookies signed for both Next middleware and api-gateway writes.
 * Requires `JWT_SECRET` aligned with the running gateway.
 */
export async function setupGatewayTenantSession(
  page: Page,
  overrides: Partial<{
    sub: string;
    email: string;
    displayName: string;
    tenantId: string;
  }> = {},
): Promise<void> {
  const token = createSignedJwt({
    sub: overrides.sub ?? 'e2e-user',
    email: overrides.email ?? 'admin@tenant-a.test',
    displayName: overrides.displayName ?? 'E2E Admin',
    tenantId: overrides.tenantId ?? '00000000-0000-4000-8000-000000000001',
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
  });

  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

  await page.context().addCookies([
    { name: 'access_token', value: token, url: baseUrl },
    { name: 'refresh_token', value: token, url: baseUrl },
  ]);
}
