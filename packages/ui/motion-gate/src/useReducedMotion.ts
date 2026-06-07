'use client';

import { useEffect, useState } from 'react';

/**
 * Media query string used to detect the user's reduced-motion preference.
 *
 * Aligns with the platform's Performance Budget Strategy
 * (Design §J / Requirement 39.5): when the OS reports
 * `prefers-reduced-motion: reduce`, all non-essential motion is suppressed.
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Subscribes to the OS-level `prefers-reduced-motion: reduce` media query and
 * returns `true` when the user has requested reduced motion.
 *
 * SSR-safe: when `window` is unavailable (server render, build-time, jsdom
 * without `matchMedia`) the hook returns `false` so animations render as
 * usual until hydration confirms the user preference.
 *
 * @example
 * ```tsx
 * const reduce = useReducedMotion();
 * return reduce ? <StaticIcon /> : <SpinningIcon />;
 * ```
 */
export function useReducedMotion(): boolean {
  // SSR-safe initial value: assume motion is allowed until the client tells
  // us otherwise. This avoids hydration mismatches.
  const [reduced, setReduced] = useState<boolean>(() => getInitialReducedMotion());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mql = window.matchMedia(REDUCED_MOTION_QUERY);

    // Sync initial value once on the client. The state initializer above runs
    // during render, so on the first commit we re-read in case anything
    // changed between mount and effect (e.g. user toggled the OS setting).
    setReduced(mql.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      setReduced(event.matches);
    };

    // Modern browsers expose `addEventListener`; older Safari only has
    // `addListener`. Support both for resilience.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleChange);
      return () => mql.removeEventListener('change', handleChange);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy Safari fallback
    const legacy = mql as any;
    if (typeof legacy.addListener === 'function') {
      legacy.addListener(handleChange);
      return () => legacy.removeListener(handleChange);
    }

    return undefined;
  }, []);

  return reduced;
}

function getInitialReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}
