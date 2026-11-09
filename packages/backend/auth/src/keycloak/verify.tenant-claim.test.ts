/**
 * PRC-L213 (DECISION_REGISTER ## 43, one account per tenant): a Keycloak
 * access token whose tenant claim holds more than one value is refused. Base
 * `firstClaim()` silently used element 0, so the token acted in whichever
 * tenant the IdP listed first.
 */
import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { KeycloakJwksClient, KeycloakTokenError, verifyKeycloakAccessToken } from './verify.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const issuer = 'http://localhost:8180/realms/proctira';
const config = {
  issuer,
  clientId: 'proctira-gateway',
  realm: 'proctira',
  jwksUri: `${issuer}/protocol/openid-connect/certs`,
};
const now = 1_700_000_000;

function token(tenantClaim: Record<string, unknown>): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signed = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'test-kid' })}.${b64({
    sub: 'kc-user',
    iss: issuer,
    azp: 'proctira-gateway',
    exp: now + 300,
    iat: now,
    jti: 'j-1',
    ...tenantClaim,
  })}`;
  return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url')}`;
}

const jwks = () =>
  new KeycloakJwksClient(
    config.jwksUri,
    async () =>
      new Response(
        JSON.stringify({
          keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', kty: 'RSA' }],
        }),
      ),
  );

describe('Keycloak tenant claim cardinality (PRC-L213)', () => {
  it('rejects a tenant_id claim with more than one value', async () => {
    await expect(
      verifyKeycloakAccessToken(
        token({ tenant_id: ['tenant-a', 'tenant-b'] }),
        config,
        jwks(),
        now,
      ),
    ).rejects.toBeInstanceOf(KeycloakTokenError);
  });

  it('rejects a multi-valued tenantId claim too', async () => {
    await expect(
      verifyKeycloakAccessToken(token({ tenantId: ['tenant-a', 'tenant-b'] }), config, jwks(), now),
    ).rejects.toThrow(/more than one tenant/);
  });

  it('accepts a one-element array as that tenant', async () => {
    const payload = await verifyKeycloakAccessToken(
      token({ tenant_id: ['tenant-a'] }),
      config,
      jwks(),
      now,
    );
    expect(payload.tenantId).toBe('tenant-a');
  });

  it('leaves a string claim unchanged', async () => {
    const payload = await verifyKeycloakAccessToken(
      token({ tenant_id: 'tenant-a' }),
      config,
      jwks(),
      now,
    );
    expect(payload.tenantId).toBe('tenant-a');
  });
});
