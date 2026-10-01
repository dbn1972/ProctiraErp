import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { REDUCED_MOTION_QUERY, useReducedMotion } from './useReducedMotion';

/**
 * Fallback paths of useReducedMotion: legacy Safari `addListener`, a
 * MediaQueryList without any listener API, a missing `matchMedia`, and a
 * `matchMedia` that throws during the initial read.
 */
type Listener = (event: MediaQueryListEvent) => void;

const original = window.matchMedia;

function setMatchMedia(value: unknown): void {
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value });
}

afterEach(() => setMatchMedia(original));

describe('useReducedMotion fallbacks', () => {
  it('subscribes through legacy addListener and unsubscribes on unmount', () => {
    const listeners = new Set<Listener>();
    const queries: string[] = [];
    setMatchMedia((query: string) => {
      queries.push(query);
      return {
        matches: false,
        media: query,
        addListener: (l: Listener) => listeners.add(l),
        removeListener: (l: Listener) => listeners.delete(l),
      };
    });

    const { result, unmount } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    expect(queries.every((q) => q === REDUCED_MOTION_QUERY)).toBe(true);
    expect(listeners.size).toBe(1);

    act(() => listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent)));
    expect(result.current).toBe(true);

    unmount();
    expect(listeners.size).toBe(0);
  });

  it('still reads the preference when the MediaQueryList has no listener API', () => {
    setMatchMedia((query: string) => ({ matches: true, media: query }));

    const { result, unmount } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
    expect(() => unmount()).not.toThrow();
  });

  it('returns false when matchMedia is unavailable', () => {
    setMatchMedia(undefined);

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('returns false when the initial matchMedia read throws', () => {
    let calls = 0;
    setMatchMedia((query: string) => {
      calls += 1;
      if (calls === 1) throw new Error('matchMedia not ready');
      return { matches: false, media: query };
    });

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });
});
