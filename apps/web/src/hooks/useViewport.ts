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

/** Prototype tablet: persistent sidebar starts at 1024px. */
export const DRAWER_MEDIA_QUERY = '(max-width: 1023px)';

export interface ViewportState {
  /** `true` when the viewport is below 768 px. */
  isMobile: boolean;
  /** `true` when the desktop sidebar should be an off-canvas drawer (below 1024px). */
  isDrawer: boolean;
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
function subscribeMedia(
  query: string,
  setMatches: (matches: boolean) => void,
): (() => void) | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return;
  }
  const mediaQuery = window.matchMedia(query);
  setMatches(mediaQuery.matches);
  const handler = (event: MediaQueryListEvent) => {
    setMatches(event.matches);
  };
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }
  const legacy = mediaQuery as unknown as {
    addListener: (cb: (e: MediaQueryListEvent) => void) => void;
    removeListener: (cb: (e: MediaQueryListEvent) => void) => void;
  };
  legacy.addListener(handler);
  return () => legacy.removeListener(handler);
}

export function useViewport(): ViewportState {
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [isDrawer, setIsDrawer] = useState<boolean>(false);

  useEffect(() => {
    const stopMobile = subscribeMedia(MOBILE_MEDIA_QUERY, setIsMobile);
    const stopDrawer = subscribeMedia(DRAWER_MEDIA_QUERY, setIsDrawer);
    return () => {
      stopMobile?.();
      stopDrawer?.();
    };
  }, []);

  return { isMobile, isDrawer };
}
