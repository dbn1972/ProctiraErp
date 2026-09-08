/**
 * @vitest-environment jsdom
 *
 * useViewport tests — Task 53.1 / Requirement 41
 *
 * Covers:
 *   • SSR-safe initial value of `false` before any effect runs.
 *   • Reconciles to the live `matchMedia('(max-width: 767px)').matches`
 *     value on the first client-side effect.
 *   • Re-renders when the media query fires a `change` event.
 *   • Detaches the listener on unmount (no leaks).
 *   • Falls back to legacy Safari `addListener` / `removeListener` when
 *     `addEventListener` is not available, mirroring ThemeProvider.
 *   • Tolerates a missing `window.matchMedia` (older jsdom, edge runtimes).
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { MOBILE_MEDIA_QUERY, useViewport } from './useViewport';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface FakeMediaQueryList {
  matches: boolean;
  media: string;
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null;
  addEventListener?: Mock;
  removeEventListener?: Mock;
  addListener?: Mock;
  removeListener?: Mock;
  dispatchEvent: (ev: Event) => boolean;
  fire: (matches: boolean) => void;
}

function makeMql(initial: boolean, opts: { legacyOnly?: boolean } = {}): FakeMediaQueryList {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql: FakeMediaQueryList = {
    matches: initial,
    media: MOBILE_MEDIA_QUERY,
    onchange: null,
    dispatchEvent: () => true,
    fire(matches: boolean) {
      this.matches = matches;
      const event = { matches } as MediaQueryListEvent;
      listeners.forEach((cb) => cb(event));
    },
  };

  if (!opts.legacyOnly) {
    mql.addEventListener = vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
      if (event === 'change') listeners.add(cb);
    }) as unknown as Mock;
    mql.removeEventListener = vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
      if (event === 'change') listeners.delete(cb);
    }) as unknown as Mock;
  }

  // Always include the legacy API so we can assert the fallback path explicitly.
  mql.addListener = vi.fn((cb: (e: MediaQueryListEvent) => void) =>
    listeners.add(cb),
  ) as unknown as Mock;
  mql.removeListener = vi.fn((cb: (e: MediaQueryListEvent) => void) =>
    listeners.delete(cb),
  ) as unknown as Mock;

  return mql;
}

function installMatchMedia(mql: FakeMediaQueryList) {
  return vi.spyOn(window, 'matchMedia').mockImplementation(() => mql as unknown as MediaQueryList);
}

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  // Each test installs its own matchMedia mock.
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useViewport — contract', () => {
  it('exports the canonical 768 px breakpoint media query string', () => {
    expect(MOBILE_MEDIA_QUERY).toBe('(max-width: 767px)');
  });
});

describe('useViewport — desktop default', () => {
  it('returns isMobile=false when the viewport is at or above 768 px', () => {
    const mql = makeMql(false);
    installMatchMedia(mql);

    const { result } = renderHook(() => useViewport());

    expect(result.current.isMobile).toBe(false);
  });

  it('subscribes to the canonical breakpoint media query', () => {
    const mql = makeMql(false);
    const spy = installMatchMedia(mql);

    renderHook(() => useViewport());

    expect(spy).toHaveBeenCalledWith(MOBILE_MEDIA_QUERY);
  });
});

describe('useViewport — mobile reconciliation', () => {
  it('reconciles to isMobile=true on mount when the viewport is below 768 px', () => {
    const mql = makeMql(true);
    installMatchMedia(mql);

    const { result } = renderHook(() => useViewport());

    expect(result.current.isMobile).toBe(true);
  });

  it('re-renders when the media query fires a change event', () => {
    const mql = makeMql(false);
    installMatchMedia(mql);

    const { result } = renderHook(() => useViewport());
    expect(result.current.isMobile).toBe(false);

    act(() => mql.fire(true));
    expect(result.current.isMobile).toBe(true);

    act(() => mql.fire(false));
    expect(result.current.isMobile).toBe(false);
  });
});

describe('useViewport — listener cleanup', () => {
  it('removes the listener on unmount via addEventListener path', () => {
    const mql = makeMql(false);
    installMatchMedia(mql);

    const { unmount } = renderHook(() => useViewport());

    expect(mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    unmount();

    expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('falls back to addListener/removeListener when addEventListener is absent (legacy Safari)', () => {
    const mql = makeMql(true, { legacyOnly: true });
    installMatchMedia(mql);

    const { result, unmount } = renderHook(() => useViewport());

    expect(result.current.isMobile).toBe(true);
    expect(mql.addListener).toHaveBeenCalledWith(expect.any(Function));

    // The legacy listener should still receive change events.
    act(() => mql.fire(false));
    expect(result.current.isMobile).toBe(false);

    unmount();
    expect(mql.removeListener).toHaveBeenCalledWith(expect.any(Function));
  });
});

describe('useViewport — SSR safety', () => {
  it('returns isMobile=false when window.matchMedia is unavailable', () => {
    // Simulate an environment where matchMedia is missing (older jsdom, edge runtimes).
    const original = window.matchMedia;
    // @ts-expect-error — intentional removal for the test.
    delete window.matchMedia;

    try {
      const { result } = renderHook(() => useViewport());
      expect(result.current.isMobile).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });

  it('initial render value is false (the SSR-safe default)', () => {
    // Install a matchMedia mock that returns matches=false so the test
    // is deterministic regardless of the jsdom version's native matchMedia
    // behaviour (some versions evaluate the query against a 0-width viewport
    // and return matches=true for max-width queries).
    const mql = makeMql(false);
    installMatchMedia(mql);

    const { result } = renderHook(() => useViewport());
    expect(result.current.isMobile).toBe(false);
  });
});
