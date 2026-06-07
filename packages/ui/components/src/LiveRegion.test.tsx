import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, renderHook } from '@testing-library/react';
import {
  LiveRegion,
  announce,
  useAnnounce,
  __resetLiveRegionListeners,
} from './LiveRegion';

describe('<LiveRegion />', () => {
  beforeEach(() => {
    __resetLiveRegionListeners();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts a polite and an assertive ARIA live region', () => {
    render(<LiveRegion />);
    const polite = screen.getByTestId('live-region-polite');
    const assertive = screen.getByTestId('live-region-assertive');

    expect(polite).toHaveAttribute('role', 'status');
    expect(polite).toHaveAttribute('aria-live', 'polite');
    expect(polite).toHaveAttribute('aria-atomic', 'true');

    expect(assertive).toHaveAttribute('role', 'alert');
    expect(assertive).toHaveAttribute('aria-live', 'assertive');
    expect(assertive).toHaveAttribute('aria-atomic', 'true');
  });

  it('routes polite announcements (default priority) to the polite region only', () => {
    render(<LiveRegion />);
    const polite = screen.getByTestId('live-region-polite');
    const assertive = screen.getByTestId('live-region-assertive');

    act(() => {
      announce('Attendance saved');
      vi.advanceTimersByTime(1);
    });

    expect(polite.textContent).toBe('Attendance saved');
    expect(assertive.textContent).toBe('');
  });

  it('routes assertive announcements to the assertive region only', () => {
    render(<LiveRegion />);
    const polite = screen.getByTestId('live-region-polite');
    const assertive = screen.getByTestId('live-region-assertive');

    act(() => {
      announce('Failed to load students; retrying', 'assertive');
      vi.advanceTimersByTime(1);
    });

    expect(assertive.textContent).toBe('Failed to load students; retrying');
    expect(polite.textContent).toBe('');
  });

  it('clears the active message after the debounce window so SR re-reads identical text', () => {
    render(<LiveRegion clearAfterMs={500} />);
    const polite = screen.getByTestId('live-region-polite');

    // First announcement.
    act(() => {
      announce('12 operations synced');
      vi.advanceTimersByTime(1);
    });
    expect(polite.textContent).toBe('12 operations synced');

    // After the debounce window the region clears.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(polite.textContent).toBe('');

    // Identical follow-up message re-fills the region (proving SR re-reads).
    act(() => {
      announce('12 operations synced');
      vi.advanceTimersByTime(1);
    });
    expect(polite.textContent).toBe('12 operations synced');
  });

  it('replaces an in-flight polite message with the next one', () => {
    render(<LiveRegion />);
    const polite = screen.getByTestId('live-region-polite');

    act(() => {
      announce('Saving…');
      vi.advanceTimersByTime(1);
    });
    expect(polite.textContent).toBe('Saving…');

    act(() => {
      announce('Attendance saved');
      vi.advanceTimersByTime(1);
    });
    expect(polite.textContent).toBe('Attendance saved');
  });

  it('handles concurrent polite + assertive announcements independently', () => {
    render(<LiveRegion />);
    const polite = screen.getByTestId('live-region-polite');
    const assertive = screen.getByTestId('live-region-assertive');

    act(() => {
      announce('12 operations synced');
      announce('Session expired', 'assertive');
      vi.advanceTimersByTime(1);
    });

    expect(polite.textContent).toBe('12 operations synced');
    expect(assertive.textContent).toBe('Session expired');
  });

  it('ignores empty messages so the region is never falsely re-announced', () => {
    render(<LiveRegion />);
    const polite = screen.getByTestId('live-region-polite');

    act(() => {
      announce('');
      vi.advanceTimersByTime(1);
    });

    expect(polite.textContent).toBe('');
  });

  it('renders both regions with visually-hidden styling', () => {
    render(<LiveRegion />);
    const polite = screen.getByTestId('live-region-polite');
    expect(polite).toHaveClass('sr-only');
    expect(polite).toHaveStyle({ position: 'absolute', width: '1px', height: '1px' });
  });

  it('cleans up timers and unsubscribes on unmount', () => {
    const { unmount } = render(<LiveRegion />);

    act(() => {
      announce('Saving…');
    });

    // Unmount before the flush timer fires; this should not throw and the
    // listener should no longer receive announcements.
    expect(() => {
      unmount();
      announce('After unmount');
      vi.advanceTimersByTime(1000);
    }).not.toThrow();
  });
});

describe('useAnnounce()', () => {
  beforeEach(() => {
    __resetLiveRegionListeners();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a function that delivers messages to the polite region by default', () => {
    render(<LiveRegion />);
    const { result } = renderHook(() => useAnnounce());

    act(() => {
      result.current('Filter updated: 24 results');
      vi.advanceTimersByTime(1);
    });

    expect(screen.getByTestId('live-region-polite').textContent).toBe(
      'Filter updated: 24 results',
    );
  });

  it('forwards the assertive priority to the assertive region', () => {
    render(<LiveRegion />);
    const { result } = renderHook(() => useAnnounce());

    act(() => {
      result.current('Validation failed', 'assertive');
      vi.advanceTimersByTime(1);
    });

    expect(screen.getByTestId('live-region-assertive').textContent).toBe(
      'Validation failed',
    );
  });

  it('returns a stable reference across renders', () => {
    const { result, rerender } = renderHook(() => useAnnounce());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
