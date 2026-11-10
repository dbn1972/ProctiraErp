/**
 * PRC-M497 — pre-MFA ticket.
 *
 * After the primary factor succeeds and the user's policy requires a second
 * factor, the login handler mints a short-lived HMAC-signed ticket naming the
 * authenticated `{userId, tenantId}`. `/auth/mfa/otp/send` and
 * `/auth/mfa/verify` require it (header `x-pre-mfa-ticket` or body
 * `preMfaTicket`), so an OTP challenge is always bound to a real login and
 * client-supplied identity fields are never trusted.
 *
 * The key is purpose-specific (`MFA_PRE_TICKET_SECRET`, topic 2: one secret per
 * purpose); `JWT_SECRET` is never used for it.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { isDeployedEnvironment } from '@proctira/common/node-env';
import type { FastifyRequest } from 'fastify';

/** Identity the primary factor established. */
export interface PreMfaPrincipal {
  userId: string;
  tenantId: string;
}

export interface PreMfaTicketCodec {
  readonly ttlSeconds: number;
  mint(principal: PreMfaPrincipal): string;
  /** Null when the ticket is absent, malformed, forged or expired. */
  verify(ticket: string | undefined): PreMfaPrincipal | null;
}

/** Default lifetime: long enough to receive and type an SMS code. */
export const DEFAULT_PRE_MFA_TICKET_TTL_SECONDS = 300;
export const MIN_PRE_MFA_TICKET_SECRET_LENGTH = 32;
export const PRE_MFA_TICKET_HEADER = 'x-pre-mfa-ticket';

const PREFIX = 'pmt1';
const MAX_TICKET_LENGTH = 1024;

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`${PREFIX}.${payload}`).digest('base64url');
}

export function createPreMfaTicketCodec(options: {
  secret: string;
  ttlSeconds?: number;
  now?: () => number;
}): PreMfaTicketCodec {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_PRE_MFA_TICKET_TTL_SECONDS;
  const now = options.now ?? Date.now;
  return {
    ttlSeconds,
    mint(principal) {
      const iat = Math.floor(now() / 1000);
      const payload = Buffer.from(
        JSON.stringify({
          sub: principal.userId,
          tid: principal.tenantId,
          iat,
          exp: iat + ttlSeconds,
          jti: randomBytes(12).toString('base64url'),
        }),
      ).toString('base64url');
      return `${PREFIX}.${payload}.${sign(options.secret, payload)}`;
    },
    verify(ticket) {
      if (typeof ticket !== 'string' || ticket.length > MAX_TICKET_LENGTH) return null;
      const parts = ticket.split('.');
      if (parts.length !== 3 || parts[0] !== PREFIX) return null;
      const [, payload, sig] = parts as [string, string, string];
      const expected = Buffer.from(sign(options.secret, payload));
      const given = Buffer.from(sig);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      let claims: { sub?: unknown; tid?: unknown; exp?: unknown };
      try {
        claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof claims;
      } catch {
        return null;
      }
      if (typeof claims.sub !== 'string' || !claims.sub) return null;
      if (typeof claims.tid !== 'string' || !claims.tid) return null;
      if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(now() / 1000)) return null;
      return { userId: claims.sub, tenantId: claims.tid };
    },
  };
}

/** Read the ticket from `x-pre-mfa-ticket` or the JSON body `preMfaTicket`. */
export function readPreMfaTicket(request: FastifyRequest): string | undefined {
  const header = request.headers[PRE_MFA_TICKET_HEADER];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const body = request.body as { preMfaTicket?: unknown } | undefined;
  return typeof body?.preMfaTicket === 'string' && body.preMfaTicket.trim()
    ? body.preMfaTicket.trim()
    : undefined;
}

/**
 * Build the codec from `MFA_PRE_TICKET_SECRET`.
 * - Deployed + set: at least 32 chars and different from `JWT_SECRET`, else throw (boot refused).
 * - Deployed + unset: null — no ticket is minted or accepted, so OTP send stays fail-closed (401).
 * - Development / test + unset: a per-process random key.
 */
export function createPreMfaTicketCodecFromEnv(
  processEnv: NodeJS.ProcessEnv = process.env,
): PreMfaTicketCodec | null {
  const secret = processEnv['MFA_PRE_TICKET_SECRET']?.trim() ?? '';
  const deployed = isDeployedEnvironment(processEnv['NODE_ENV'], processEnv);
  if (!secret) {
    return deployed ? null : createPreMfaTicketCodec({ secret: randomBytes(32).toString('hex') });
  }
  if (deployed) {
    if (secret.length < MIN_PRE_MFA_TICKET_SECRET_LENGTH) {
      throw new Error(
        `MFA_PRE_TICKET_SECRET must be at least ${MIN_PRE_MFA_TICKET_SECRET_LENGTH} characters in a deployed environment (PRC-M497)`,
      );
    }
    if (secret === processEnv['JWT_SECRET']?.trim()) {
      throw new Error('MFA_PRE_TICKET_SECRET must not reuse JWT_SECRET (PRC-M497)');
    }
  }
  return createPreMfaTicketCodec({ secret });
}
