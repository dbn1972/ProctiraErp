/**
 * PreviewStateBanner — visible fabricated-state indicator (Task 10.2,
 * `principal-dashboard-parity`, Requirement 6 AC10).
 *
 * Requirement 6 AC10: "WHEN a preview state is active THEN the system
 * SHALL make this fact visibly obvious in the UI to the user who set it,
 * so that the fabricated state is never mistaken for real production
 * data." design.md's "Visible indicator" paragraph specifies the exact
 * mechanism: "a banner built the same way as `ScaffoldModeBanner`
 * (`apps/web/src/components/insights/ScaffoldModeBanner.tsx`), reusing
 * `Alert` `variant="warning"`, rendered at the top of the dashboard page
 * whenever `resolvePreviewOverride()` returns non-null, naming the active
 * state (e.g. "Preview mode: Filled — this is not real data")."
 *
 * This is a plain Server Component, not a `'use client'` component like
 * `PreviewStateSwitcher.tsx` (Task 10.1): it needs no interactivity at
 * all, just to render conditionally off a prop its caller (`page.tsx`)
 * already has in hand (`previewOverride?.state ?? null`) — the same
 * pattern `ScaffoldModeBanner` itself uses (a plain functional component
 * that returns `null` when its own visibility condition isn't met).
 *
 * ## Scope isolation (Req 6 AC8, AC10, AC11) — read before changing this file
 *
 * This banner needs NO isolation logic of its own, and that is a load-
 * bearing invariant worth stating explicitly rather than leaving implicit:
 *
 *   - Its only input is `activeState`, which `page.tsx` derives from
 *     `previewOverride` — the return value of
 *     `resolvePreviewOverride()` (`@/lib/dashboard/resolvePreviewOverride`).
 *   - `resolvePreviewOverride()` reads the CURRENT REQUEST's own
 *     `Dashboard-Preview-State` cookie (via `next/headers`) and the
 *     CURRENT REQUEST's own session (via `getSession()`), then re-checks
 *     the `dashboard-preview:manage` permission fresh against that
 *     session's actual roles. It fails closed (`null`) on a missing
 *     cookie, missing/expired session, missing permission, or expiry.
 *   - There is no shared, tenant-wide, or cross-session store anywhere in
 *     this path — not a database row, not a cache entry keyed by tenant,
 *     nothing. The signal lives ONLY in the cookie of the browser that
 *     set it.
 *
 * Consequently: another user's session — even another admin/principal in
 * the SAME tenant who never touched the switcher — sends a request with
 * no `Dashboard-Preview-State` cookie (or a different one, if they set
 * their own independently), so THEIR `resolvePreviewOverride()` call
 * resolves to `null` (or their own state), and THIS banner renders
 * nothing (or their own banner) for them regardless of what any other
 * session activated. There is no code path here — correct or buggy —
 * that could leak one session's preview state into another session's
 * render, because the banner never reads anything broader than the one
 * value its caller already resolved per-request. This is what
 * requirements.md's own glossary means by the preview mechanism being
 * "scoped only to the session of the user who set it."
 *
 * ## `data-testid` (for Task 10.3)
 *
 *   - `preview-state-banner` — root `<Alert>`. Absent entirely when
 *     `activeState` is `null`.
 */
import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@proctira/ui/components';

import type { PreviewState } from '@/lib/dashboard/previewStateCookie';
import { PREVIEW_STATE_LABELS } from '@/lib/dashboard/previewStateLabels';

export interface PreviewStateBannerProps {
  /** The currently active preview state, or `null` when none is active. */
  activeState: PreviewState | null;
}

/**
 * Renders `null` when no preview state is active. Otherwise renders a
 * `variant="warning"` `Alert` naming the active state, using the same
 * human-readable labels as `PreviewStateSwitcher` (`PREVIEW_STATE_LABELS`,
 * `@/lib/dashboard/previewStateLabels`) so the switcher's button text and
 * this banner's copy always agree.
 *
 * Note on the "Loading" state: this component takes no special action for
 * `activeState === 'loading'` and does not need to — see `page.tsx`'s own
 * comment at its `resolveDashboardSources()` call site. While `'loading'`
 * is active, that function returns a `Promise` that never resolves, so
 * `DashboardPage()`'s render never proceeds past its own `await` far
 * enough to reach the JSX that would mount this banner. The App Router's
 * per-segment Suspense boundary (`apps/web/src/app/(dashboard)/loading.tsx`)
 * shows its fallback indefinitely instead. This banner would render
 * correctly for `'loading'` if it were ever reached (its label is "Loading"
 * like any other state) — it simply never is, by construction, which is
 * itself the intended behavior for that state (Req 6 AC6).
 */
export function PreviewStateBanner({ activeState }: PreviewStateBannerProps) {
  if (activeState === null) return null;

  return (
    <Alert variant="warning" className="mb-6" data-testid="preview-state-banner" role="status">
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>Preview mode: {PREVIEW_STATE_LABELS[activeState]}</AlertTitle>
      <AlertDescription>
        This is not real data. Clear the preview state below to return to your tenant&apos;s actual
        dashboard.
      </AlertDescription>
    </Alert>
  );
}

export default PreviewStateBanner;
