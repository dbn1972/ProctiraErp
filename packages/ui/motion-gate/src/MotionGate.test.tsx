import React from 'react';
import { render, renderHook, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MotionGate, useMotionPreference } from './MotionGate';
import { useReducedMotion } from './useReducedMotion';

/**
 * Mock factory for `window.matchMedia` so we can simulate the
 * `prefers-reduced-motion: reduce` user setting in jsdom.
 */
type MatchMediaListener = (event: MediaQueryListEvent) => void;

function installMatchMediaMock(initialMatches: boolean): {
  setMatches: (matches: boolean) => void;
  restore: () => void;
} {
  const original = window.matchMedia;
  let currentMatches = initialMatches;
  const listeners = new Set<MatchMediaListener>();

  const matchMedia = vi.fn((query: string) => {
    const mql = {
      matches: currentMatches,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: MatchMediaListener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: MatchMediaListener) => {
        listeners.delete(listener);
      },
      addListener: (listener: MatchMediaListener) => listeners.add(listener),
      removeListener: (listener: MatchMediaListener) => listeners.delete(listener),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
    return mql;
  });

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMedia,
  });

  return {
    setMatches: (matches: boolean) => {
      currentMatches = matches;
      const event = { matches } as MediaQueryListEvent;
      listeners.forEach((l) => l(event));
    },
    restore: () => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: original,
      });
    },
  };
}

describe('useReducedMotion', () => {
  let harness: ReturnType<typeof installMatchMediaMock>;

  afterEach(() => {
    harness?.restore();
  });

  it('returns true when matchMedia reports prefers-reduced-motion: reduce', () => {
    harness = installMatchMediaMock(true);

    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(true);
  });

  it('returns false when matchMedia reports no preference', () => {
    harness = installMatchMediaMock(false);

    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);
  });

  it('updates when the OS preference changes at runtime', () => {
    harness = installMatchMediaMock(false);

    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);

    act(() => {
      harness.setMatches(true);
    });

    expect(result.current).toBe(true);
  });
});

describe('MotionGate', () => {
  let harness: ReturnType<typeof installMatchMediaMock>;

  afterEach(() => {
    harness?.restore();
  });

  function Probe({ testId = 'probe' }: { testId?: string }) {
    const { disableMotion, enableMotion, prefersReducedMotion } = useMotionPreference();
    return (
      <div
        data-testid={testId}
        data-disable-motion={String(disableMotion)}
        data-enable-motion={String(enableMotion)}
        data-prefers-reduced={String(prefersReducedMotion)}
        className={disableMotion ? '' : 'motion-safe:animate-pulse'}
      >
        {disableMotion ? 'static' : 'animated'}
      </div>
    );
  }

  it('exposes disableMotion=true when prefers-reduced-motion: reduce is active', () => {
    harness = installMatchMediaMock(true);

    render(
      <MotionGate>
        <Probe />
      </MotionGate>
    );

    const probe = screen.getByTestId('probe');
    expect(probe).toHaveAttribute('data-disable-motion', 'true');
    expect(probe).toHaveAttribute('data-enable-motion', 'false');
    expect(probe).toHaveAttribute('data-prefers-reduced', 'true');
    expect(probe).toHaveTextContent('static');
    // The animation class is omitted, confirming animations are skipped.
    expect(probe.className).not.toContain('animate-pulse');
  });

  it('exposes disableMotion=false when no reduced-motion preference is set', () => {
    harness = installMatchMediaMock(false);

    render(
      <MotionGate>
        <Probe />
      </MotionGate>
    );

    const probe = screen.getByTestId('probe');
    expect(probe).toHaveAttribute('data-disable-motion', 'false');
    expect(probe).toHaveTextContent('animated');
    expect(probe.className).toContain('animate-pulse');
  });

  it('returns a default preference (disableMotion=false) when used outside of a provider', () => {
    harness = installMatchMediaMock(true);

    render(<Probe />);

    const probe = screen.getByTestId('probe');
    expect(probe).toHaveAttribute('data-disable-motion', 'false');
  });

  it('honors forceReduce override regardless of OS preference', () => {
    harness = installMatchMediaMock(false);

    render(
      <MotionGate forceReduce>
        <Probe />
      </MotionGate>
    );

    expect(screen.getByTestId('probe')).toHaveAttribute('data-disable-motion', 'true');
  });

  it('honors forceMotion override regardless of OS preference', () => {
    harness = installMatchMediaMock(true);

    render(
      <MotionGate forceMotion>
        <Probe />
      </MotionGate>
    );

    expect(screen.getByTestId('probe')).toHaveAttribute('data-disable-motion', 'false');
  });

  it('updates descendants when the OS preference changes at runtime', () => {
    harness = installMatchMediaMock(false);

    render(
      <MotionGate>
        <Probe />
      </MotionGate>
    );

    expect(screen.getByTestId('probe')).toHaveAttribute('data-disable-motion', 'false');

    act(() => {
      harness.setMatches(true);
    });

    expect(screen.getByTestId('probe')).toHaveAttribute('data-disable-motion', 'true');
  });
});
