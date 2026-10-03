/**
 * MFA / SMS OTP routes.
 *
 * POST /auth/mfa/otp/send   — issue an SMS OTP challenge
 * POST /auth/mfa/otp/resend — rotate a challenge and re-send SMS
 * POST /auth/mfa/verify     — verify TOTP or SMS OTP (method=sms)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { OtpAuthError, OtpRateLimitError, OtpValidationError } from './otp-service.js';
import type { OtpService } from './otp-service.js';
import type { UserLookup } from './routes.js';
import type { SessionService } from './session-service.js';
import type { TokenService } from './token-service.js';

export interface MfaRoutesOptions {
  otpService: OtpService;
  /** Optional: issue tokens after successful SMS verify (legacy local auth). */
  tokenService?: TokenService;
  sessionService?: SessionService;
  userLookup?: UserLookup;
  /** Prefix (default: '/auth') — gateway mounts under /api/v1 via rewrite. */
  prefix?: string;
  /**
   * Resolve phone for a user when the client only sends userId/email.
   * When omitted, the client must supply `phone` on send.
   */
  resolvePhone?: (input: {
    userId?: string;
    email?: string;
    tenantId: string;
  }) => Promise<string | null>;
  /**
   * PRC-M497: resolve the server-side primary-auth step (password / IdP
   * success) that this OTP challenge completes — e.g. by verifying a
   * short-lived pre-MFA ticket minted by the login handler. The challenge is
   * bound to the returned identity; client-supplied userId/email/phone/tenantId
   * are ignored. When omitted, `/mfa/otp/send` fails closed with 401.
   */
  resolvePrimaryAuth?: (request: FastifyRequest) => Promise<PrimaryAuthContext | null>;
  /**
   * PRC-M497: on the non-token path, mint an opaque login-completion ticket for
   * the verified challenge. The verify response never carries a bare userId.
   */
  issueCompletionTicket?: (verified: PrimaryAuthContext) => Promise<string>;
}

/** Identity established by the primary authentication factor. */
export interface PrimaryAuthContext {
  userId: string;
  tenantId: string;
}

/**
 * PRC-M497: identity/phone fields are no longer accepted from the client; the
 * challenge is bound to {@link MfaRoutesOptions.resolvePrimaryAuth}. Only
 * `tenantId` is read, and only to reject a mismatch with the host tenant.
 */
type SendBody = {
  tenantId?: string;
};

type VerifyBody = {
  mfaToken?: string;
  code?: string;
  method?: string;
};

type ResendBody = {
  mfaToken?: string;
};

export async function registerMfaRoutes(
  fastify: FastifyInstance,
  options: MfaRoutesOptions,
): Promise<void> {
  const {
    otpService,
    tokenService,
    sessionService,
    userLookup,
    prefix = '/auth',
    resolvePhone,
    resolvePrimaryAuth,
    issueCompletionTicket,
  } = options;

  /**
   * POST /auth/mfa/otp/send
   * Start an SMS OTP challenge for the given user/phone.
   */
  fastify.post(
    `${prefix}/mfa/otp/send`,
    async function sendOtpHandler(
      request: FastifyRequest<{ Body: SendBody }>,
      reply: FastifyReply,
    ) {
      const body = request.body ?? {};
      const hostTenantId = (request as FastifyRequest & { tenantId?: string }).tenantId ?? '';
      // PRC-M497: the tenant comes from the host, never the body. A differing
      // body.tenantId is an explicit cross-tenant attempt and is rejected.
      if (body.tenantId && hostTenantId && body.tenantId !== hostTenantId) {
        return reply.status(400).send({
          code: 'TENANT_MISMATCH',
          message: 'Tenant does not match the request host',
          statusCode: 400,
        });
      }
      const primary = resolvePrimaryAuth ? await resolvePrimaryAuth(request) : null;
      if (!primary) {
        return reply.status(401).send({
          code: 'PRIMARY_AUTH_REQUIRED',
          message: 'Sign in with your primary credentials before requesting a code',
          statusCode: 401,
        });
      }
      const tenantId = primary.tenantId;
      if (!tenantId || (hostTenantId && tenantId !== hostTenantId)) {
        return reply.status(403).send({
          code: 'TENANT_MISMATCH',
          message: 'Tenant does not match the request host',
          statusCode: 403,
        });
      }
      const userId = primary.userId;
      // Phone is resolved server-side from the user record only.
      const phone = resolvePhone ? ((await resolvePhone({ userId, tenantId })) ?? '') : '';
      if (!phone) {
        return reply.status(400).send({
          code: 'MFA_PHONE_UNAVAILABLE',
          message: 'No verified phone number is registered for SMS verification',
          statusCode: 400,
        });
      }
      try {
        const result = await otpService.sendChallenge({ userId, tenantId, phone });
        return reply.status(200).send(result);
      } catch (error: unknown) {
        return sendOtpError(reply, error);
      }
    },
  );

  /**
   * POST /auth/mfa/otp/resend  (also aliased as /auth/mfa/resend)
   */
  const resendHandler = async function resendOtpHandler(
    request: FastifyRequest<{ Body: ResendBody }>,
    reply: FastifyReply,
  ) {
    const mfaToken = request.body?.mfaToken?.trim() ?? '';
    if (!mfaToken) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'mfaToken is required',
        statusCode: 400,
      });
    }
    try {
      const result = await otpService.resendChallenge(mfaToken);
      return reply.status(200).send(result);
    } catch (error: unknown) {
      return sendOtpError(reply, error);
    }
  };

  fastify.post(`${prefix}/mfa/otp/resend`, resendHandler);
  fastify.post(`${prefix}/mfa/resend`, resendHandler);

  /**
   * POST /auth/mfa/verify
   * Verify an MFA code. When method=sms (default for SMS challenges), validates
   * against the hashed OTP store. Other methods can be added later (TOTP).
   */
  fastify.post(
    `${prefix}/mfa/verify`,
    async function verifyMfaHandler(
      request: FastifyRequest<{ Body: VerifyBody }>,
      reply: FastifyReply,
    ) {
      const mfaToken = request.body?.mfaToken?.trim() ?? '';
      const code = request.body?.code?.trim() ?? '';
      const method = (request.body?.method ?? 'sms').toLowerCase();

      if (!mfaToken || !code) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'mfaToken and code are required',
          statusCode: 400,
        });
      }

      if (method !== 'sms') {
        return reply.status(400).send({
          code: 'UNSUPPORTED_MFA_METHOD',
          message: `MFA method '${method}' is not supported by this endpoint`,
          statusCode: 400,
        });
      }

      try {
        const verified = await otpService.verifyChallenge({ mfaToken, code });

        // When token infrastructure is wired, issue a full session.
        if (tokenService && sessionService && userLookup) {
          const user = await userLookup.findById(verified.userId, verified.tenantId);
          if (!user || !user.isActive) {
            return reply.status(401).send({
              code: 'ACCOUNT_INACTIVE',
              message: 'Account is inactive',
              statusCode: 401,
            });
          }
          const session = await sessionService.createSession(user.id, user.tenantId, {
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
          });
          const authUser = {
            userId: user.id,
            tenantId: user.tenantId,
            email: user.email,
            displayName: user.displayName,
            roles: user.roles,
            areas: user.areas,
            institutions: user.institutions,
          };
          const tokens = await tokenService.issueTokenPair(authUser, session.id, request.ip);
          return reply.status(200).send({
            success: true,
            method: 'sms',
            tokens,
            session: {
              id: session.id,
              expiresAt: session.expiresAt.toISOString(),
            },
          });
        }

        // Gateway / Keycloak path: challenge verified; caller completes login
        // with an opaque completion ticket (PRC-M497: never a bare userId).
        const completionTicket = issueCompletionTicket
          ? await issueCompletionTicket({ userId: verified.userId, tenantId: verified.tenantId })
          : undefined;
        return reply.status(200).send({
          success: true,
          method: 'sms',
          ...(completionTicket ? { completionTicket } : {}),
        });
      } catch (error: unknown) {
        return sendOtpError(reply, error);
      }
    },
  );
}

function sendOtpError(reply: FastifyReply, error: unknown) {
  if (error instanceof OtpValidationError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
    });
  }
  if (error instanceof OtpRateLimitError) {
    return reply.status(429).send({
      code: error.code,
      message: error.message,
      statusCode: 429,
    });
  }
  if (error instanceof OtpAuthError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
    });
  }
  throw error;
}
