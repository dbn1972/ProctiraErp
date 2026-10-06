/**
 * PRC-M030: authentication + tenant binding for the standalone etl-worker.
 *
 * The worker used to rely on hooks that only exist in the API gateway, so its
 * `/api/v1/pipelines` routes had no authentication. This hook verifies the same
 * platform access token the gateway issues (HS256, `JWT_SECRET` with
 * `JWT_SECRET_PREVIOUS` rotation, `JWT_ISSUER`, `JWT_AUDIENCE`) and binds the
 * tenant only from the verified `tenantId` claim — never from headers.
 *
 * Fail closed: no secret configured → every protected request is 401, and
 * production startup refuses to build without a secret.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLOCK_SKEW_SECONDS = 30;

export interface EtlAuthConfig {
  secrets: string[];
  issuer: string;
  audience: string;
}

export interface VerifiedEtlUser {
  sub: string;
  tenantId: string;
  roles: unknown[];
  [claim: string]: unknown;
}

/** Read the verifier config from the environment (same variables as the gateway). */
export function readEtlAuthConfig(env: NodeJS.ProcessEnv = process.env): EtlAuthConfig {
  const secrets = [env['JWT_SECRET'], env['JWT_SECRET_PREVIOUS']]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
  if (secrets.length === 0 && env['NODE_ENV'] === 'production') {
    throw new Error('etl-worker: JWT_SECRET is required in production (PRC-M030).');
  }
  return {
    secrets,
    issuer: env['JWT_ISSUER'] || 'proctira-platform',
    audience: env['JWT_AUDIENCE'] || 'proctira-api',
  };
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function signatureMatches(data: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(data).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function audienceMatches(aud: unknown, expected: string): boolean {
  return aud === expected || (Array.isArray(aud) && aud.includes(expected));
}

/** Verify a compact HS256 JWT; returns the verified user or null. */
export function verifyEtlToken(
  token: string,
  config: EtlAuthConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifiedEtlUser | null {
  if (config.secrets.length === 0) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = decodeSegment(h);
  if (!header || header['alg'] !== 'HS256') return null;
  if (!config.secrets.some((secret) => signatureMatches(`${h}.${p}`, s, secret))) return null;
  const claims = decodeSegment(p);
  if (!claims) return null;
  if (typeof claims['exp'] !== 'number' || claims['exp'] + CLOCK_SKEW_SECONDS < nowSeconds) {
    return null;
  }
  if (typeof claims['nbf'] === 'number' && claims['nbf'] - CLOCK_SKEW_SECONDS > nowSeconds) {
    return null;
  }
  if (claims['iss'] !== config.issuer || !audienceMatches(claims['aud'], config.audience)) {
    return null;
  }
  const sub = claims['sub'];
  const tenantId = claims['tenantId'];
  if (typeof sub !== 'string' || !sub) return null;
  if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) return null;
  return {
    ...claims,
    sub,
    tenantId,
    roles: Array.isArray(claims['roles']) ? (claims['roles'] as unknown[]) : [],
  };
}

/** Fastify onRequest hook: 401 unless a verified token binds the tenant. */
export function createEtlAuthHook(config: EtlAuthConfig) {
  return async function etlAuthHook(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization;
    const token = typeof header === 'string' && /^Bearer /i.test(header) ? header.slice(7) : '';
    const user = token ? verifyEtlToken(token.trim(), config) : null;
    if (!user) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'A valid platform access token is required',
        statusCode: 401,
      });
    }
    // Without a tenantId 200 is impossible: the routes answer 400 TENANT_REQUIRED.
    const req = request as unknown as { user?: unknown; tenantId?: string };
    req.user = user;
    req.tenantId = user.tenantId;
  };
}
