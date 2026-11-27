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
 * UATENV-D36: rows name the actor by user id and tenant only. They never
 * contain OTP codes, phone numbers, passwords, tokens, emails, login
 * identifiers or user agents. The client IP stays: the audit schema requires
 * it, as for every other audit row.
 *
 * UATENV-D36: a row is written only for a tenant UUID from a verified source
 * (the verified request JWT, or the user / access token the gateway itself
 * returns). `audit_log_entries.tenant_id` is a uuid with a foreign key to
 * tenants (db/sql/100), so platform-operator (`platform`) and anonymous events
 * are written to the gateway log as one structured line instead. Successful
 * refreshes are written at most once per user per hour per gateway replica.
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

/**
 * UATENV-D36: each row records a new auth event, so it is a CREATE; logout ends
 * a session (DELETE). UPDATE requires before/after values, which an auth event
 * does not have, so AuditService refused every login/ticket/refresh row.
 */
function operationFor(action: AuthAuditAction): AuditOperation {
  return action === 'auth.logout' ? 'DELETE' : 'CREATE';
}

/** Any RFC 4122 layout (seeded and real tenant ids are not all version 4). */
const TENANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the audit store can hold rows for this tenant id. */
export function isAuditTenantId(tenantId: string): boolean {
  return TENANT_UUID.test(tenantId);
}

/**
 * Claims of the access token in the gateway's own response body. The gateway
 * obtained it from the IdP over the back channel (or from its own ticket
 * store), so only the subject and tenant are read from it; it is never used to
 * authorise anything.
 */
function issuedTokenClaims(body: Record<string, unknown> | null): Record<string, unknown> | null {
  const token = body ? body['accessToken'] : undefined;
  if (typeof token !== 'string') return null;
  const segment = token.split('.')[1];
  if (!segment) return null;
  try {
    const claims = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Single-valued tenant claim (`tenant_id` from Keycloak, or `tenantId`). */
function claimTenant(claims: Record<string, unknown> | null): string | undefined {
  if (!claims) return undefined;
  const raw = claims['tenant_id'] ?? claims['tenantId'];
  const value: unknown = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
  return str(value, 64);
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
  /** The user id again: no display name or email (UATENV-D36). */
  userName: string;
  ipAddress: string;
  beforeValues: null;
  afterValues: null;
  metadata: Record<string, unknown>;
};

/** Build the audit row. Only user id, tenant, IP and outcome (UATENV-D36). */
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
  const issued = statusCode < 400 ? issuedTokenClaims(body) : null;

  // The IdP subject, as on every authenticated request (request.user.sub).
  const actorId =
    str(reqUser?.['sub']) ??
    str(reqUser?.['userId']) ??
    str(issued?.['sub']) ??
    str(responseUser?.['userId']) ??
    'anonymous';
  const tenantId =
    str(reqUser?.['tenantId']) ??
    str(responseUser?.['tenantId']) ??
    claimTenant(issued) ??
    str((request as FastifyRequest & { tenantId?: string }).tenantId) ??
    'platform';
  const errorCode = body && statusCode >= 400 ? str(body['code'], 64) : undefined;
  const outcome = authAuditOutcome(statusCode, errorCode);

  return {
    tenantId,
    entityType: 'auth',
    entityId: action,
    operation: operationFor(action),
    userId: actorId,
    userName: actorId,
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
      requestId: request.id,
    },
  };
}

type AuditSink = { recordAudit: (input: AuthAuditRecord) => Promise<unknown> };

/** UATENV-D36: at most one successful-refresh row per user in this window. */
export const REFRESH_AUDIT_INTERVAL_MS = 60 * 60 * 1000;
/** Bound on the per-replica refresh throttle state. */
const REFRESH_AUDIT_MAX_TRACKED = 10_000;

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
  const lastRefreshRow = new Map<string, number>();
  /** Claims the refresh slot for `key`; false while a row is inside the window. */
  const refreshRowDue = (key: string, now: number): boolean => {
    const last = lastRefreshRow.get(key);
    if (last !== undefined && now - last < REFRESH_AUDIT_INTERVAL_MS) return false;
    lastRefreshRow.delete(key);
    if (lastRefreshRow.size >= REFRESH_AUDIT_MAX_TRACKED) {
      for (const [k, at] of lastRefreshRow) {
        if (now - at >= REFRESH_AUDIT_INTERVAL_MS) lastRefreshRow.delete(k);
      }
      // Still full: drop the oldest entry (Map keeps insertion order).
      const oldest = lastRefreshRow.keys().next();
      if (lastRefreshRow.size >= REFRESH_AUDIT_MAX_TRACKED && !oldest.done) {
        lastRefreshRow.delete(oldest.value);
      }
    }
    lastRefreshRow.set(key, now);
    return true;
  };

  app.addHook('onSend', async (request, reply, payload) => {
    const action = classifyAuthAuditAction(request.method, request.routeOptions?.url);
    if (!action) return payload;
    const record = buildAuthAuditRecord(request, action, reply.statusCode, payload);
    const outcome = record.metadata['outcome'];
    if (!isAuditTenantId(record.tenantId)) {
      // UATENV-D36: no tenant audit chain for platform-operator or anonymous
      // events; one structured line, no identifiers beyond user id and tenant.
      request.log.info(
        {
          authAudit: {
            action,
            outcome,
            statusCode: reply.statusCode,
            userId: record.userId,
            tenantId: record.tenantId,
            requestId: request.id,
          },
        },
        'auth event without a tenant audit chain (UATENV-D36)',
      );
      return payload;
    }
    const refreshKey =
      action === 'auth.refresh' && outcome === 'success'
        ? `${record.tenantId}:${record.userId}`
        : null;
    if (refreshKey && !refreshRowDue(refreshKey, Date.now())) return payload;
    const sink = resolveSink();
    if (!sink) {
      request.log.error({ action }, 'auth audit sink missing (PRC-M501)');
      return payload;
    }
    try {
      await sink.recordAudit(record);
    } catch (err) {
      if (refreshKey) lastRefreshRow.delete(refreshKey);
      request.log.error({ err, action }, 'auth audit write failed (PRC-M501)');
    }
    return payload;
  });
}
