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
 * SSR-safe: the first render always returns `false` (on server and client
 * alike, so hydration markup matches); the real preference is read from
 * `matchMedia` in an effect right after mount and on every change.
 *
 * @example
 * ```tsx
 * const reduce = useReducedMotion();
 * return reduce ? <StaticIcon /> : <SpinningIcon />;
 * ```
 */
export function useReducedMotion(): boolean {
  // Always start from `false`: reading matchMedia during render would make the
  // client's first render differ from the server markup (hydration mismatch).
  const [reduced, setReduced] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mql = window.matchMedia(REDUCED_MOTION_QUERY);

    // Read the real preference after mount (client only).
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
