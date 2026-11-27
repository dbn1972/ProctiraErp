/**
 * @vitest-environment node
 *
 * UATENV-D23: platform operator tokens (tenant claim `platform`) are for the admin console only
 * (#790). The web treats them as no session, so the middleware, getSession() and the gateway
 * client never use one on a school host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readSessionToken } from './verified-token';

function token(claims: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600, sub: 'u1', ...claims }),
    ).toString('base64url'),
    '',
  ].join('.');
}

beforeEach(() => {
  // Decode-only mode (local dev / CI): no JWKS configured, not a deployed stage.
  for (const name of ['KEYCLOAK_ISSUER', 'KEYCLOAK_CLIENT_ID', 'APP_ENV', 'DEPLOY_ENV']) {
    vi.stubEnv(name, '');
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readSessionToken platform operator tokens (UATENV-D23)', () => {
  it('reads a school token', async () => {
    const claims = await readSessionToken(token({ tenant_id: 'tenant-1' }));
    expect(claims).not.toBeNull();
  });

  it.each([{ tenant_id: 'platform' }, { tenantId: 'platform' }, { tenant_id: ['platform'] }])(
    'refuses a platform operator token (%j)',
    async (claim) => {
      expect(await readSessionToken(token(claim))).toBeNull();
      expect(await readSessionToken(token(claim), { ignoreExpiry: true })).toBeNull();
    },
  );
});
