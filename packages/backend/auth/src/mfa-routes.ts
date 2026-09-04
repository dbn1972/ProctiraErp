/**
 * MFA / SMS OTP routes.
 *
 * POST /auth/mfa/otp/send   — issue an SMS OTP challenge
 * POST /auth/mfa/otp/resend — rotate a challenge and re-send SMS
 * POST /auth/mfa/verify     — verify TOTP or SMS OTP (method=sms)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  OtpAuthError,
  OtpService,
  OtpValidationError,
} from './otp-service.js';
import type { TokenService } from './token-service.js';
import type { SessionService } from './session-service.js';
import type { UserLookup } from './routes.js';

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
}

type SendBody = {
  userId?: string;
  email?: string;
  phone?: string;
  tenantId?: string;
  mfaToken?: string;
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
      const tenantId =
        body.tenantId ??
        (request as FastifyRequest & { tenantId?: string }).tenantId ??
        '';
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      let phone = body.phone?.trim() ?? '';
      let userId = body.userId?.trim() ?? '';

      if (!phone && resolvePhone) {
        phone =
          (await resolvePhone({
            userId: body.userId,
            email: body.email,
            tenantId,
          })) ?? '';
      }

      if (!userId && body.email && userLookup) {
        const user = await userLookup.findByUsername(body.email, tenantId);
        if (user) userId = user.id;
      }

      if (!userId) {
        // Anonymous challenge still needs a stable user key for the store;
        // use a synthetic id derived from phone when identity is unknown.
        userId = `phone:${phone || 'unknown'}`;
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
          const tokens = await tokenService.issueTokenPair(
            authUser,
            session.id,
            request.ip,
          );
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

        // Gateway / Keycloak path: challenge verified; caller completes login.
        return reply.status(200).send({
          success: true,
          method: 'sms',
          userId: verified.userId,
          tenantId: verified.tenantId,
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
  if (error instanceof OtpAuthError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
    });
  }
  throw error;
}
