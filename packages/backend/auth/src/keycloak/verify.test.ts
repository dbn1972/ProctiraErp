import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  KeycloakJwksClient,
  decodeJwt,
  verifyKeycloakAccessToken,
  verifyRs256,
} from './verify.js';

function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function signRs256(payload: Record<string, unknown>, privateKey: string, kid = 'test-kid'): string {
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const body = toBase64Url(JSON.stringify(payload));
  const signed = `${header}.${body}`;
  const signature = sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url');
  return `${signed}.${signature}`;
}

describe('Keycloak token verify', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const issuer = 'http://localhost:8180/realms/proctira';
  const config = {
    issuer,
    clientId: 'proctira-gateway',
    realm: 'proctira',
    jwksUri: 'http://localhost:8180/realms/proctira/protocol/openid-connect/certs',
  };

  it('accepts a valid Keycloak RS256 access token and maps roles', async () => {
    const now = 1_700_000_000;
    const token = signRs256(
      {
        sub: 'kc-user-1',
        iss: issuer,
        exp: now + 300,
        iat: now,
        azp: 'proctira-gateway',
        email: 'admin@proctira.in',
        name: 'India Admin',
        tenant_id: '11111111-1111-1111-1111-111111111111',
        realm_access: { roles: ['admin', 'offline_access'] },
        jti: 'jti-1',
        sid: 'sid-1',
      },
      privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    );

    const jwks = new KeycloakJwksClient(config.jwksUri, async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-kid', kty: 'RSA' }] })),
    );

    const payload = await verifyKeycloakAccessToken(token, config, jwks, now);
    expect(payload.email).toBe('admin@proctira.in');
    expect(payload.tenantId).toBe('11111111-1111-1111-1111-111111111111');
    expect(payload.roles.map((role) => role.roleId)).toEqual(['admin']);
  });

  it('rejects an expired or wrong-issuer token', async () => {
    const now = 1_700_000_000;
    const token = signRs256(
      { sub: 'x', iss: 'http://evil', exp: now - 1, iat: now - 10 },
      privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    );
    const jwks = new KeycloakJwksClient(config.jwksUri, async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-kid', kty: 'RSA' }] })),
    );

    await expect(verifyKeycloakAccessToken(token, config, jwks, now)).rejects.toThrow(
      /issuer mismatch|expired/,
    );
    expect(verifyRs256('a.b', 'c', publicKey)).toBe(false);
    expect(decodeJwt(token).header.alg).toBe('RS256');
  });
});
