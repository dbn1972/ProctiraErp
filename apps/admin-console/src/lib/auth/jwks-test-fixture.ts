/**
 * Test-only fixture (never imported by app code): local RS256 JWKS and token
 * minting for the PRC-L202 / PRC-M464 console verification tests.
 */
import { createHmac, generateKeyPairSync, sign as nodeSign, type KeyObject } from 'node:crypto';

export const TEST_ISSUER = 'https://idp.test/realms/proctira';
export const TEST_CLIENT_ID = 'proctira-gateway';
export const TEST_JWKS_URI = `${TEST_ISSUER}/protocol/openid-connect/certs`;

export const TEST_JWKS_ENV = {
  KEYCLOAK_ISSUER: TEST_ISSUER,
  KEYCLOAK_CLIENT_ID: TEST_CLIENT_ID,
  KEYCLOAK_JWKS_URI: TEST_JWKS_URI,
} as const;

const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const nowSeconds = () => Math.floor(Date.now() / 1000);

export function testJwksResponse(): Response {
  const jwk = { ...signing.publicKey.export({ format: 'jwk' }), kid: 'test-1', use: 'sig' };
  return new Response(JSON.stringify({ keys: [jwk] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Authentic platform-operator claims. */
export function operatorClaims(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: TEST_ISSUER,
    azp: TEST_CLIENT_ID,
    sub: 'op-1',
    email: 'ops@proctira.test',
    tenantId: 'platform',
    roles: ['platform_admin'],
    iat: nowSeconds(),
    exp: nowSeconds() + 600,
    ...extra,
  };
}

function rs256(payload: Record<string, unknown>, key: KeyObject): string {
  const input = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'test-1' })}.${b64(payload)}`;
  return `${input}.${nodeSign('sha256', Buffer.from(input), key).toString('base64url')}`;
}

export function signedToken(extra: Record<string, unknown> = {}): string {
  return rs256(operatorClaims(extra), signing.privateKey);
}

export function forgedToken(extra: Record<string, unknown> = {}): string {
  return rs256(operatorClaims(extra), attacker.privateKey);
}

export function unsignedToken(extra: Record<string, unknown> = {}): string {
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(operatorClaims(extra))}.sig`;
}

export function hmacToken(extra: Record<string, unknown> = {}): string {
  const input = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(operatorClaims(extra))}`;
  return `${input}.${createHmac('sha256', 'attacker').update(input).digest('base64url')}`;
}

/** Fetch mock answering the JWKS URI and delegating everything else. */
export function withTestJwks(
  fallback: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === TEST_JWKS_URI) return testJwksResponse();
    return fallback(input, init);
  };
}
