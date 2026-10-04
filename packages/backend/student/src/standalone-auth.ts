/**
 * PRC-L502 — fail-closed authentication for the standalone student service.
 *
 * The gateway normally verifies JWTs and binds tenant context. When the
 * student plugin is booted on its own (standalone-server.ts) nothing did, so
 * every child-PII route was reachable unauthenticated. This verifies the
 * gateway-issued HS256 access token with node:crypto (no new dependency) and
 * binds `request.user` / `request.tenantId` from the verified claims only.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface StandaloneJwtOptions {
  secret: string;
  issuer?: string;
  audience?: string;
  /** Clock override (seconds since epoch) for tests. */
  nowSeconds?: () => number;
}

export interface VerifiedClaims {
  sub: string;
  tenantId: string;
  roles: unknown[];
  [key: string]: unknown;
}

function b64urlDecode(part: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(part)) return null;
  return Buffer.from(part, 'base64url');
}

function parseJson(buf: Buffer | null): Record<string, unknown> | null {
  if (!buf) return null;
  try {
    const v = JSON.parse(buf.toString('utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === 'string') return aud === expected;
  return Array.isArray(aud) && aud.includes(expected);
}

/** Verify an HS256 JWT. Returns verified claims, or null on any failure. */
export function verifyHs256Jwt(token: string, opts: StandaloneJwtOptions): VerifiedClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = parseJson(b64urlDecode(h));
  if (!header || header['alg'] !== 'HS256') return null; // rejects alg=none / RS* confusion
  const sig = b64urlDecode(s);
  if (!sig) return null;
  const expected = createHmac('sha256', opts.secret).update(`${h}.${p}`).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  const claims = parseJson(b64urlDecode(p));
  if (!claims) return null;
  const now = opts.nowSeconds ? opts.nowSeconds() : Math.floor(Date.now() / 1000);
  if (typeof claims['exp'] !== 'number' || claims['exp'] <= now) return null;
  if (typeof claims['nbf'] === 'number' && claims['nbf'] > now) return null;
  if (opts.issuer && claims['iss'] !== opts.issuer) return null;
  if (opts.audience && !audienceMatches(claims['aud'], opts.audience)) return null;
  if (typeof claims['sub'] !== 'string' || !claims['sub']) return null;
  if (typeof claims['tenantId'] !== 'string' || !UUID.test(claims['tenantId'])) return null;
  return {
    ...claims,
    sub: claims['sub'],
    tenantId: claims['tenantId'],
    roles: Array.isArray(claims['roles']) ? claims['roles'] : [],
  };
}

const PUBLIC_PATHS = new Set(['/health', '/ready', '/metrics']);

/**
 * Register a global onRequest hook: every non-probe request needs a valid
 * Bearer token. Tenant comes only from the verified token (never a header).
 */
export function registerStandaloneAuth(app: FastifyInstance, opts: StandaloneJwtOptions): void {
  if (!opts.secret || opts.secret.length < 32) {
    throw new Error(
      'Standalone student service requires JWT_SECRET (>= 32 chars); refusing to start',
    );
  }
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0] ?? '';
    if (PUBLIC_PATHS.has(path)) return;
    const auth = request.headers.authorization;
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const claims = token ? verifyHs256Jwt(token, opts) : null;
    if (!claims) {
      return reply
        .status(401)
        .send({ code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 });
    }
    (request as unknown as { user: VerifiedClaims }).user = claims;
    (request as unknown as { tenantId: string }).tenantId = claims.tenantId;
  });
}
