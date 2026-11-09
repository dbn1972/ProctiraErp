/**
 * PRC-L254 / PRC-L202: JWKS verifier used by the BFF and console shells.
 * Forged, unsigned, HMAC, expired, wrong-issuer and wrong-audience tokens are
 * refused; RS256 and ES256 tokens signed by the local test JWKS are accepted.
 */
import { createHmac, generateKeyPairSync, sign as nodeSign, type KeyObject } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetShellTokenVerifierCache,
  createJwksVerifier,
  JwksTokenError,
  loadJwksVerifierConfig,
  resolveShellTokenVerification,
  verifyShellAccessToken,
} from './jwks-verifier.js';

const ISSUER = 'https://idp.test/realms/proctira';
const CLIENT_ID = 'proctira-gateway';
const JWKS_URI = `${ISSUER}/protocol/openid-connect/certs`;

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const otherRsa = generateKeyPairSync('rsa', { modulusLength: 2048 });

function jwk(publicKey: KeyObject, kid: string): Record<string, unknown> {
  return { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig' };
}

const JWKS = { keys: [jwk(rsa.publicKey, 'rsa-1'), jwk(ec.publicKey, 'ec-1')] };

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

function claims(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    sub: 'user-1',
    azp: CLIENT_ID,
    aud: 'account',
    tenant_id: 'tenant-a',
    iat: now(),
    exp: now() + 300,
    ...extra,
  };
}

function signRs256(
  payload: Record<string, unknown>,
  key: KeyObject = rsa.privateKey,
  kid = 'rsa-1',
): string {
  const input = `${b64({ alg: 'RS256', typ: 'JWT', kid })}.${b64(payload)}`;
  return `${input}.${nodeSign('sha256', Buffer.from(input), key).toString('base64url')}`;
}

function signEs256(payload: Record<string, unknown>): string {
  const input = `${b64({ alg: 'ES256', typ: 'JWT', kid: 'ec-1' })}.${b64(payload)}`;
  const sig = nodeSign('sha256', Buffer.from(input), {
    key: ec.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${input}.${sig.toString('base64url')}`;
}

function jwksFetcher(body: unknown = JWKS) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

function verifier(fetcher = jwksFetcher(), extra: { audience?: string } = {}) {
  return createJwksVerifier({
    issuer: ISSUER,
    jwksUri: JWKS_URI,
    clientId: CLIENT_ID,
    fetcher: fetcher as unknown as typeof fetch,
    ...extra,
  });
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof JwksTokenError) return error.code;
    throw error;
  }
  return 'accepted';
}

afterEach(() => {
  __resetShellTokenVerifierCache();
});

describe('createJwksVerifier', () => {
  it('accepts RS256 and ES256 tokens signed by the JWKS (positive controls)', async () => {
    const v = verifier();
    await expect(v.verify(signRs256(claims()))).resolves.toMatchObject({ sub: 'user-1' });
    await expect(v.verify(signEs256(claims()))).resolves.toMatchObject({ tenant_id: 'tenant-a' });
  });

  it('refuses a token signed by a key that is not in the JWKS (forged)', async () => {
    expect(await refusal(verifier().verify(signRs256(claims(), otherRsa.privateKey)))).toBe(
      'bad_signature',
    );
  });

  it('refuses a token whose payload was altered after signing', async () => {
    const [h, , s] = signRs256(claims()).split('.');
    const tampered = `${h}.${b64(claims({ tenant_id: 'tenant-b' }))}.${s}`;
    expect(await refusal(verifier().verify(tampered))).toBe('bad_signature');
  });

  it.each([
    ['none', ''],
    ['HS256', 'c2ln'],
    ['RS512', 'c2ln'],
  ])('refuses alg %s', async (alg, sig) => {
    const token = `${b64({ alg, typ: 'JWT', kid: 'rsa-1' })}.${b64(claims())}.${sig}`;
    const code = await refusal(verifier().verify(token));
    expect(['unsupported_alg', 'malformed']).toContain(code);
  });

  it('refuses an HS256 token signed with a shared secret', async () => {
    const input = `${b64({ alg: 'HS256', typ: 'JWT', kid: 'rsa-1' })}.${b64(claims())}`;
    const token = `${input}.${createHmac('sha256', 'secret').update(input).digest('base64url')}`;
    expect(await refusal(verifier().verify(token))).toBe('unsupported_alg');
  });

  it('refuses wrong issuer, wrong audience, expired and not-yet-valid tokens', async () => {
    const v = verifier();
    expect(await refusal(v.verify(signRs256(claims({ iss: 'https://evil.test' }))))).toBe(
      'issuer_mismatch',
    );
    expect(await refusal(v.verify(signRs256(claims({ azp: 'other-client' }))))).toBe(
      'audience_mismatch',
    );
    expect(await refusal(v.verify(signRs256(claims({ exp: now() - 5 }))))).toBe('expired');
    expect(await refusal(v.verify(signRs256(claims({ exp: undefined }))))).toBe('expired');
    expect(await refusal(v.verify(signRs256(claims({ nbf: now() + 120 }))))).toBe('not_yet_valid');
  });

  it('accepts the configured audience in aud when azp differs', async () => {
    const v = verifier(jwksFetcher(), { audience: 'proctira-api' });
    await expect(
      v.verify(signRs256(claims({ azp: 'web', aud: ['account', 'proctira-api'] }))),
    ).resolves.toBeTruthy();
  });

  it('ignoreExpiry still verifies the signature', async () => {
    const v = verifier();
    await expect(
      v.verify(signRs256(claims({ exp: now() - 600 })), { ignoreExpiry: true }),
    ).resolves.toBeTruthy();
    expect(
      await refusal(
        v.verify(signRs256(claims({ exp: now() - 600 }), otherRsa.privateKey), {
          ignoreExpiry: true,
        }),
      ),
    ).toBe('bad_signature');
  });

  it('refuses an unknown kid and rate-limits forced JWKS refreshes', async () => {
    const fetcher = jwksFetcher();
    const v = verifier(fetcher);
    await v.verify(signRs256(claims()));
    expect(fetcher).toHaveBeenCalledTimes(1);
    const unknown = signRs256(claims(), rsa.privateKey, 'rotated-away');
    expect(await refusal(v.verify(unknown))).toBe('unknown_key');
    expect(await refusal(v.verify(unknown))).toBe('unknown_key');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('a key of the wrong type for the alg is refused', async () => {
    const input = `${b64({ alg: 'ES256', typ: 'JWT', kid: 'rsa-1' })}.${b64(claims())}`;
    expect(await refusal(verifier().verify(`${input}.c2ln`))).toBe('unknown_key');
  });

  it('fails closed when the JWKS cannot be fetched', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 503 }));
    expect(await refusal(verifier(fetcher).verify(signRs256(claims())))).toBe('jwks_unavailable');
  });
});

describe('resolveShellTokenVerification', () => {
  const configured = { KEYCLOAK_ISSUER: ISSUER, KEYCLOAK_CLIENT_ID: CLIENT_ID };

  it('verifies when Keycloak issuer + client id are configured', () => {
    expect(resolveShellTokenVerification(configured).mode).toBe('verify');
    expect(loadJwksVerifierConfig(configured)?.jwksUri).toBe(JWKS_URI);
  });

  it('fails closed in a deployed stage without JWKS config', () => {
    expect(resolveShellTokenVerification({ APP_ENV: 'production' }).mode).toBe('unavailable');
    expect(resolveShellTokenVerification({ DEPLOY_ENV: 'Staging' }).mode).toBe('unavailable');
  });

  it('keeps decode-only outside a deployed stage when no JWKS is configured', () => {
    expect(resolveShellTokenVerification({ NODE_ENV: 'production' }).mode).toBe('decode-only');
    expect(resolveShellTokenVerification({}).mode).toBe('decode-only');
  });

  it('verifyShellAccessToken refuses everything when verification is unavailable', async () => {
    await expect(
      verifyShellAccessToken(signRs256(claims()), { APP_ENV: 'production' }),
    ).resolves.toEqual({ ok: false, reason: 'verification_unavailable' });
  });

  it('verifyShellAccessToken in verify mode refuses an alg:none token', async () => {
    const token = `${b64({ alg: 'none' })}.${b64(claims())}.`;
    const result = await verifyShellAccessToken(token, configured);
    expect(result.ok).toBe(false);
  });
});
