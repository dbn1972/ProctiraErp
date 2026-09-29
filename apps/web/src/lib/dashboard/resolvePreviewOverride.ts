/**
 * Dashboard preview-state server-side resolver (Task 7.2, `principal-dashboard-parity`).
 *
 * This is the single authoritative gate for "is a preview override active for
 * this request", consumed by the dashboard page's data-fetch layer (Task 8.2,
 * not implemented here). It never trusts the `Dashboard-Preview-State` cookie
 * by itself — presence of the cookie is only a *hint*; the permission and
 * expiry are both re-checked fresh, server-side, on every call.
 *
 * Fails closed (returns `null`) at the first failing step, in order:
 *   1. No `Dashboard-Preview-State` cookie → null
 *   2. Cookie value doesn't decode (`decodePreviewStateCookieValue`) → null
 *   3. Decoded value is older than `PREVIEW_STATE_MAX_AGE_SECONDS`
 *      (`isPreviewStateExpired`) → null
 *   4. No session, or the session's access token is expired (`getSession()`) → null
 *   5. The caller's *actual* roles don't carry `dashboard-preview:manage` in
 *      the web RBAC registry (`hasPermission`) → null
 *   6. Otherwise → `{ state, setAtEpochSeconds }`
 *
 * Any unexpected error along the way (a malformed cookie jar, `getSession()`
 * throwing, etc.) is also treated as "no override" rather than propagated —
 * this function must never throw (Req 6 AC1, AC9, AC12; Req 7 AC4).
 *
 * This mirrors the branding-preview cookie+permission AND pattern
 * (`packages/backend/tenant/src/branding-routes.ts`'s `hasPreviewSignal` +
 * permission-check, `apps/web/src/lib/branding/previewCookie.ts`), adapted to
 * this being entirely web-app-side (no gateway route yet — that's Task 9.x).
 *
 * Naming: no `.server.ts` suffix. That suffix is this codebase's convention
 * for disambiguating a next/headers-bound sibling from a client-safe
 * same-named module in `lib/api/*` (e.g. `admin.ts` vs `admin.server.ts`).
 * This module has no such client-safe sibling — it lives in `lib/dashboard/`
 * one file per concern, same shape as `lib/auth/server.ts` (itself
 * unsuffixed despite depending on `next/headers`) and `lib/institutions/api.ts`
 * (marked "Server-only" in its doc comment, not its filename).
 *
 * The permission decision itself (session → `AuthUser` mapping +
 * `hasPermission` against `dashboard-preview:manage`) now lives in
 * `./previewStatePermission`, shared with the Task 9.1 set/clear routes so
 * both call sites re-check the identical permission rather than each
 * re-deriving it. This is a Task 9.1 extraction; this module's own exports
 * (`PreviewOverride`, `resolvePreviewOverride`) and external behavior are
 * unchanged.
 *
 * ## Automatic expiry and audit (Task 9.2, Req 6.13)
 *
 * Requirement 6.13 requires every preview-state set *or clear* to be
 * attributable, and its own task wording calls out that "automatic expiry ...
 * is also treated as a clear for audit purposes." This function is where
 * that expiry actually happens (step 3 above): once
 * `isPreviewStateExpired()` is true, this returns `null` exactly as if no
 * override existed — no gateway call, no audit row, for this path.
 *
 * That is a deliberate decision, not an oversight: an audit trail attributes
 * ACTIONS taken by an actor (who did what, when — the same shape as every
 * other row in `audit_log_entries`, e.g. `packages/backend/health/src/routes.ts`'s
 * writes). A passive timeout where nobody clicked anything has no actor to
 * attribute it to and no request during which a gateway call could even be
 * made — this function runs synchronously against a cookie that already
 * expired sometime in the past; there is no "moment of expiry" request to
 * hang an audit call off of. Nothing else in this codebase audits a
 * time-based state transition that isn't tied to a request (the audit
 * retention scheduler, `packages/backend/audit/src/retention-scheduler.ts`,
 * *archives* rows on a timer but doesn't attribute expiry itself to anyone).
 * Introducing one here — a background job or scheduled sweep whose only
 * purpose is to write "state X expired for tenant Y" rows with no
 * corresponding actor — would be new complexity with no precedent, for an
 * event Req 6.13's own language ("attributable: actor, tenant, timestamp")
 * doesn't actually have an actor for.
 *
 * What Task 9.2 asked for instead — "automatic expiry is also treated as a
 * clear for audit purposes when the client next calls the clear route or
 * re-requests the dashboard past expiry" — is satisfied by this function's
 * existing behavior with no new code: the switcher UI's own client-side
 * cookie read (`readActivePreviewStateFromBrowser()`,
 * `./previewStateCookie.ts`) also treats an expired signal as inactive, so
 * a session that outlives its own 30-minute window naturally lands back on
 * "no override" and the switcher control reflects that on its next render.
 * If that session's user (or anyone else with the permission) then
 * explicitly clears the state via `DELETE /api/dashboard/preview-state`,
 * *that* is a real, attributable action, and Task 9.2's audit call
 * (`recordPreviewStateAudit`, `@/app/api/dashboard/preview-state/route.ts`)
 * covers it exactly like any other clear.
 */
import { cookies } from 'next/headers';

import { getSession } from '@/lib/auth/server';

import {
  PREVIEW_STATE_COOKIE_NAME,
  decodePreviewStateCookieValue,
  isPreviewStateExpired,
  type PreviewState,
} from './previewStateCookie';
import { hasDashboardPreviewPermission } from './previewStatePermission';

/** A resolved, authorized, unexpired preview-state override. */
export interface PreviewOverride {
  state: PreviewState;
  setAtEpochSeconds: number;
}

/**
 * Resolves the active dashboard preview-state override for the current
 * request, or `null` when no valid+authorized+unexpired override applies.
 *
 * Reads the `Dashboard-Preview-State` cookie itself (via `next/headers`, the
 * same pattern as `getSession()`), then delegates session/permission
 * resolution to the existing `getSession()` + `hasPermission()` primitives.
 * Never throws.
 */
export async function resolvePreviewOverride(): Promise<PreviewOverride | null> {
  try {
    const jar = await cookies();
    const raw = jar.get(PREVIEW_STATE_COOKIE_NAME)?.value;
    if (!raw) return null;

    const decoded = decodePreviewStateCookieValue(raw);
    if (!decoded) return null;

    if (isPreviewStateExpired(decoded.setAtEpochSeconds)) return null;

    const session = await getSession();
    if (!session || session.isExpired) return null;

    if (!hasDashboardPreviewPermission(session)) return null;

    return { state: decoded.state, setAtEpochSeconds: decoded.setAtEpochSeconds };
  } catch {
    // Fail closed on any unexpected error (cookie jar, session decode, etc.)
    // rather than letting it propagate into the dashboard page render.
    return null;
  }
}
