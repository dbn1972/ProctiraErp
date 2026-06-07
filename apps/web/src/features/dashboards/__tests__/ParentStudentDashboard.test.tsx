/**
 * @vitest-environment jsdom
 *
 * ParentStudentDashboard tests — Task 52.4 / Requirement 40.8.
 *
 * Verifies that the parent / student personal dashboard renders:
 *   - Attendance summary KPIs (rate, days present, days absent, days
 *     late).
 *   - Recent assessment results table with all five rows from the
 *     mocked payload.
 *   - Today's schedule via `<TimelineSchedule>`.
 *   - Notifications list with the expected items.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { __PARENT_STUDENT_DASHBOARD_MOCK__ } from '../api';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    useParentStudentDashboard: () => ({
      data: actual.__PARENT_STUDENT_DASHBOARD_MOCK__,
      isLoading: false,
      error: null,
    }),
  };
});

import ParentStudentDashboard from '../pages/ParentStudentDashboard';

function renderDashboard() {
  return render(
    <MemoryRouter>
      <ParentStudentDashboard />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<ParentStudentDashboard> — Task 52.4 / Req 40.8', () => {
  it('renders the page heading', () => {
    renderDashboard();
    expect(
      screen.getByRole('heading', { level: 1, name: /my dashboard/i }),
    ).toBeTruthy();
  });

  it('renders the attendance summary KPI labels', () => {
    renderDashboard();
    expect(screen.getByText(/attendance rate/i)).toBeTruthy();
    expect(screen.getByText(/days present/i)).toBeTruthy();
    expect(screen.getByText(/days absent/i)).toBeTruthy();
    expect(screen.getByText(/days late/i)).toBeTruthy();
  });

  it('formats the attendance rate from the loaded payload', () => {
    renderDashboard();
    const text = screen.getByTestId('kpi-attendance-rate').textContent ?? '';
    // 94.2% — one decimal place
    expect(text).toMatch(/94\.2%/);
  });

  it('renders the recent assessment results table with all rows', () => {
    renderDashboard();
    const table = screen.getByTestId('recent-results');
    // Every subject from the mock payload should appear in the table.
    for (const result of __PARENT_STUDENT_DASHBOARD_MOCK__.recentResults) {
      // Some subjects (e.g. Mathematics) also appear in the schedule
      // widget, so we scope the lookup to the results table.
      const matches = table.textContent ?? '';
      expect(matches).toContain(result.subject);
      expect(matches).toContain(result.grade);
    }
  });

  it('renders today\u2019s schedule via the timeline widget', () => {
    renderDashboard();
    expect(screen.getByTestId('today-schedule')).toBeTruthy();
    expect(screen.getAllByTestId('timeline-item').length).toBe(
      __PARENT_STUDENT_DASHBOARD_MOCK__.schedule.length,
    );
  });

  it('renders the notifications list with all messages', () => {
    renderDashboard();
    expect(screen.getByTestId('notifications')).toBeTruthy();
    expect(screen.getAllByTestId('notification-item').length).toBe(
      __PARENT_STUDENT_DASHBOARD_MOCK__.notifications.length,
    );
  });
});
