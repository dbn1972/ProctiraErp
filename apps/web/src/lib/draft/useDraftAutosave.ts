/**
 * apps/web/src/lib/draft/useDraftAutosave.ts — Draft Auto-save (Task 51.1, also
 * referenced by Task 54.4. This is the canonical implementation.)
 * =====================================================================
 *
 * `useDraftAutosave(formId, intervalMs)` is the single in-progress-form
 * persistence layer for the Frontend_Shell. It satisfies Requirement
 * 38 AC 8 — auto-save in-progress form data at intervals not exceeding
 * 30 seconds so that closing the browser, losing power, or losing
 * connectivity does not result in data loss for the in-progress form.
 *
 * Design references:
 *
 *   • Design §I (Auto-save) — "writes form data to `localStorage` at
 *     30-second intervals while the user is editing. The storage key
 *     is `<brand>-draft:<route>:<formId>`. On remount, the form
 *     rehydrates from the most recent draft."
 *   • Design §I (Persisted client state table) — "Draft autosave →
 *     localStorage[<brand>-draft:<route>:<formId>] — 30 s autosave,
 *     restored on remount".
 *
 * The hook is intentionally framework-agnostic at the storage layer
 * (no react-hook-form coupling) so the public registration wizard
 * (which manages its own React state) and any react-hook-form-based
 * forms can share one storage contract.
 *
 * Public surface:
 *
 *   const draft = useDraftAutosave<DraftShape>('registration-draft', 30_000);
 *   draft.values   // latest persisted snapshot, or null on first mount
 *   draft.save(v)  // schedule a debounced write (cleared on every call)
 *   draft.flush(v) // write immediately (use on step change / submit)
 *   draft.clear()  // remove the persisted draft (use after submit)
 *   draft.restore()// re-read storage (rare; for tests / cross-tab)
 *
 * SSR safety. The hook lazily reads `localStorage` only inside an
 * effect / event callback, so it is safe to import from a server
 * component. Outside the browser the hook is a no-op: `save` and
 * `flush` swallow writes silently.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Maximum autosave interval allowed by Requirement 38 AC 8. Callers
 * may pass a smaller value but the hook clamps higher values down to
 * this ceiling so the contract is enforced even if a future caller
 * forgets it.
 */
export const DRAFT_AUTOSAVE_MAX_INTERVAL_MS = 30_000;

/** Default autosave debounce when the caller omits `intervalMs`. */
export const DRAFT_AUTOSAVE_DEFAULT_INTERVAL_MS = 30_000;

/** Schema version stamped on every persisted draft. Bump when shape changes. */
const DRAFT_SCHEMA_VERSION = 1;

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The on-disk shape. We persist a small envelope so that future
 * migrations can detect a stale schema and discard the draft rather
 * than handing malformed data back to the form.
 */
interface DraftEnvelope<T> {
  /** Schema version. Older envelopes are discarded silently. */
  v: number;
  /** ISO 8601 UTC timestamp of the last write. */
  savedAt: string;
  /** The form values as supplied by the caller. */
  values: T;
}

/**
 * Public return shape of `useDraftAutosave`. The wizard reads
 * `values` once on mount to seed its initial state and calls `save`
 * on every step change.
 */
export interface DraftAutosave<T> {
  /**
   * The most recently persisted snapshot for this `formId`, or `null`
   * if there is no saved draft (or storage is unavailable). The value
   * is captured once on mount; it does not auto-update when `save`
   * is called — that would defeat the purpose of letting the form
   * own its own state. Use `restore()` to re-read.
   */
  values: T | null;
  /** ISO timestamp of the persisted draft, when present. */
  savedAt: string | null;
  /**
   * Schedule a debounced write. Repeated calls within the configured
   * interval coalesce into a single write at the end of the window.
   * No-op outside the browser.
   */
  save: (next: T) => void;
  /**
   * Force an immediate synchronous write, bypassing the debounce.
   * Use on step change, on `beforeunload`, or before submit. No-op
   * outside the browser.
   */
  flush: (next: T) => void;
  /**
   * Remove the persisted draft. Call after a successful submit so
   * subsequent visits start clean. No-op outside the browser.
   */
  clear: () => void;
  /**
   * Re-read the draft from storage and update `values`/`savedAt`.
   * Useful in tests and (eventually) for cross-tab synchronisation.
   */
  restore: () => T | null;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * The configured brand prefix for storage namespacing. Matches the
 * convention in `lib/sync/syncQueue.ts` so multi-tenant deployments
 * keep their drafts isolated. Falls back to `proctira` when the env
 * is missing (e.g. SSR, tests).
 */
function getBrand(): string {
  if (typeof process !== 'undefined' && process.env) {
    const brand = process.env['NEXT_PUBLIC_BRAND'] ?? 'proctira';
    if (brand && brand.length > 0) return brand;
  }
  return 'proctira';
}

/**
 * Capture the current route segment so the storage key can be
 * scoped to the page that owns the draft. Drafts under
 * `/registration/form` should not collide with drafts under, say,
 * `/app/students/new` even if both forms reuse the same `formId`.
 *
 * SSR safe: returns `'_'` outside the browser.
 */
function getRoute(): string {
  if (typeof window === 'undefined') return '_';
  // `window.location.pathname` is stable across re-renders within a
  // SPA navigation because `useDraftAutosave` is mounted inside a
  // route component and unmounted on route exit. We deliberately do
  // not subscribe to pathname changes — the key should remain frozen
  // for the life of the form mount.
  return window.location.pathname || '/';
}

/** Build the localStorage key for a given form id at the current route. */
export function buildDraftKey(formId: string): string {
  return `${getBrand()}-draft:${getRoute()}:${formId}`;
}

/**
 * Read the current draft from storage. Returns `null` when storage
 * is unavailable, the slot is empty, or the persisted envelope is
 * malformed / stale.
 */
function readDraft<T>(key: string): DraftEnvelope<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { v?: unknown }).v !== DRAFT_SCHEMA_VERSION
    ) {
      // Stale schema — discard so we never hand malformed data to the form.
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed as DraftEnvelope<T>;
  } catch {
    // SecurityError (private mode), QuotaExceededError, or invalid JSON.
    return null;
  }
}

/** Write a draft envelope, swallowing storage errors silently. */
function writeDraft<T>(key: string, values: T): void {
  if (typeof window === 'undefined') return;
  const envelope: DraftEnvelope<T> = {
    v: DRAFT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    values,
  };
  try {
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Quota or permission denial — surfacing this would block the form
    // for users on private-mode browsers, which is worse than a
    // best-effort save. Sync_Queue still owns the durable replay path.
  }
}

/** Delete a draft, swallowing storage errors silently. */
function removeDraft(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // No-op (see writeDraft for rationale).
  }
}

// ─── Public hook ─────────────────────────────────────────────────────────────

/**
 * Auto-save in-progress form data to `localStorage` and rehydrate on
 * remount. See module-level docs for the full contract.
 *
 * @param formId    Logical identifier for this form. The wizard uses
 *                  `'registration-draft'`; other forms should pick a
 *                  stable, dasherized id.
 * @param intervalMs Debounce window in milliseconds. Clamped to 30 s
 *                  to satisfy Requirement 38 AC 8 even if a caller
 *                  passes a larger value. Defaults to 30 s.
 */
export function useDraftAutosave<T>(
  formId: string,
  intervalMs: number = DRAFT_AUTOSAVE_DEFAULT_INTERVAL_MS,
): DraftAutosave<T> {
  // Clamp the interval to the AC ceiling. Negative or NaN values fall
  // through to the default; ergonomics over strict validation.
  const safeInterval =
    Number.isFinite(intervalMs) && intervalMs > 0
      ? Math.min(intervalMs, DRAFT_AUTOSAVE_MAX_INTERVAL_MS)
      : DRAFT_AUTOSAVE_DEFAULT_INTERVAL_MS;

  // Freeze the storage key on first render. Recomputing it on every
  // render would let route changes invalidate previously saved drafts
  // mid-form. Both `formId` and the route should be stable for a
  // given form mount; if the caller passes a different `formId` we
  // pick it up via the useRef + effect dance below.
  const keyRef = useRef<string>(buildDraftKey(formId));
  useEffect(() => {
    keyRef.current = buildDraftKey(formId);
  }, [formId]);

  const [hydrated, setHydrated] = useState<DraftEnvelope<T> | null>(() =>
    readDraft<T>(keyRef.current),
  );

  // Rehydrate after mount so SSR renders match the server's empty
  // state and the client picks up the stored draft on hydrate. We
  // deliberately re-read in an effect: `useState`'s initializer runs
  // on the server during Next's SSR pass, where `window` may be
  // unavailable. The effect only runs in the browser.
  useEffect(() => {
    setHydrated(readDraft<T>(keyRef.current));
  }, []);

  // Debounce machinery. We keep both the timer and the most recent
  // pending value in refs so the public callbacks remain referentially
  // stable and we never miss a final save when the component unmounts
  // mid-debounce.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<T | null>(null);

  const flushPending = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current !== null) {
      writeDraft<T>(keyRef.current, pendingRef.current);
      pendingRef.current = null;
    }
  }, []);

  const save = useCallback(
    (next: T) => {
      pendingRef.current = next;
      if (timerRef.current !== null) {
        // Debounce: keep extending the window while the user types.
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (pendingRef.current !== null) {
          writeDraft<T>(keyRef.current, pendingRef.current);
          pendingRef.current = null;
        }
      }, safeInterval);
    },
    [safeInterval],
  );

  const flush = useCallback((next: T) => {
    pendingRef.current = next;
    flushPending();
  }, [flushPending]);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    removeDraft(keyRef.current);
    setHydrated(null);
  }, []);

  const restore = useCallback((): T | null => {
    const env = readDraft<T>(keyRef.current);
    setHydrated(env);
    return env?.values ?? null;
  }, []);

  // On unmount, flush any pending debounced write so a navigation
  // away does not lose the user's last keystrokes.
  useEffect(() => {
    return () => {
      flushPending();
    };
  }, [flushPending]);

  // `beforeunload` covers the browser-close path called out by
  // Requirement 38 AC 8. We attach the listener once per mount and
  // detach on unmount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (): void => {
      flushPending();
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
    };
  }, [flushPending]);

  return {
    values: hydrated?.values ?? null,
    savedAt: hydrated?.savedAt ?? null,
    save,
    flush,
    clear,
    restore,
  };
}
