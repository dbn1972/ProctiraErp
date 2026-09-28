/**
 * POST/DELETE /api/dashboard/preview-state
 *
 * Task 9.1 (`principal-dashboard-parity`) — sets or clears the
 * `Dashboard-Preview-State` cookie that drives the dashboard home page's
 * fabricated preview states (Requirement 6). Both verbs are gated by the
 * same `dashboard-preview:manage` permission check used by the read-side
 * resolver (`resolvePreviewOverride`, Task 7.2, `@/lib/dashboard/resolvePreviewOverride`)
 * — cookie presence, and any client-side visibility of the switcher
 * control, are never a substitute for this server-side check (Req 6 AC12,
 * Req 7 AC4). The check itself lives in `@/lib/dashboard/previewStatePermission`
 * (extracted in this task) so both this route and the resolver re-run the
 * identical session→permission decision rather than each re-deriving it.
 *
 * Audit logging on every set/clear (Req 6 AC13, Task 9.2) is handled by
 * {@link recordPreviewStateAudit} below — see its doc comment for why that
 * is a best-effort gateway call rather than a direct database write.
 *
 * DELETE is gated by the same permission check as POST (tasks.md's own
 * task description: "Gate both with the dashboard-preview:manage
 * permission check server-side"), rather than letting an unpermissioned
 * caller clear the cookie unconditionally. The scenario that might argue
 * for a looser DELETE rule — a permission revoked while a preview is
 * active — is already handled on the read side: `resolvePreviewOverride()`
 * re-checks the permission on every call, so a caller who has lost the
 * permission already sees no fabricated state regardless of what their
 * cookie still contains. Gating DELETE the same way as POST costs that
 * caller nothing but the cookie's own `PREVIEW_STATE_MAX_AGE_SECONDS`
 * expiry (at most 30 minutes) before it disappears on its own, and keeps
 * one uniform authorization rule for the whole mechanism instead of two.
 *
 * Cookie attributes follow `Dashboard-Preview-State`'s documented shape
 * (`@/lib/dashboard/previewStateCookie`): `Path=/`, `SameSite=Lax`,
 * `Max-Age=PREVIEW_STATE_MAX_AGE_SECONDS` (0 to clear), `Secure` in
 * production. `Secure` is resolved via `isSecureCookieContext()`
 * (`@/lib/auth/cookies`) — the same helper every other cookie-writing route
 * in this app uses — rather than a bare `process.env.NODE_ENV` check, since
 * it also correctly promotes to `Secure` behind a TLS-terminating proxy and
 * honours the existing `COOKIE_SECURE` operator override; it still returns
 * `true` whenever `NODE_ENV==='production'`. `httpOnly` is explicitly
 * `false`: the switcher UI's `readActivePreviewStateFromBrowser()` reads
 * this cookie via `document.cookie` to highlight the active state without a
 * round trip, which an httpOnly cookie would make impossible.
 */
import { NextResponse } from 'next/server';

import { gatewayFetch } from '@/lib/api/gateway';
import { isSecureCookieContext } from '@/lib/auth/cookies';
import { getSession } from '@/lib/auth/server';
import {
  PREVIEW_STATE_COOKIE_NAME,
  PREVIEW_STATE_MAX_AGE_SECONDS,
  PREVIEW_STATES,
  encodePreviewStateCookieValue,
  type PreviewState,
} from '@/lib/dashboard/previewStateCookie';
import { hasDashboardPreviewPermission } from '@/lib/dashboard/previewStatePermission';

function isPreviewState(value: unknown): value is PreviewState {
  return typeof value === 'string' && (PREVIEW_STATES as readonly string[]).includes(value);
}

/** Shared 403 for both "no session" and "session lacks the permission". */
function forbidden(): NextResponse {
  return NextResponse.json(
    { code: 'FORBIDDEN', message: 'Insufficient permissions.' },
    { status: 403 },
  );
}

/**
 * Resolves the caller's session and re-checks `dashboard-preview:manage`
 * fresh against their actual roles — same decision `resolvePreviewOverride`
 * makes on the read side. Returns `false` for no session, an expired
 * session, or a session that lacks the permission; every one of those maps
 * to the same 403 per this task's explicit requirement (unauthenticated and
 * unauthorized are not distinguished here, unlike some other routes in this
 * app that return 401 vs 403 — the task calls for 403 in both cases).
 */
async function isAuthorizedForPreviewStateMutation(): Promise<boolean> {
  const session = await getSession();
  if (!session || session.isExpired) return false;
  return hasDashboardPreviewPermission(session);
}

/**
 * Task 9.2 (Req 6.13) — best-effort audit call for a preview-state set/clear.
 *
 * `apps/web` has no dependency on `@proctira/database` or
 * `@proctira/backend-audit` (by design — the BFF boundary every other route
 * in this app respects) and so cannot call `appendAuditEntryOnClient` /
 * `withPgTenant` directly, as the task's literal wording describes. Those
 * only exist inside `packages/backend/*`/`apps/api-gateway`.
 *
 * The gateway already has a global mechanism for exactly this: `app.ts`'s
 * `onSend` hook (`persistMutationAudit`, `apps/api-gateway/src/mutation-audit.ts`)
 * writes an `audit_log_entries` row for every successful mutating `/api/v1/*`
 * request, with no per-route code required (`audit-mount.test.ts` proves
 * this for `POST /api/v1/students`). `POST/DELETE /api/v1/dashboard-preview`
 * (`apps/api-gateway/src/domain-plugins.ts`'s `dashboard-preview` registrar)
 * is a small stateless endpoint that exists solely to be that audited
 * mutation — this function is what actually calls it.
 *
 * Best-effort, not blocking: a failed audit call logs server-side and does
 * NOT fail the request — the cookie is still set/cleared either way. Two
 * reasons, both from Requirement 6.13's own framing of this mechanism as
 * forcing a "production-capable surface" into a fabricated state:
 *   1. An unaudited-but-working preview switcher is a strictly smaller
 *      problem than a broken one — the whole point of Requirement 6 is a
 *      safe, reversible demo/QA tool; making it fail shut on an audit outage
 *      would let an unrelated gateway hiccup block a principal from getting
 *      their real dashboard back (DELETE) or from demoing a state (POST).
 *   2. The audit call is deliberately side-effect-free scaffolding (no
 *      domain state of its own), unlike the health-records writes
 *      `packages/backend/health/src/routes.ts` guards with fail-closed
 *      security-sensitive-mutation semantics (`mutation-audit.ts`'s
 *      `shouldFailClosedOnMutationAuditFailure`) — those protect PHI/money
 *      writes that must not be acknowledged without a durable trail. This
 *      cookie is neither; it never touches another tenant's data or anyone
 *      else's session (Req 6 AC1, AC8, AC11).
 *
 * Never throws — any network/gateway failure is caught and logged.
 */
async function recordPreviewStateAudit(operation: 'set' | 'clear'): Promise<void> {
  try {
    const result = await gatewayFetch('/dashboard-preview', {
      method: operation === 'set' ? 'POST' : 'DELETE',
      throwOnError: false,
    });
    if (!result.ok) {
      // eslint-disable-next-line no-console -- apps/web has no logger of its
      // own (see the same rationale in tenant/branding/route.ts); this is
      // the only record of an audit-call failure that would otherwise be
      // silent, since the cookie mutation itself still succeeds below.
      console.error(
        `[api/dashboard/preview-state] audit ${operation} call failed (status ${result.status}):`,
        result.error?.message ?? 'unknown error',
      );
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `[api/dashboard/preview-state] audit ${operation} call threw:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/** Cookie options common to both the set and the clear paths. */
function previewStateCookieOptions(
  request: Request,
  maxAge: number,
): {
  httpOnly: false;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: false,
    secure: isSecureCookieContext(request),
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

/**
 * POST /api/dashboard/preview-state
 *
 * Body: `{ state: PreviewState }`. On success, sets `Dashboard-Preview-State`
 * to `encodePreviewStateCookieValue(state)` and returns 200 with `{ state }`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isAuthorizedForPreviewStateMutation())) return forbidden();

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Invalid request body.' },
      { status: 400 },
    );
  }

  const candidateState =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)['state']
      : undefined;

  if (!isPreviewState(candidateState)) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: `state must be one of: ${PREVIEW_STATES.join(', ')}.`,
      },
      { status: 400 },
    );
  }

  // Best-effort audit (Req 6.13) — see recordPreviewStateAudit's doc comment
  // for why a failed call here does not block setting the cookie.
  await recordPreviewStateAudit('set');

  const response = NextResponse.json({ state: candidateState });
  response.cookies.set(
    PREVIEW_STATE_COOKIE_NAME,
    encodePreviewStateCookieValue(candidateState),
    previewStateCookieOptions(request, PREVIEW_STATE_MAX_AGE_SECONDS),
  );
  return response;
}

/**
 * DELETE /api/dashboard/preview-state
 *
 * Expires `Dashboard-Preview-State` (`Max-Age=0`) and returns 204.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  if (!(await isAuthorizedForPreviewStateMutation())) return forbidden();

  // Best-effort audit (Req 6.13) — see recordPreviewStateAudit's doc comment
  // for why a failed call here does not block clearing the cookie.
  await recordPreviewStateAudit('clear');

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(PREVIEW_STATE_COOKIE_NAME, '', previewStateCookieOptions(request, 0));
  return response;
}
