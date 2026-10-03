/**
 * PRC-M501 — auth-domain audit trail.
 *
 * The generic mutation audit (mutation-audit.ts) deliberately skips
 * /api/v1/auth/*, so login, logout, refresh, ticket redemption and MFA left no
 * trace. This hook writes one audit row per auth request (actor, tenant, IP,
 * outcome). Routes are classified by `request.routeOptions.url` (the matched
 * route template, not the raw URL); any matched auth route that is not in the
 * table is still audited as `auth.other` (fail closed: no silent gaps).
 *
 * Payloads never contain OTP codes, phone numbers, passwords or tokens; only
 * the attempted login identifier (username/email) is kept for failed logins.
 */
import type { AuditOperation } from '@proctira/backend-audit';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export type AuthAuditAction =
  | 'auth.login.password'
  | 'auth.login.sso_start'
  | 'auth.login.sso_callback'
  | 'auth.ticket.redeem'
  | 'auth.refresh'
  | 'auth.logout'
  | 'auth.mfa.send'
  | 'auth.mfa.resend'
  | 'auth.mfa.verify'
  | 'auth.invite.create'
  | 'auth.other';

export type AuthAuditOutcome = 'success' | 'failure' | 'lockout' | 'revoked' | 'error';

const AUTH_PREFIXES = ['/api/v1/auth', '/auth'] as const;

const ACTIONS: Record<string, AuthAuditAction> = {
  'POST /password': 'auth.login.password',
  'GET /login': 'auth.login.sso_start',
  'GET /callback': 'auth.login.sso_callback',
  'GET /ticket': 'auth.ticket.redeem',
  'POST /refresh': 'auth.refresh',
  'GET /logout': 'auth.logout',
  'POST /logout': 'auth.logout',
  'POST /mfa/otp/send': 'auth.mfa.send',
  'POST /mfa/otp/resend': 'auth.mfa.resend',
  'POST /mfa/resend': 'auth.mfa.resend',
  'POST /mfa/verify': 'auth.mfa.verify',
};

/** Privileged invite routes mounted outside /api/v1 (not covered by mutation audit). */
const ROOT_ACTIONS: Record<string, AuthAuditAction> = {
  'POST /admin/users/invite': 'auth.invite.create',
  'POST /tenant/users/invite': 'auth.invite.create',
};

/** Read-only auth endpoints that carry no security event (catalogs, profile). */
const READ_ONLY_UNAUDITED = new Set(['GET /me', 'GET /roles', 'GET /tenants']);

/**
 * Classify a matched auth route. Returns null for non-auth routes and for
 * read-only catalog endpoints; unknown mutating auth routes map to `auth.other`.
 */
export function classifyAuthAuditAction(
  method: string,
  routeUrl: string | undefined,
): AuthAuditAction | null {
  if (!routeUrl) return null;
  const rootAction = ROOT_ACTIONS[`${method.toUpperCase()} ${routeUrl}`];
  if (rootAction) return rootAction;
  const prefix = AUTH_PREFIXES.find((p) => routeUrl === p || routeUrl.startsWith(`${p}/`));
  if (!prefix) return null;
  const key = `${method.toUpperCase()} ${routeUrl.slice(prefix.length) || '/'}`;
  const action = ACTIONS[key];
  if (action) return action;
  if (READ_ONLY_UNAUDITED.has(key) || method.toUpperCase() === 'GET') return null;
  if (method.toUpperCase() === 'OPTIONS' || method.toUpperCase() === 'HEAD') return null;
  return 'auth.other';
}

export function authAuditOutcome(statusCode: number, errorCode?: string): AuthAuditOutcome {
  if (statusCode === 429) return 'lockout';
  if (errorCode === 'KEYCLOAK_SESSION_REVOKED') return 'revoked';
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'failure';
  return 'success';
}

function operationFor(action: AuthAuditAction): AuditOperation {
  if (action === 'auth.logout') return 'DELETE';
  if (
    action === 'auth.login.password' ||
    action === 'auth.login.sso_callback' ||
    action === 'auth.invite.create'
  ) {
    return 'CREATE';
  }
  return 'UPDATE';
}

function parsePayload(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > 65_536) return null;
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(value: unknown, max = 256): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;
}

export type AuthAuditRecord = {
  tenantId: string;
  entityType: 'auth';
  entityId: AuthAuditAction;
  operation: AuditOperation;
  userId: string;
  userName: string;
  ipAddress: string;
  beforeValues: null;
  afterValues: null;
  metadata: Record<string, unknown>;
};

/** Build the audit row. Only identifiers and outcome; never secrets/codes/phones. */
export function buildAuthAuditRecord(
  request: FastifyRequest,
  action: AuthAuditAction,
  statusCode: number,
  payload: unknown,
): AuthAuditRecord {
  const body = parsePayload(payload);
  const responseUser =
    body && typeof body['user'] === 'object' && body['user']
      ? (body['user'] as Record<string, unknown>)
      : null;
  const reqUser = (request as FastifyRequest & { user?: Record<string, unknown> }).user;
  const reqBody =
    request.body && typeof request.body === 'object'
      ? (request.body as Record<string, unknown>)
      : {};

  const actorId =
    str(reqUser?.['sub']) ??
    str(reqUser?.['userId']) ??
    str(responseUser?.['userId']) ??
    'anonymous';
  // Attempted identifier for password logins only (needed to trace lockouts).
  const attempted =
    action === 'auth.login.password'
      ? (str(reqBody['username']) ?? str(reqBody['email']))
      : undefined;
  const tenantId =
    str(reqUser?.['tenantId']) ??
    str(responseUser?.['tenantId']) ??
    str((request as FastifyRequest & { tenantId?: string }).tenantId) ??
    'platform';
  const claimedTenant =
    str(request.headers['x-tenant-id'] as string | undefined, 64) ?? str(reqBody['tenantId'], 64);
  const errorCode = body && statusCode >= 400 ? str(body['code'], 64) : undefined;
  const outcome = authAuditOutcome(statusCode, errorCode);

  return {
    tenantId,
    entityType: 'auth',
    entityId: action,
    operation: operationFor(action),
    userId: actorId,
    userName: str(reqUser?.['email']) ?? str(responseUser?.['email']) ?? attempted ?? actorId,
    ipAddress: request.ip,
    beforeValues: null,
    afterValues: null,
    metadata: {
      action,
      outcome,
      statusCode,
      method: request.method,
      route: request.routeOptions?.url,
      ...(errorCode ? { errorCode } : {}),
      ...(attempted && actorId === 'anonymous' ? { attemptedIdentifier: attempted } : {}),
      // Unverified tenant hint (header/body) is kept as metadata only so a caller
      // cannot write rows into another tenant's audit chain.
      ...(tenantId === 'platform' && claimedTenant ? { claimedTenantId: claimedTenant } : {}),
      ...(request.headers['user-agent']
        ? { userAgent: String(request.headers['user-agent']).slice(0, 256) }
        : {}),
      requestId: request.id,
    },
  };
}

type AuditSink = { recordAudit: (input: AuthAuditRecord) => Promise<unknown> };

/**
 * Register the auth audit onSend hook. Audit-write failures are logged and do
 * not block sign-in (availability of login outranks the post-hoc trail here;
 * Keycloak keeps its own event log as a second record).
 */
export function registerAuthAudit(
  app: FastifyInstance,
  resolveSink: () => AuditSink | undefined = () =>
    (app as unknown as { auditService?: AuditSink }).auditService,
): void {
  app.addHook('onSend', async (request, reply, payload) => {
    const action = classifyAuthAuditAction(request.method, request.routeOptions?.url);
    if (!action) return payload;
    const record = buildAuthAuditRecord(request, action, reply.statusCode, payload);
    const sink = resolveSink();
    if (!sink) {
      request.log.error({ action }, 'auth audit sink missing (PRC-M501)');
      return payload;
    }
    try {
      await sink.recordAudit(record);
    } catch (err) {
      request.log.error({ err, action }, 'auth audit write failed (PRC-M501)');
    }
    return payload;
  });
}
