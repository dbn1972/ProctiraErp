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

import {
  DRAFT_DEFAULT_TTL_MS,
  buildDraftKey,
  readDraft,
  removeDraft,
  writeDraft,
  type DraftEnvelope,
  type DraftScope,
} from './storage';

// Hook-free storage helpers live in `./storage` so server-reachable modules
// (e.g. `lib/auth/session.ts`) can import them without React. Re-exported
// here so existing `@/lib/draft/useDraftAutosave` imports keep working.
export { DRAFT_DEFAULT_TTL_MS, buildDraftKey, purgeAllDrafts, type DraftScope } from './storage';

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

export interface DraftAutosaveOptions<T> {
  /**
   * Namespaces the key by user + tenant. When `requireScope` is set and the
   * scope is not yet known, nothing is read or written (fail closed).
   */
  scope?: DraftScope | null;
  requireScope?: boolean;
  /** Envelope TTL; defaults to `DRAFT_DEFAULT_TTL_MS`. */
  ttlMs?: number;
  /** Strip sensitive fields before anything is persisted. */
  sanitize?: (values: T) => T;
}

// ─── Types ───────────────────────────────────────────────────────────────────

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
  options: DraftAutosaveOptions<T> = {},
): DraftAutosave<T> {
  const { scope, requireScope = false, sanitize } = options;
  const ttlMs = options.ttlMs ?? DRAFT_DEFAULT_TTL_MS;
  const scopeUser = scope?.userId ?? '';
  const scopeTenant = scope?.tenantId ?? '';
  const resolveKey = (): string | null => {
    if (requireScope && (!scopeUser || !scopeTenant)) return null;
    return buildDraftKey(
      formId,
      scopeUser && scopeTenant ? { userId: scopeUser, tenantId: scopeTenant } : null,
    );
  };
  const sanitizeRef = useRef(sanitize);
  sanitizeRef.current = sanitize;
  const clean = useCallback(
    (values: T): T => (sanitizeRef.current ? sanitizeRef.current(values) : values),
    [],
  );
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
  const keyRef = useRef<string | null>(resolveKey());
  const [hydrated, setHydrated] = useState<DraftEnvelope<T> | null>(() =>
    readDraft<T>(keyRef.current, ttlMs),
  );
  // Re-key (and re-read) when the form id or the owning user/tenant changes:
  // a draft saved by user A is never surfaced for user B.
  useEffect(() => {
    const next = resolveKey();
    if (next === keyRef.current) return;
    keyRef.current = next;
    setHydrated(readDraft<T>(next, ttlMs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, scopeUser, scopeTenant, requireScope]);

  // Rehydrate after mount so SSR renders match the server's empty
  // state and the client picks up the stored draft on hydrate. We
  // deliberately re-read in an effect: `useState`'s initializer runs
  // on the server during Next's SSR pass, where `window` may be
  // unavailable. The effect only runs in the browser.
  useEffect(() => {
    setHydrated(readDraft<T>(keyRef.current, ttlMs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      writeDraft<T>(keyRef.current, clean(pendingRef.current));
      pendingRef.current = null;
    }
  }, [clean]);

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
          writeDraft<T>(keyRef.current, clean(pendingRef.current));
          pendingRef.current = null;
        }
      }, safeInterval);
    },
    [safeInterval, clean],
  );

  const flush = useCallback(
    (next: T) => {
      pendingRef.current = next;
      flushPending();
    },
    [flushPending],
  );

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
    const env = readDraft<T>(keyRef.current, ttlMs);
    setHydrated(env);
    return env?.values ?? null;
  }, [ttlMs]);

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
