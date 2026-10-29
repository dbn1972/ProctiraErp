/**
 * Test-only fixture (never imported by app code): a local RS256 JWKS plus
 * helpers to mint authentic, forged, unsigned and HMAC tokens for the
 * PRC-L254 / PRC-L545 / PRC-L265 shell verification tests.
 */
import { createHmac, generateKeyPairSync, sign as nodeSign, type KeyObject } from 'node:crypto';

export const TEST_ISSUER = 'https://idp.test/realms/proctira';
export const TEST_CLIENT_ID = 'proctira-gateway';
export const TEST_JWKS_URI = `${TEST_ISSUER}/protocol/openid-connect/certs`;

const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });

/** Env that turns shell verification on against {@link testJwksResponse}. */
export const TEST_JWKS_ENV = {
  KEYCLOAK_ISSUER: TEST_ISSUER,
  KEYCLOAK_CLIENT_ID: TEST_CLIENT_ID,
  KEYCLOAK_JWKS_URI: TEST_JWKS_URI,
} as const;

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** JWKS document containing only the trusted signing key. */
export function testJwksResponse(): Response {
  const jwk = { ...signing.publicKey.export({ format: 'jwk' }), kid: 'test-1', use: 'sig' };
  return new Response(JSON.stringify({ keys: [jwk] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Default authentic claims (Keycloak-shaped, `azp` = client id). */
export function testClaims(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: TEST_ISSUER,
    azp: TEST_CLIENT_ID,
    aud: 'account',
    sub: 'user-1',
    tenantId: 'tenant-a',
    email: 'user@tenant-a.test',
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: 'ROOT' }],
    iat: nowSeconds(),
    exp: nowSeconds() + 600,
    ...extra,
  };
}

function rs256(payload: Record<string, unknown>, key: KeyObject, kid = 'test-1'): string {
  const input = `${b64({ alg: 'RS256', typ: 'JWT', kid })}.${b64(payload)}`;
  return `${input}.${nodeSign('sha256', Buffer.from(input), key).toString('base64url')}`;
}

/** Token signed by the trusted JWKS key. */
export function signedToken(extra: Record<string, unknown> = {}): string {
  return rs256(testClaims(extra), signing.privateKey);
}

/** Same claims, signed by a key that is not in the JWKS. */
export function forgedToken(extra: Record<string, unknown> = {}): string {
  return rs256(testClaims(extra), attacker.privateKey);
}

/** `alg: none` token with an empty-looking signature segment. */
export function unsignedToken(extra: Record<string, unknown> = {}): string {
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(testClaims(extra))}.sig`;
}

/** HS256 token signed with an attacker-chosen secret. */
export function hmacToken(extra: Record<string, unknown> = {}): string {
  const input = `${b64({ alg: 'HS256', typ: 'JWT', kid: 'test-1' })}.${b64(testClaims(extra))}`;
  return `${input}.${createHmac('sha256', 'attacker-secret').update(input).digest('base64url')}`;
}

/** Authentic token whose payload was edited after signing. */
export function tamperedToken(extra: Record<string, unknown>): string {
  const [header, , signature] = signedToken().split('.');
  return `${header}.${b64(testClaims(extra))}.${signature}`;
}

/**
 * Wraps a fetch mock so JWKS requests are answered by the test JWKS and
 * everything else goes to `fallback`.
 */
export function withTestJwks(
  fallback: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === TEST_JWKS_URI) return testJwksResponse();
    return fallback(input, init);
  };
}
