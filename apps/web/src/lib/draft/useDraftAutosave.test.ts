/**
 * @vitest-environment jsdom
 *
 * useDraftAutosave tests — Task 51.1 / Requirement 38 AC 8.
 *
 * Covers:
 *   • debounced writes to localStorage on `save`
 *   • immediate write on `flush` (used at step transitions / submit)
 *   • restore on remount returns the last persisted snapshot
 *   • `clear()` removes the persisted draft
 *   • the autosave interval is clamped to the 30 s ceiling required
 *     by Requirement 38 AC 8 (so a caller cannot accidentally
 *     loosen the contract)
 *   • the storage key matches the design contract
 *     `<brand>-draft:<route>:<formId>`
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  DRAFT_AUTOSAVE_MAX_INTERVAL_MS,
  buildDraftKey,
  useDraftAutosave,
} from './useDraftAutosave';

interface SampleDraft {
  name: string;
  step: number;
}

const FORM_ID = 'registration-draft';

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  // jsdom defaults to `http://localhost/` so `pathname` is `/`. Make
  // it explicit and stable across tests.
  window.history.replaceState(null, '', '/registration/form');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDraftAutosave — storage key', () => {
  it('matches the documented `<brand>-draft:<route>:<formId>` pattern', () => {
    expect(buildDraftKey(FORM_ID)).toBe('proctira-draft:/registration/form:registration-draft');
  });
});

describe('useDraftAutosave — debounced save', () => {
  it('writes to localStorage after the debounce interval elapses', () => {
    const { result } = renderHook(() => useDraftAutosave<SampleDraft>(FORM_ID, 1_000));

    act(() => {
      result.current.save({ name: 'Alex', step: 1 });
    });

    // Before the timer fires, nothing has been written.
    expect(window.localStorage.getItem(buildDraftKey(FORM_ID))).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    const raw = window.localStorage.getItem(buildDraftKey(FORM_ID));
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { values: SampleDraft };
    expect(parsed.values).toEqual({ name: 'Alex', step: 1 });
  });

  it('coalesces rapid edits into a single write at the end of the window', () => {
    const { result } = renderHook(() => useDraftAutosave<SampleDraft>(FORM_ID, 500));

    const setItemSpy = vi.spyOn(window.localStorage.__proto__, 'setItem');

    act(() => {
      result.current.save({ name: 'A', step: 1 });
      vi.advanceTimersByTime(200);
      result.current.save({ name: 'AB', step: 1 });
      vi.advanceTimersByTime(200);
      result.current.save({ name: 'ABC', step: 1 });
    });

    // No write should have happened yet — each `save` reset the timer.
    expect(setItemSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    const raw = window.localStorage.getItem(buildDraftKey(FORM_ID));
    const parsed = JSON.parse(raw!) as { values: SampleDraft };
    expect(parsed.values.name).toBe('ABC');
    setItemSpy.mockRestore();
  });
});

describe('useDraftAutosave — flush', () => {
  it('writes immediately, bypassing the debounce', () => {
    const { result } = renderHook(() => useDraftAutosave<SampleDraft>(FORM_ID, 30_000));

    act(() => {
      result.current.flush({ name: 'Now', step: 2 });
    });

    const raw = window.localStorage.getItem(buildDraftKey(FORM_ID));
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { values: SampleDraft };
    expect(parsed.values).toEqual({ name: 'Now', step: 2 });
  });
});

describe('useDraftAutosave — restore on remount', () => {
  it('returns the last persisted snapshot when the hook remounts', () => {
    // First mount: persist a draft.
    const first = renderHook(() => useDraftAutosave<SampleDraft>(FORM_ID, 30_000));
    act(() => {
      first.result.current.flush({ name: 'Restored', step: 3 });
    });
    first.unmount();

    // Second mount: simulates the user reopening the browser.
    const second = renderHook(() => useDraftAutosave<SampleDraft>(FORM_ID, 30_000));
    expect(second.result.current.values).toEqual({ name: 'Restored', step: 3 });
    expect(second.result.current.savedAt).not.toBeNull();
  });

  it('returns null when the persisted envelope is malformed', () => {
    window.localStorage.setItem(buildDraftKey(FORM_ID), '{not json');
    const { result } = renderHook(() => useDraftAutosave<SampleDraft>(FORM_ID, 30_000));
    expect(result.current.values).toBeNull();
  });

  it('discards drafts persisted under an older schema version', () => {
    // Schema v0 envelope — the hook should reject it.
    window.localStorage.setItem(
      buildDraftKey(FORM_ID),
      JSON.stringify({ v: 0, savedAt: '2025-01-01T00:00:00Z', values: { name: 'old', step: 1 } }),
    );
    const { result } = renderHook(() => useDraftAutosave<SampleDraft>(FORM_ID, 30_000));
    expect(result.current.values).toBeNull();
    // The malformed slot is also wiped so future reads do not retry.
    expect(window.localStorage.getItem(buildDraftKey(FORM_ID))).toBeNull();
  });
});

describe('useDraftAutosave — clear', () => {
  it('removes the persisted draft', () => {
    const { result } = renderHook(() => useDraftAutosave<SampleDraft>(FORM_ID, 30_000));
    act(() => {
      result.current.flush({ name: 'X', step: 1 });
    });
    expect(window.localStorage.getItem(buildDraftKey(FORM_ID))).not.toBeNull();

    act(() => {
      result.current.clear();
    });
    expect(window.localStorage.getItem(buildDraftKey(FORM_ID))).toBeNull();
    expect(result.current.values).toBeNull();
  });
});

describe('useDraftAutosave — interval ceiling', () => {
  it('clamps a > 30 s interval down to 30 s so AC 8 always holds', () => {
    const { result } = renderHook(() => useDraftAutosave<SampleDraft>(FORM_ID, 5 * 60_000));

    act(() => {
      result.current.save({ name: 'Clamped', step: 1 });
    });

    // The caller asked for 5 minutes, but the hook must write within
    // the documented 30 s ceiling.
    act(() => {
      vi.advanceTimersByTime(DRAFT_AUTOSAVE_MAX_INTERVAL_MS);
    });

    const raw = window.localStorage.getItem(buildDraftKey(FORM_ID));
    expect(raw).not.toBeNull();
  });

  it('falls back to the default interval when given a non-positive number', () => {
    const { result } = renderHook(() => useDraftAutosave<SampleDraft>(FORM_ID, -1));

    act(() => {
      result.current.save({ name: 'Default', step: 1 });
      // Advance through the full 30 s window.
      vi.advanceTimersByTime(DRAFT_AUTOSAVE_MAX_INTERVAL_MS);
    });

    expect(window.localStorage.getItem(buildDraftKey(FORM_ID))).not.toBeNull();
  });
});
