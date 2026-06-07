/**
 * @vitest-environment jsdom
 *
 * MobileStudentProfile tests — Task 53.4 / Requirement 41.4, 41.5, Design §H.
 *
 * Verifies the four contracts called out by Task 53.4:
 *
 *   1. Avatar and key identifiers render — the student's initials live
 *      inside the `<Avatar>` fallback, and the full name, grade /
 *      section, and student number are present at top of the page.
 *
 *   2. The three required tabs (Personal Info, Attendance, Results)
 *      render and are clickable — clicking each tab swaps the
 *      `<TabsContent>` panel and updates `data-state="active"` on the
 *      matching `<TabsTrigger>`.
 *
 *   3. Chevrons inside the tab bar use `<DirectionalIcon>` — the
 *      previous/next chevrons emit the `data-rtl-flipped` attribute
 *      (the wrapper's marker) when the document is in RTL mode and
 *      omit the marker in LTR.
 *
 *   4. The page does not overflow the 320 px viewport floor — the
 *      root container is constrained with `overflow-x-hidden` and
 *      `max-w-full`, which is the same guard the Mobile_View
 *      acceptance criterion in Requirement 41 AC 4 requires.
 *
 * jsdom does not implement layout, so this suite asserts the
 * structural / class contract rather than trying to measure pixel
 * widths. The Playwright property test in Task 53.6 is the runtime
 * arbiter for the 48 px / no-horizontal-scroll guarantees.
 */

import { afterEach, describe, expect, it, beforeEach, beforeAll, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';

import MobileStudentProfile from '../MobileStudentProfile';

beforeAll(() => {
  // Radix's roving-focus group calls ResizeObserver internally. jsdom
  // does not implement it, so we shim it out — a no-op observer keeps
  // the activation path running without affecting the assertions.
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => {
  // Reset the document direction between tests so the LTR / RTL
  // assertions are independent. The `<DirectionalIcon>` wrapper reads
  // `document.documentElement.dir` when no explicit `dir` prop is
  // supplied (see `packages/ui/components/src/DirectionalIcon.tsx`).
  document.documentElement.dir = '';
});

afterEach(() => {
  cleanup();
  document.documentElement.dir = '';
  if (vi.isFakeTimers()) {
    vi.useRealTimers();
  }
});

/**
 * Activates the named tab via keyboard navigation. Radix's roving-focus
 * group filters synthetic clicks under jsdom (it expects a real pointer
 * event), but ArrowRight / ArrowLeft on a focused trigger exercises the
 * same activation path — and matches the keyboard contract asserted by
 * `packages/ui/components/src/Tabs.keyboard.test.tsx`.
 *
 * Radix schedules its post-keydown focus shift inside `setTimeout(_, 0)`,
 * so the helper drives fake timers and flushes the queue after each key
 * press to keep the assertions synchronous.
 */
function activateTab(testId: string): void {
  const target = screen.getByTestId(testId);
  if (target.getAttribute('data-state') === 'active') {
    return;
  }
  const tabs = screen
    .getAllByRole('tab')
    .filter((t) => t instanceof HTMLElement) as HTMLElement[];
  const active =
    tabs.find((t) => t.getAttribute('data-state') === 'active') ?? tabs[0]!;
  act(() => {
    active.focus();
  });
  let cursor: HTMLElement = active;
  let safety = tabs.length + 1;
  while (cursor !== target && safety-- > 0) {
    act(() => {
      fireEvent.keyDown(cursor, { key: 'ArrowRight', code: 'ArrowRight' });
    });
    act(() => {
      vi.runAllTimers();
    });
    cursor = (document.activeElement as HTMLElement | null) ?? cursor;
  }
}

// ─── Avatar + key identifiers (Requirement 41 AC 4) ──────────────────────────

describe('<MobileStudentProfile> — avatar and key identifiers', () => {
  it('renders the student avatar with initials in the fallback', () => {
    render(<MobileStudentProfile />);

    const avatar = screen.getByTestId('student-avatar');
    expect(avatar).toBeTruthy();
    // The Avatar fallback shows "AH" for the demo Ahmed Hassan record.
    expect(within(avatar).getByText('AH')).toBeTruthy();
  });

  it('renders the full name, grade / section, and student number', () => {
    render(<MobileStudentProfile />);

    expect(screen.getByTestId('student-full-name').textContent).toContain(
      'Ahmed Hassan',
    );
    expect(screen.getByTestId('student-grade-section').textContent).toContain(
      'Grade 5 - Section A',
    );
    expect(screen.getByTestId('student-number').textContent).toContain(
      'STU-2024-001234',
    );
  });

  it('renders the three quick-stat KPIs (Attendance, Grade, Rank)', () => {
    render(<MobileStudentProfile />);

    expect(screen.getByTestId('kpi-attendance').textContent).toMatch(/94\.2%/);
    expect(screen.getByTestId('kpi-grade').textContent).toMatch(/B\+/);
    expect(screen.getByTestId('kpi-rank').textContent).toMatch(/8\s*\/\s*42/);
  });
});

// ─── Three tabs render and are clickable (Requirement 41 AC 4) ───────────────

describe('<MobileStudentProfile> — tabbed sections', () => {
  it('renders all three tabs (Personal Info, Attendance, Results)', () => {
    render(<MobileStudentProfile />);

    const info = screen.getByTestId('tab-info');
    const attendance = screen.getByTestId('tab-attendance');
    const results = screen.getByTestId('tab-results');

    expect(info.textContent).toContain('Personal Info');
    expect(attendance.textContent).toContain('Attendance');
    expect(results.textContent).toContain('Results');
  });

  it('opens Personal Info by default and shows the personal info panel', () => {
    render(<MobileStudentProfile />);

    const info = screen.getByTestId('tab-info');
    expect(info.getAttribute('data-state')).toBe('active');
    // The Personal Information heading and one of the demo rows.
    expect(screen.getByText(/Personal Information/i)).toBeTruthy();
    expect(screen.getByText(/Date of Birth/i)).toBeTruthy();
  });

  it('switches to the Attendance tab on click', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<MobileStudentProfile />);

    activateTab('tab-attendance');

    expect(screen.getByTestId('tab-attendance').getAttribute('data-state')).toBe(
      'active',
    );
    expect(screen.getByText(/Attendance Summary/i)).toBeTruthy();
    expect(screen.getByText(/Recent History/i)).toBeTruthy();
  });

  it('switches to the Results tab on click', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<MobileStudentProfile />);

    activateTab('tab-results');

    expect(screen.getByTestId('tab-results').getAttribute('data-state')).toBe(
      'active',
    );
    expect(screen.getByText(/Recent Results/i)).toBeTruthy();
    expect(screen.getByText(/Mathematics/)).toBeTruthy();
  });
});

// ─── DirectionalIcon usage in the tab bar (Requirement 18 AC 11) ─────────────

describe('<MobileStudentProfile> — chevrons use <DirectionalIcon>', () => {
  it('does not flip the chevrons in LTR (no data-rtl-flipped marker)', () => {
    document.documentElement.dir = 'ltr';
    render(<MobileStudentProfile />);

    const prev = screen.getByTestId('tab-prev-chevron');
    const next = screen.getByTestId('tab-next-chevron');

    // `<DirectionalIcon>` only adds `data-rtl-flipped="true"` in RTL.
    expect(prev.getAttribute('data-rtl-flipped')).toBeNull();
    expect(next.getAttribute('data-rtl-flipped')).toBeNull();
  });

  it('flips the chevrons when the document is in RTL', () => {
    document.documentElement.dir = 'rtl';
    render(<MobileStudentProfile />);

    const prev = screen.getByTestId('tab-prev-chevron');
    const next = screen.getByTestId('tab-next-chevron');

    expect(prev.getAttribute('data-rtl-flipped')).toBe('true');
    expect(next.getAttribute('data-rtl-flipped')).toBe('true');
    // The flip class from `DirectionalIcon`.
    expect(prev.classList.contains('-scale-x-100')).toBe(true);
    expect(next.classList.contains('-scale-x-100')).toBe(true);
  });
});

// ─── No horizontal scrolling guard (Requirement 41 AC 4) ─────────────────────

describe('<MobileStudentProfile> — 320 px viewport contract', () => {
  it('marks the root container with overflow-x-hidden and max-w-full', () => {
    render(<MobileStudentProfile />);

    const root = screen.getByTestId('mobile-student-profile');
    expect(root.className).toMatch(/overflow-x-hidden/);
    expect(root.className).toMatch(/max-w-full/);
  });

  it('uses a 3-column grid for the tab strip so it fits without scrolling', () => {
    render(<MobileStudentProfile />);

    // The `<TabsList>` is the parent of the three triggers; it must use
    // `grid-cols-3` (not `flex` with overflow) so all three labels fit
    // at 320 px without horizontal scrolling.
    const trigger = screen.getByTestId('tab-info');
    const list = trigger.parentElement;
    expect(list).not.toBeNull();
    expect(list?.className ?? '').toMatch(/grid-cols-3/);
  });

  it('does not render an overflow-x-auto / overflow-x-scroll container', () => {
    const { container } = render(<MobileStudentProfile />);
    // Walk every descendant — none of them should opt back into
    // horizontal scrolling. A class match is the closest jsdom can get
    // to the Playwright width assertion in Task 53.6.
    const scrollers = container.querySelectorAll(
      '[class*="overflow-x-auto"], [class*="overflow-x-scroll"]',
    );
    expect(scrollers.length).toBe(0);
  });
});
