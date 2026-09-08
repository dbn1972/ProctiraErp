/**
 * @vitest-environment jsdom
 *
 * MobileAttendanceForm tests — Task 53.3 / Requirements 41.3, 41.5, 9.1.
 *
 * Covers the four contracts called out by the task:
 *
 *   1. Touch-target sizing — every status button advertises the
 *      ≥ 48 × 48 px floor (`min-h-[48px]` / `min-w-[48px]`) and the
 *      four buttons sit inside a `gap-3` (12 px) container, so the
 *      Touch_Target rules in Requirement 37 AC 3 are satisfied.
 *
 *   2. Button state transitions — clicking a status flips
 *      `aria-checked` (and the `data-active` flag) on the chosen
 *      button while clearing it on the previously-selected sibling,
 *      proving the "filled vs outline" indication is real and not
 *      hover-driven (Requirement 41 AC 5).
 *
 *   3. Selection mutations are written through `useDraftAutosave`.
 *      Advancing fake timers past the autosave debounce flushes the
 *      latest grid into `localStorage` under the slot key the hook
 *      builds — the integration that lets a clerk who closed the tab
 *      pick up where they left off (Requirement 38 AC 8).
 *
 *   4. Submission routes through the same data layer as desktop and
 *      falls through to `enqueue()` when offline. We assert this by
 *      driving the `isOnlineOverride` test seam; the form invokes
 *      the injected submitter when online and skips it entirely when
 *      offline, calling the Sync_Queue instead.
 */

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import {
  MobileAttendanceForm,
  type MobileAttendanceSubmitResult,
  type MobileAttendanceSubmission,
} from './MobileAttendanceForm';
import { buildDraftKey } from '@/lib/draft/useDraftAutosave';
import {
  _resetForTests as resetSyncQueueForTests,
  peekAll as peekSyncQueue,
} from '@/lib/sync/syncQueue';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const INST = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PERIOD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const ROSTER = [
  {
    studentId: 'student-1',
    studentName: 'Alex Doe',
    enrollmentId: 'e-1',
    classId: CLASS_ID,
    gradeId: 'g-1',
  },
  {
    studentId: 'student-2',
    studentName: 'Bea Roe',
    enrollmentId: 'e-2',
    classId: CLASS_ID,
    gradeId: 'g-1',
  },
];

const DEFAULTS = {
  institutionId: INST,
  classId: CLASS_ID,
  academicPeriodId: PERIOD,
  date: '2024-01-15',
};

beforeEach(async () => {
  // Clear localStorage and the Sync_Queue under real timers — we
  // cannot register fake timers globally because `fake-indexeddb`
  // dispatches its async work through `setTimeout`. Tests that need
  // to advance the autosave debounce opt in to fake timers locally.
  window.localStorage.clear();
  await resetSyncQueueForTests();
  // Pin the path so the autosave hook builds a stable slot key.
  window.history.replaceState(null, '', '/app/attendance');
});

afterEach(async () => {
  cleanup();
  if (vi.isFakeTimers()) {
    vi.useRealTimers();
  }
  window.localStorage.clear();
  await resetSyncQueueForTests();
});

// ─── Touch-target sizing (Requirement 41.3 / 37 AC 3) ────────────────────────

describe('<MobileAttendanceForm> — touch-target sizing', () => {
  it('renders four status buttons per row, each at the 48 × 48 px floor', () => {
    render(<MobileAttendanceForm roster={ROSTER} defaults={DEFAULTS} />);

    for (const row of ROSTER) {
      const group = screen.getByTestId(`mobile-attendance-status-group-${row.studentId}`);
      const buttons = group.querySelectorAll('[role="radio"]');
      expect(buttons.length).toBe(4);
      for (const button of Array.from(buttons)) {
        const className = button.getAttribute('class') ?? '';
        expect(className).toContain('min-h-[48px]');
        expect(className).toContain('min-w-[48px]');
      }
      // The container holds the four buttons with the 12 px (`gap-3`)
      // separation Requirement 37 AC 3 requires.
      expect(group.getAttribute('class') ?? '').toContain('gap-3');
    }
  });

  it('paints an icon next to each status label so the control is not icon-only', () => {
    render(<MobileAttendanceForm roster={ROSTER} defaults={DEFAULTS} />);

    const group = screen.getByTestId(`mobile-attendance-status-group-${ROSTER[0]!.studentId}`);
    const buttons = Array.from(group.querySelectorAll('[role="radio"]'));
    for (const button of buttons) {
      // lucide-react icons render as <svg>; the text label sits in a
      // sibling <span>. Both must be present so the affordance is
      // discoverable without colour alone (Requirement 37 AC 7).
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.textContent ?? '').toMatch(/Present|Absent|Late|Excused/);
    }
  });

  it('keeps the comment toggle at the 48 × 48 px floor', () => {
    render(<MobileAttendanceForm roster={ROSTER} defaults={DEFAULTS} />);
    const toggle = screen.getByTestId(`mobile-attendance-comment-toggle-${ROSTER[0]!.studentId}`);
    const className = toggle.getAttribute('class') ?? '';
    expect(className).toContain('h-12');
    expect(className).toContain('w-12');
  });
});

// ─── Button state transitions (Requirement 41 AC 5) ─────────────────────────

describe('<MobileAttendanceForm> — button state transitions', () => {
  it('marks PRESENT as the initial active selection', () => {
    render(<MobileAttendanceForm roster={ROSTER} defaults={DEFAULTS} />);
    const present = screen.getByTestId(`mobile-attendance-status-${ROSTER[0]!.studentId}-PRESENT`);
    expect(present.getAttribute('aria-checked')).toBe('true');
    expect(present.getAttribute('data-active')).toBe('true');
  });

  it('flips active state on click and clears the previous selection', () => {
    render(<MobileAttendanceForm roster={ROSTER} defaults={DEFAULTS} />);
    const present = screen.getByTestId(`mobile-attendance-status-${ROSTER[0]!.studentId}-PRESENT`);
    const absent = screen.getByTestId(`mobile-attendance-status-${ROSTER[0]!.studentId}-ABSENT`);

    act(() => {
      fireEvent.click(absent);
    });

    expect(absent.getAttribute('aria-checked')).toBe('true');
    expect(absent.getAttribute('data-active')).toBe('true');
    expect(present.getAttribute('aria-checked')).toBe('false');
    expect(present.getAttribute('data-active')).toBe('false');
  });

  it('does not affect sibling rows when one row changes', () => {
    render(<MobileAttendanceForm roster={ROSTER} defaults={DEFAULTS} />);
    const row1Late = screen.getByTestId(`mobile-attendance-status-${ROSTER[0]!.studentId}-LATE`);

    act(() => {
      fireEvent.click(row1Late);
    });

    // Row 2 must remain at the default PRESENT selection.
    const row2Present = screen.getByTestId(
      `mobile-attendance-status-${ROSTER[1]!.studentId}-PRESENT`,
    );
    expect(row2Present.getAttribute('aria-checked')).toBe('true');
  });

  it('toggles the comment input via an explicit on-screen control (no hover)', () => {
    render(<MobileAttendanceForm roster={ROSTER} defaults={DEFAULTS} />);
    const toggle = screen.getByTestId(`mobile-attendance-comment-toggle-${ROSTER[0]!.studentId}`);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Comment input is hidden until the toggle is clicked.
    expect(
      screen.queryByTestId(`mobile-attendance-comment-input-${ROSTER[0]!.studentId}`),
    ).toBeNull();

    act(() => {
      fireEvent.click(toggle);
    });

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByTestId(`mobile-attendance-comment-input-${ROSTER[0]!.studentId}`),
    ).toBeTruthy();
  });
});

// ─── Selection mutations are persisted through useDraftAutosave ─────────────

describe('<MobileAttendanceForm> — useDraftAutosave integration', () => {
  it('persists status changes to localStorage after the autosave debounce', () => {
    vi.useFakeTimers();
    try {
      render(<MobileAttendanceForm roster={ROSTER} defaults={DEFAULTS} />);

      const absent = screen.getByTestId(`mobile-attendance-status-${ROSTER[0]!.studentId}-ABSENT`);
      act(() => {
        fireEvent.click(absent);
      });

      // The hook debounces at the 30 s ceiling; advance past it.
      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      const slot = buildDraftKey(`mobile-attendance-marking-${PERIOD}`);
      const raw = window.localStorage.getItem(slot);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!) as {
        values: {
          rows: Array<{ studentId: string; status: string }>;
        };
      };
      const persisted = parsed.values.rows.find((r) => r.studentId === ROSTER[0]!.studentId);
      expect(persisted?.status).toBe('ABSENT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores a persisted draft on remount instead of reading the props', () => {
    const slot = buildDraftKey(`mobile-attendance-marking-${PERIOD}`);
    window.localStorage.setItem(
      slot,
      JSON.stringify({
        v: 1,
        savedAt: '2024-01-15T08:00:00.000Z',
        values: {
          institutionId: INST,
          classId: CLASS_ID,
          academicPeriodId: PERIOD,
          date: '2024-01-16',
          rows: [
            {
              studentId: 'student-1',
              studentName: 'Alex Doe',
              status: 'LATE',
              comment: 'bus delay',
            },
            {
              studentId: 'student-2',
              studentName: 'Bea Roe',
              status: 'EXCUSED',
              comment: '',
            },
          ],
        },
      }),
    );

    render(<MobileAttendanceForm roster={ROSTER} defaults={DEFAULTS} />);

    expect(
      screen
        .getByTestId(`mobile-attendance-status-${ROSTER[0]!.studentId}-LATE`)
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen
        .getByTestId(`mobile-attendance-status-${ROSTER[1]!.studentId}-EXCUSED`)
        .getAttribute('aria-checked'),
    ).toBe('true');
  });
});

// ─── Submission routing — online vs offline ─────────────────────────────────

describe('<MobileAttendanceForm> — submission routing', () => {
  it('invokes the supplied submitter when online', async () => {
    const submit = vi.fn(
      async (_payload: MobileAttendanceSubmission): Promise<MobileAttendanceSubmitResult> => ({
        status: 'success',
      }),
    );

    render(
      <MobileAttendanceForm
        roster={ROSTER}
        defaults={DEFAULTS}
        submit={submit}
        isOnlineOverride={true}
      />,
    );

    const submitButton = screen.getByTestId('mobile-attendance-submit');

    await act(async () => {
      fireEvent.click(submitButton);
    });
    // Allow the awaited submitter + state updates to flush.
    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });

    const payload = submit.mock.calls[0]![0];
    expect(payload.classId).toBe(CLASS_ID);
    expect(payload.records.length).toBe(ROSTER.length);
    expect(payload.records[0]!.status).toBe('PRESENT');

    // Sync_Queue must remain empty when the online submission succeeds.
    expect(await peekSyncQueue()).toHaveLength(0);
  });

  it('routes the bulk payload through Sync_Queue.enqueue when offline', async () => {
    const submit = vi.fn(
      async (_payload: MobileAttendanceSubmission): Promise<MobileAttendanceSubmitResult> => ({
        status: 'success',
      }),
    );

    render(
      <MobileAttendanceForm
        roster={ROSTER}
        defaults={DEFAULTS}
        submit={submit}
        isOnlineOverride={false}
        tenantId="tenant-abc"
        userId="user-xyz"
      />,
    );

    const submitButton = screen.getByTestId('mobile-attendance-submit');

    await act(async () => {
      fireEvent.click(submitButton);
    });

    // The submitter must NOT be called — offline routes straight to
    // the Sync_Queue.
    expect(submit).not.toHaveBeenCalled();

    // Wait for the enqueue to land.
    await waitFor(async () => {
      const queued = await peekSyncQueue();
      expect(queued.length).toBe(1);
    });
    const queued = await peekSyncQueue();
    expect(queued).toHaveLength(1);
    const op = queued[0]!;
    expect(op.tenantId).toBe('tenant-abc');
    expect(op.userId).toBe('user-xyz');
    expect(op.operationType).toBe('POST');
    expect(op.targetEntity).toBe('attendance');
    expect(op.payload.url).toContain('/attendance/student/bulk');
    const body = JSON.parse(op.payload.body ?? '{}') as {
      classId: string;
      records: unknown[];
    };
    expect(body.classId).toBe(CLASS_ID);
    expect(body.records.length).toBe(ROSTER.length);

    // The user gets a "queued" status banner, not an error.
    await waitFor(() => {
      const banner = screen.getByTestId('mobile-attendance-submission-banner');
      expect(banner.getAttribute('data-status')).toBe('queued');
    });
  });

  it('falls through to Sync_Queue when an online submission fails', async () => {
    const submit = vi.fn(
      async (_payload: MobileAttendanceSubmission): Promise<MobileAttendanceSubmitResult> => ({
        status: 'error',
        message: 'boom',
      }),
    );

    render(
      <MobileAttendanceForm
        roster={ROSTER}
        defaults={DEFAULTS}
        submit={submit}
        isOnlineOverride={true}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('mobile-attendance-submit'));
    });

    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });
    await waitFor(async () => {
      const queued = await peekSyncQueue();
      expect(queued.length).toBe(1);
    });
    const queued = await peekSyncQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.targetEntity).toBe('attendance');
  });
});
