/**
 * Shared human-readable labels for the five dashboard preview states
 * (Task 10.2, `principal-dashboard-parity`, Req 6 AC2/AC10).
 *
 * This mapping was originally defined privately inside
 * `PreviewStateSwitcher.tsx` (Task 10.1) — a `'use client'` component.
 * Task 10.2 needs the identical mapping from `PreviewStateBanner.tsx`, a
 * Server Component, so it is extracted here rather than exported in place
 * from the switcher file.
 *
 * That is a deliberate choice, not just a style preference: in the
 * Next.js App Router, every export of a `'use client'` module is turned
 * into a client reference by the RSC compiler, which is only reliably
 * usable in JSX-rendering position (`<SomeClientComponent />`) from a
 * Server Component — not read as a plain object/value during a Server
 * Component's own render logic (e.g. `PREVIEW_STATE_LABELS[state]`). Doing
 * the latter across that boundary is an unsupported pattern that this
 * repo's unit-test tooling (vitest + jsdom) would not catch either, since
 * it doesn't perform Next's real client-boundary bundling — a mis-import
 * here would pass tests locally and only fail under `next build`/`next
 * dev`. Hoisting the mapping into this plain, framework-agnostic module
 * (no `'use client'`, no `next/headers`, same shape as the sibling
 * `previewStateCookie.ts`/`previewStatePermission.ts`) avoids that class
 * of bug entirely: both `PreviewStateSwitcher.tsx` and
 * `PreviewStateBanner.tsx` import this one copy.
 *
 * Wording is unchanged from Task 10.1's original definition and matches
 * requirements.md's own labels for the five states verbatim: "Filled",
 * "No approvals", "Degraded (services down)", "Loading", "Error".
 */
import type { PreviewState } from './previewStateCookie';

export const PREVIEW_STATE_LABELS: Record<PreviewState, string> = {
  filled: 'Filled',
  'no-approvals': 'No approvals',
  degraded: 'Degraded (services down)',
  loading: 'Loading',
  error: 'Error',
};
