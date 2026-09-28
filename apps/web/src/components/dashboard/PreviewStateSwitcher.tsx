'use client';

/**
 * PreviewStateSwitcher — dashboard preview-state control (Task 10.1,
 * `principal-dashboard-parity`, Requirement 6).
 *
 * Lets a permissioned admin/principal force the dashboard home page
 * (`apps/web/src/app/(dashboard)/page.tsx`) into one of five fabricated
 * data states for demoing/QA (Req 6 AC2-AC7), by setting/clearing the
 * `Dashboard-Preview-State` cookie via the existing
 * `POST`/`DELETE /api/dashboard/preview-state` routes
 * (`@/app/api/dashboard/preview-state/route.ts`).
 *
 * ## `canManagePreview` — visibility gate (Req 6 AC1, AC12)
 *
 * This is a SERVER-DERIVED boolean the caller must resolve via
 * `hasDashboardPreviewPermission(session)`
 * (`@/lib/dashboard/previewStatePermission`) — the same check the
 * set/clear routes and `resolvePreviewOverride()` independently re-run —
 * and pass down as a plain prop. It must NEVER be derived from the
 * client-side `AuthUser.permissions` array (`@/providers/AuthProvider`):
 * that array is always empty today (confirmed against `sidebar.tsx`'s own
 * `requiredPermissions` gating, which works around the same gap by
 * checking role-name substrings rather than `permissions`).
 *
 * Resolving `canManagePreview` itself (calling
 * `hasDashboardPreviewPermission()` from a Server Component and threading
 * the result down) is NOT this component's job — that wiring belongs to
 * whichever Server Component mounts this control. See "Mounting" below.
 *
 * When `canManagePreview` is `false`, this component renders `null` —
 * nothing at all, not a disabled control (Req 6.1). When `true`, this is
 * still only a UX nicety, not the security boundary: both
 * `POST`/`DELETE /api/dashboard/preview-state` and
 * `resolvePreviewOverride()` independently re-check the real
 * `dashboard-preview:manage` permission fresh, server-side, on every call
 * (Req 6 AC12, Req 7 AC4) — see those modules' own doc comments. A forged
 * `canManagePreview={true}` could make this control render, but could not
 * by itself force a preview state for a session lacking the permission.
 *
 * ## Active-state display
 *
 * On mount, `readActivePreviewStateFromBrowser()`
 * (`@/lib/dashboard/previewStateCookie`) is used to highlight whichever
 * state (if any) is currently active, without a round trip. This is a
 * convenience read only — it already fails closed on a missing/expired/
 * malformed cookie — never an authorization check in its own right (the
 * real check is server-side, as above). It runs in `useEffect` rather
 * than during render so the initial (server-rendered) paint never reads
 * `document.cookie`, avoiding a hydration mismatch.
 *
 * ## Setting / clearing
 *
 * Selecting one of the five state buttons calls
 * `POST /api/dashboard/preview-state` with `{ state }`; the separate
 * "Clear" action (rendered only while a state is active) calls
 * `DELETE /api/dashboard/preview-state`. Re-selecting the already-active
 * state is a no-op resend of the same POST rather than a toggle-to-clear
 * — a dedicated "Clear" affordance is simpler to reason about and test
 * than overloading a state button with two different meanings depending
 * on current state.
 *
 * After a successful call, `useRouter().refresh()` (`next/navigation`) is
 * called so the dashboard page — a Server Component that reads the
 * cookie server-side via `resolvePreviewOverride()` — re-renders with the
 * new/cleared state. This mirrors the established
 * "mutate → `router.refresh()`" pattern used throughout this app's other
 * client-side mutation controls (e.g.
 * `apps/web/src/components/institutions/academic-calendar-panel.tsx`,
 * `apps/web/src/app/(dashboard)/scholarships/_components/retry-failed-transfers-button.tsx`).
 *
 * A failed call never throws — it surfaces a brief inline error message
 * instead (Req 6's own framing of this as a safe, reversible tool; a
 * crashed switcher would be a worse outcome than a visible error).
 *
 * ## `data-testid`s (for Task 10.3)
 *
 *   - `preview-state-switcher` — root container. Absent entirely when
 *     `canManagePreview` is `false`.
 *   - `preview-state-switcher-option-<state>` — one per entry in
 *     `PREVIEW_STATES` (`preview-state-switcher-option-filled`,
 *     `…-no-approvals`, `…-degraded`, `…-loading`, `…-error`). Each is a
 *     real `<button>`; `aria-pressed="true"` on whichever one is active.
 *   - `preview-state-switcher-active-label` — the "Currently active: …"
 *     text. Present only while a state is active.
 *   - `preview-state-switcher-clear` — the "Clear" button. Present only
 *     while a state is active.
 *   - `preview-state-switcher-error` — the inline error message. Present
 *     only after a failed POST/DELETE.
 *
 * ## Mounting
 *
 * Mounted in `apps/web/src/app/(dashboard)/page.tsx` (Task 10.2), directly
 * below `<PreviewStateBanner>` — the two are one feature surface: a
 * session that set a preview state sees the "you're in preview mode"
 * banner and the control to change/clear it in the same place. `page.tsx`
 * computes `canManagePreview` via `hasDashboardPreviewPermission(session)`
 * (`@/lib/dashboard/previewStatePermission`) from its own `session` value
 * (from `getSession()`), never from the client-side `AuthUser.permissions`
 * array, per this component's own contract above.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical } from 'lucide-react';

import { Button } from '@proctira/ui/components';

import { withCsrfHeader } from '@/lib/auth/csrf';
import { cn } from '@/lib/utils';
import {
  PREVIEW_STATES,
  readActivePreviewStateFromBrowser,
  type PreviewState,
} from '@/lib/dashboard/previewStateCookie';
// Task 10.2 extracted this mapping out to a shared, framework-agnostic
// module so `PreviewStateBanner.tsx` (a Server Component) could reuse the
// identical labels without importing a value out of a `'use client'`
// module. See that module's doc comment for why. Labels/wording unchanged.
import { PREVIEW_STATE_LABELS } from '@/lib/dashboard/previewStateLabels';

/** Same-origin Next.js API route this control POSTs/DELETEs against. */
const PREVIEW_STATE_ENDPOINT = '/api/dashboard/preview-state';

export interface PreviewStateSwitcherProps {
  /**
   * Server-derived: `true` only when the caller's session actually holds
   * `dashboard-preview:manage`
   * (`hasDashboardPreviewPermission()`, `@/lib/dashboard/previewStatePermission`).
   *
   * Do NOT pass the client-side `AuthUser.permissions` array here — it is
   * always empty in this codebase today. This prop is a UX-only
   * visibility gate; the server independently re-checks the real
   * permission on every mutating call regardless of this value (see the
   * module doc comment above).
   */
  canManagePreview: boolean;
}

type RequestOutcome = { ok: true } | { ok: false; message: string };

/** Best-effort extraction of this route's `{ code, message }` error envelope. */
async function extractErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)['message']
        : undefined;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  } catch {
    // No/non-JSON body (e.g. the DELETE success path returns 204 with no
    // body) — fall through to the generic fallback below.
  }
  return fallback;
}

/**
 * Issues the POST (`state` set) or DELETE (clear) call and normalizes the
 * result to a plain success/failure shape. Never throws.
 */
async function requestPreviewState(
  method: 'POST' | 'DELETE',
  state?: PreviewState,
): Promise<RequestOutcome> {
  try {
    // The middleware's CSRF double-submit gate (`@/lib/auth/csrf`,
    // `verifyDoubleSubmit`) requires the `x-csrf-token` header on every
    // unsafe-method `/api/*` request, matching the readable `csrf_token`
    // cookie it issues on every page navigation. `withCsrfHeader()` is the
    // same helper every other mutating client-side fetch in this app uses
    // (e.g. `@/lib/auth/session.ts`'s login/logout/refresh calls) — without
    // it, every POST/DELETE here is rejected with 403 CSRF_REJECTED before
    // ever reaching `resolvePreviewOverride`/RBAC/the cookie write.
    const response = await fetch(PREVIEW_STATE_ENDPOINT, {
      method,
      credentials: 'same-origin',
      ...(method === 'POST'
        ? {
            headers: withCsrfHeader({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ state }),
          }
        : { headers: withCsrfHeader() }),
    });

    if (response.ok) return { ok: true };

    const message = await extractErrorMessage(
      response,
      `Request failed (status ${response.status}).`,
    );
    return { ok: false, message };
  } catch {
    return {
      ok: false,
      message: 'Could not reach the preview-state endpoint. Check your connection and try again.',
    };
  }
}

export function PreviewStateSwitcher({ canManagePreview }: PreviewStateSwitcherProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeState, setActiveState] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Highlight the currently-active state (if any) without a round trip.
  // Client-only by design (see module doc comment) — never runs during the
  // server-rendered pass, so hydration always starts from "no state active"
  // and reconciles here on mount.
  useEffect(() => {
    if (!canManagePreview) return;
    setActiveState(readActivePreviewStateFromBrowser()?.state ?? null);
  }, [canManagePreview]);

  // Req 6.1: users without the permission must not see the control at all —
  // render nothing, not a disabled control. This early return runs after
  // every hook above has already been called unconditionally, so it does
  // not violate the rules of hooks.
  if (!canManagePreview) return null;

  function activate(state: PreviewState) {
    setError(null);
    startTransition(async () => {
      const result = await requestPreviewState('POST', state);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setActiveState(readActivePreviewStateFromBrowser()?.state ?? state);
      router.refresh();
    });
  }

  function clear() {
    setError(null);
    startTransition(async () => {
      const result = await requestPreviewState('DELETE');
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setActiveState(null);
      router.refresh();
    });
  }

  return (
    <div
      data-testid="preview-state-switcher"
      aria-busy={isPending}
      className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800"
    >
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <span className="text-sm font-semibold">Dashboard preview</span>
      </div>

      <div role="group" aria-label="Dashboard preview state" className="mt-2 flex flex-wrap gap-1.5">
        {PREVIEW_STATES.map((state) => {
          const isActive = activeState === state;
          return (
            <button
              key={state}
              type="button"
              aria-pressed={isActive}
              disabled={isPending}
              onClick={() => activate(state)}
              data-testid={`preview-state-switcher-option-${state}`}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                isActive
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-amber-800 hover:bg-amber-100',
              )}
            >
              {PREVIEW_STATE_LABELS[state]}
            </button>
          );
        })}
      </div>

      {activeState ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs" data-testid="preview-state-switcher-active-label">
            Currently active: {PREVIEW_STATE_LABELS[activeState]}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={clear}
            data-testid="preview-state-switcher-clear"
          >
            Clear
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive" data-testid="preview-state-switcher-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default PreviewStateSwitcher;
