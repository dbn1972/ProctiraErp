import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { KeycloakJwksClient, decodeJwt, verifyKeycloakAccessToken, verifyRs256 } from './verify.js';

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

    const jwks = new KeycloakJwksClient(
      config.jwksUri,
      async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-kid', kty: 'RSA' }] })),
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
    const jwks = new KeycloakJwksClient(
      config.jwksUri,
      async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-kid', kty: 'RSA' }] })),
    );

    await expect(verifyKeycloakAccessToken(token, config, jwks, now)).rejects.toThrow(
      /issuer mismatch|expired/,
    );
    expect(verifyRs256('a.b', 'c', publicKey)).toBe(false);
    expect(decodeJwt(token).header.alg).toBe('RS256');
  });

  const pem = () => privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const jwksFor = () =>
    new KeycloakJwksClient(
      config.jwksUri,
      async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-kid', kty: 'RSA' }] })),
    );
  const now = 1_700_000_000;
  const base = { sub: 'kc-user-2', iss: issuer, exp: now + 300, iat: now, jti: 'j2' };

  it('rejects a token minted for a different client with default config (PRC-M180)', async () => {
    const token = signRs256(
      { ...base, azp: 'other-client', aud: ['account', 'other-client'] },
      pem(),
    );
    await expect(verifyKeycloakAccessToken(token, config, jwksFor(), now)).rejects.toThrow(
      /audience mismatch/,
    );
  });

  it('accepts aud naming the gateway client and enforces explicit KEYCLOAK_AUDIENCE (PRC-M180)', async () => {
    const token = signRs256({ ...base, azp: 'mobile-app', aud: 'proctira-gateway' }, pem());
    await expect(verifyKeycloakAccessToken(token, config, jwksFor(), now)).resolves.toBeTruthy();
    const strict = { ...config, audience: 'proctira-api' };
    await expect(verifyKeycloakAccessToken(token, strict, jwksFor(), now)).rejects.toThrow(
      /audience mismatch/,
    );
  });

  it('rejects a token whose nbf is in the future (PRC-M180)', async () => {
    const token = signRs256({ ...base, azp: 'proctira-gateway', nbf: now + 600 }, pem());
    await expect(verifyKeycloakAccessToken(token, config, jwksFor(), now)).rejects.toThrow(
      /not yet valid/,
    );
  });

  it('ignores admin roles granted on other clients (PRC-M178)', async () => {
    const token = signRs256(
      {
        ...base,
        azp: 'proctira-gateway',
        roles: ['super-admin'],
        resource_access: { 'other-client': { roles: ['super-admin', 'admin'] } },
        realm_access: { roles: ['teacher'] },
      },
      pem(),
    );
    const payload = await verifyKeycloakAccessToken(token, config, jwksFor(), now);
    expect(payload.roles.map((role) => role.roleId)).toEqual(['teacher']);
  });
});

describe('KeycloakJwksClient hardening (PRC-M181, NEW-g4_apps_auth-002)', () => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const jwksBody = () => JSON.stringify({ keys: [{ ...jwk, kid: 'known', kty: 'RSA' }] });

  it('negative-caches an unknown kid and does not refetch per request', async () => {
    let fetchCount = 0;
    const client = new KeycloakJwksClient(
      'http://jwks',
      async () => {
        fetchCount += 1;
        return new Response(jwksBody());
      },
      { forcedRefreshCooldownMs: 60_000, negativeCacheMs: 60_000 },
    );
    // First unknown-kid lookup: 1 initial fetch + 1 forced refresh = 2.
    await expect(client.getKey('bogus')).rejects.toThrow(/Unknown Keycloak signing key: bogus/);
    const afterFirst = fetchCount;
    expect(afterFirst).toBe(2);
    // Subsequent lookups for the same unknown kid must NOT trigger more fetches.
    for (let i = 0; i < 10; i += 1) {
      await expect(client.getKey('bogus')).rejects.toThrow(/Unknown/);
    }
    expect(fetchCount).toBe(afterFirst);
  });

  it('respects the forced-refresh cooldown across distinct unknown kids', async () => {
    let fetchCount = 0;
    const client = new KeycloakJwksClient(
      'http://jwks',
      async () => {
        fetchCount += 1;
        return new Response(jwksBody());
      },
      { forcedRefreshCooldownMs: 60_000 },
    );
    await expect(client.getKey('k1')).rejects.toThrow(/Unknown/); // initial + forced = 2
    expect(fetchCount).toBe(2);
    // Different unknown kid within cooldown: no additional forced refresh.
    await expect(client.getKey('k2')).rejects.toThrow(/Unknown/);
    expect(fetchCount).toBe(2);
  });

  it('coalesces concurrent refreshes into a single in-flight fetch', async () => {
    let fetchCount = 0;
    const client = new KeycloakJwksClient('http://jwks', async () => {
      fetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(jwksBody());
    });
    const results = await Promise.all([
      client.getKey('known'),
      client.getKey('known'),
      client.getKey('known'),
    ]);
    expect(results).toHaveLength(3);
    expect(fetchCount).toBe(1);
  });

  it('applies a fetch timeout via AbortSignal', async () => {
    const client = new KeycloakJwksClient(
      'http://jwks',
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          expect(signal).toBeDefined();
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
      { fetchTimeoutMs: 20 },
    );
    await expect(client.getKey('known')).rejects.toThrow(/Failed to load Keycloak JWKS/);
  });

  it('never exposes an empty map during a refresh (atomic swap)', async () => {
    let resolveSecond: (() => void) | undefined;
    let call = 0;
    const client = new KeycloakJwksClient(
      'http://jwks',
      async () => {
        call += 1;
        if (call >= 2) {
          await new Promise<void>((resolve) => {
            resolveSecond = resolve;
          });
        }
        return new Response(jwksBody());
      },
      { ttlMs: 0 },
    );
    await client.getKey('known');
    // Trigger a refresh (ttl 0) that will block mid-flight, and ensure the
    // previously loaded key is still resolvable from the current map.
    const pending = client.getKey('known');
    expect(resolveSecond).toBeDefined();
    resolveSecond?.();
    await expect(pending).resolves.toBeTruthy();
  });
});
