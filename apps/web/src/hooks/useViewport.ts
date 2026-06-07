'use client';

/**
 * useViewport — Responsive layout hook (Design §H, Requirement 41)
 *
 * Subscribes to `window.matchMedia('(max-width: 767px)')` and returns the
 * current viewport classification used by the authenticated layout switch
 * inside `<AppShell>`. The 768 px breakpoint mirrors the design's
 * Mobile_View threshold and the Tailwind `md` breakpoint.
 *
 * Contract:
 *   • Returns `{ isMobile: boolean }`.
 *   • SSR-safe initial value: `false` — the server has no viewport, so the
 *     hook assumes desktop until the first client-side effect runs. This
 *     matches the behaviour of the Theme boot script (Task 47.1) which
 *     also degrades to a sensible default during SSR/first paint and
 *     reconciles on hydrate.
 *   • Subscribes for the lifetime of the calling component and detaches
 *     on unmount.
 *   • Supports both the modern `addEventListener('change', …)` API and
 *     the legacy `addListener` API used by Safari < 14, matching the
 *     ThemeProvider pattern (Design §B / Task 47.1).
 */

import { useEffect, useState } from 'react';

/** The breakpoint used by `<AppShell>` to switch between mobile and desktop chrome. */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

export interface ViewportState {
  /** `true` when the viewport is below 768 px. */
  isMobile: boolean;
}

/**
 * Returns the current viewport classification.
 *
 * The initial value is always `false` so the hook is safe to evaluate
 * during server rendering. The first client-side effect immediately
 * reconciles the value with `matchMedia(...).matches`, so a mobile
 * client hydrates into the mobile shell on the first paint after
 * hydration without any UI flicker.
 */
export function useViewport(): ViewportState {
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    // Guard against environments without a DOM (e.g. SSR, Node-only tests).
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);

    // Reconcile the SSR default with the real viewport on mount.
    setIsMobile(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    // Modern browsers expose `addEventListener` on MediaQueryList.
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }

    // Safari < 14 only exposes the deprecated `addListener` API. Cast
    // through `unknown` so TypeScript does not flag the legacy methods.
    const legacy = mediaQuery as unknown as {
      addListener: (cb: (e: MediaQueryListEvent) => void) => void;
      removeListener: (cb: (e: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener(handler);
    return () => legacy.removeListener(handler);
  }, []);

  return { isMobile };
}
