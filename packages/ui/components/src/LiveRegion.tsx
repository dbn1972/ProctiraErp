import React from 'react';

/**
 * Priority of an announcement. `'polite'` is the default and waits for the
 * screen reader to finish its current utterance before reading the
 * message; `'assertive'` interrupts the current utterance and is reserved
 * for blocking errors and security-relevant events.
 */
export type AnnouncePriority = 'polite' | 'assertive';

/** Function returned by `useAnnounce()`. */
export type Announce = (
  message: string,
  priority?: AnnouncePriority,
) => void;

// ---------------------------------------------------------------------------
// Module-level event emitter
// ---------------------------------------------------------------------------
//
// A single emitter lives at module scope so any descendant of `<AppShell>`
// can call `announce(...)` without prop-drilling or pulling in a heavier
// state library. `<LiveRegion>` subscribes on mount and pushes the message
// into the matching ARIA live region.
//
// We expose `announce()` directly as a named export so non-React callers
// (sync queue handlers, fetch error reporters, error boundaries) can
// trigger announcements without needing a hook.

type Listener = (message: string, priority: AnnouncePriority) => void;

const listeners = new Set<Listener>();

/**
 * Imperatively announce a message to all mounted `<LiveRegion>` instances.
 * Prefer the `useAnnounce()` hook from inside React components — this
 * named export is for non-React callers (queue workers, fetch
 * interceptors, error boundaries).
 */
export function announce(
  message: string,
  priority: AnnouncePriority = 'polite',
): void {
  if (!message) return;
  for (const listener of listeners) {
    listener(message, priority);
  }
}

// ---------------------------------------------------------------------------
// Visually-hidden style (matches Tailwind's `sr-only` utility) so the
// component works even in apps that have not opted into Tailwind.
// ---------------------------------------------------------------------------

const SR_ONLY_STYLE: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

// ---------------------------------------------------------------------------
// `<LiveRegion>` component
// ---------------------------------------------------------------------------

/**
 * `<LiveRegion>` mounts the global ARIA live regions used by the ProctiraERP
 * Unified Platform. Mount it **once** inside `<AppShell>` (or any
 * top-level authenticated layout). Two regions are rendered:
 *
 *  - `role="status"`  / `aria-live="polite"`    — non-urgent messages
 *    (sync events, save confirmations, filter result counts).
 *  - `role="alert"`   / `aria-live="assertive"` — blocking errors and
 *    security-relevant events.
 *
 * Anywhere in the tree, components call:
 *
 * ```tsx
 * const announce = useAnnounce();
 * announce('Attendance saved');                 // polite (default)
 * announce('Session expired', 'assertive');     // interrupts SR
 * ```
 *
 * Non-React code can import `announce` directly from this module:
 *
 * ```ts
 * import { announce } from '@proctira/ui-components';
 * announce('12 operations synced');
 * announce('Failed to load students; retrying', 'assertive');
 * ```
 *
 * **Repeated identical messages** clear the region after a short delay
 * (`clearAfterMs`, default 500 ms) and re-set it on the next tick. This
 * forces screen readers to re-read the announcement instead of treating
 * it as an unchanged region.
 *
 * Validates: Requirements 37.4, 37.6, 38.6 — Design L.
 */
export interface LiveRegionProps {
  /**
   * Time in milliseconds after which the active message is cleared so
   * that an identical follow-up announcement is read again. Defaults to
   * 500 ms which matches the recommendation in WAI-ARIA Authoring
   * Practices.
   */
  clearAfterMs?: number;
}

export function LiveRegion({ clearAfterMs = 500 }: LiveRegionProps = {}) {
  const [politeMessage, setPoliteMessage] = React.useState('');
  const [assertiveMessage, setAssertiveMessage] = React.useState('');

  // Track timers per region so we can cancel them when a new message
  // arrives before the previous one cleared.
  const politeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const assertiveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const flushTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  React.useEffect(() => {
    const listener: Listener = (message, priority) => {
      if (priority === 'assertive') {
        if (assertiveTimerRef.current !== null) {
          clearTimeout(assertiveTimerRef.current);
        }
        // Force a re-read by clearing then setting on the next tick.
        setAssertiveMessage('');
        const t = setTimeout(() => setAssertiveMessage(message), 0);
        flushTimerRef.current = t;
        assertiveTimerRef.current = setTimeout(() => {
          setAssertiveMessage('');
          assertiveTimerRef.current = null;
        }, clearAfterMs);
      } else {
        if (politeTimerRef.current !== null) {
          clearTimeout(politeTimerRef.current);
        }
        setPoliteMessage('');
        const t = setTimeout(() => setPoliteMessage(message), 0);
        flushTimerRef.current = t;
        politeTimerRef.current = setTimeout(() => {
          setPoliteMessage('');
          politeTimerRef.current = null;
        }, clearAfterMs);
      }
    };

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (politeTimerRef.current !== null) {
        clearTimeout(politeTimerRef.current);
        politeTimerRef.current = null;
      }
      if (assertiveTimerRef.current !== null) {
        clearTimeout(assertiveTimerRef.current);
        assertiveTimerRef.current = null;
      }
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [clearAfterMs]);

  return (
    <>
      <div
        data-testid="live-region-polite"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        style={SR_ONLY_STYLE}
      >
        {politeMessage}
      </div>
      <div
        data-testid="live-region-assertive"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
        style={SR_ONLY_STYLE}
      >
        {assertiveMessage}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// `useAnnounce()` hook
// ---------------------------------------------------------------------------

/**
 * Returns a stable `announce(message, priority?)` function. The returned
 * reference is identical on every render so it is safe to include in
 * `useEffect` deps without retriggering effects.
 *
 * ```tsx
 * const announce = useAnnounce();
 * useEffect(() => {
 *   if (saved) announce('Attendance saved');
 * }, [saved, announce]);
 * ```
 */
export function useAnnounce(): Announce {
  return React.useCallback<Announce>((message, priority = 'polite') => {
    announce(message, priority);
  }, []);
}

// ---------------------------------------------------------------------------
// Test helpers (intentionally exported so co-located tests can reset
// state between cases without resorting to `vi.resetModules()`).
// ---------------------------------------------------------------------------

/** @internal Clears all subscribers. Test-only. */
export function __resetLiveRegionListeners(): void {
  listeners.clear();
}
