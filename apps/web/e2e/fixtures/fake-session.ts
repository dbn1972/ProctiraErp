import type { Page } from '@playwright/test';

/**
 * Mint an unsigned JWT the App Router middleware accepts (exp/tenant only).
 * Cookie `url` must match PLAYWRIGHT_BASE_URL host (localhost ≠ 127.0.0.1).
 */
export function createFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
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
