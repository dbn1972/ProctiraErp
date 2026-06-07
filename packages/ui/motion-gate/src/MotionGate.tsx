'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * Shape of the motion preference exposed to descendants of `<MotionGate>`.
 */
export interface MotionPreference {
  /**
   * `true` when motion should be skipped (either because the user has
   * `prefers-reduced-motion: reduce` set or because a parent gate has
   * forced motion off via the `forceReduce` prop).
   */
  disableMotion: boolean;
  /** Convenience inverse of {@link MotionPreference.disableMotion}. */
  enableMotion: boolean;
  /** Mirror of {@link MotionPreference.disableMotion} for ergonomic naming. */
  prefersReducedMotion: boolean;
}

const DEFAULT_PREFERENCE: MotionPreference = {
  disableMotion: false,
  enableMotion: true,
  prefersReducedMotion: false,
};

const MotionPreferenceContext = createContext<MotionPreference>(DEFAULT_PREFERENCE);

export interface MotionGateProps {
  /** Children that may opt out of animations via {@link useMotionPreference}. */
  children: React.ReactNode;
  /**
   * Force motion to be disabled regardless of the OS-level media query.
   * Useful for storybook examples or feature flags that disable motion
   * globally for QA.
   */
  forceReduce?: boolean;
  /**
   * Force motion to be allowed regardless of the OS-level media query.
   * Reserved for essential animations (e.g. progress indicators) that
   * must run even under `prefers-reduced-motion: reduce`. Use sparingly.
   */
  forceMotion?: boolean;
}

/**
 * `<MotionGate>` provides a `disableMotion` flag through React context based on
 * the user's `prefers-reduced-motion` setting. Wrap motion-driven sub-trees
 * (Motion / framer-motion animations, custom transitions) with this provider so
 * descendants can read the flag via {@link useMotionPreference} and skip
 * non-essential animations.
 *
 * SSR-safe: the initial value is `false` (motion enabled). The hook subscribes
 * to `window.matchMedia('(prefers-reduced-motion: reduce)')` after mount.
 *
 * Implements Requirement 39.5 and Design §J.
 *
 * @example
 * ```tsx
 * // App root
 * <MotionGate>
 *   <App />
 * </MotionGate>
 *
 * // Inside a component
 * function PulseDot() {
 *   const { disableMotion } = useMotionPreference();
 *   return <span className={disableMotion ? '' : 'animate-pulse'} />;
 * }
 * ```
 */
export function MotionGate({ children, forceReduce, forceMotion }: MotionGateProps) {
  const systemPrefersReduced = useReducedMotion();

  const value = useMemo<MotionPreference>(() => {
    let disableMotion = systemPrefersReduced;
    if (forceReduce) disableMotion = true;
    if (forceMotion) disableMotion = false;
    return {
      disableMotion,
      enableMotion: !disableMotion,
      prefersReducedMotion: disableMotion,
    };
  }, [systemPrefersReduced, forceReduce, forceMotion]);

  return (
    <MotionPreferenceContext.Provider value={value}>
      {children}
    </MotionPreferenceContext.Provider>
  );
}

/**
 * Consumer hook for reading the current motion preference inside any descendant
 * of `<MotionGate>`. When called outside of a `<MotionGate>` it returns a
 * sensible default (`disableMotion: false`) so components remain usable in
 * isolation (tests, storybook).
 */
export function useMotionPreference(): MotionPreference {
  return useContext(MotionPreferenceContext);
}
