/**
 * @vitest-environment jsdom
 *
 * TeacherDashboard tests — Task 52.4 / Requirement 40.7.
 *
 * Verifies that the teacher dashboard renders:
 *   - The headline KPI labels (assigned classes, attendance pending,
 *     pending assessment tasks).
 *   - Today's schedule via `<TimelineSchedule>`.
 *   - The attendance pending list with deep links into the attendance
 *     marking flow.
 *   - The pending assessment task list.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { __TEACHER_DASHBOARD_MOCK__ } from '../api';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    useTeacherDashboard: () => ({
      data: actual.__TEACHER_DASHBOARD_MOCK__,
      isLoading: false,
      error: null,
    }),
  };
});

import TeacherDashboard from '../pages/TeacherDashboard';

function renderDashboard() {
  return render(
    <MemoryRouter>
      <TeacherDashboard />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<TeacherDashboard> — Task 52.4 / Req 40.7', () => {
  it('renders the page heading', () => {
    renderDashboard();
    expect(
      screen.getByRole('heading', { level: 1, name: /teacher dashboard/i }),
    ).toBeTruthy();
  });

  it('renders the headline KPI labels', () => {
    renderDashboard();
    expect(screen.getByText(/assigned classes/i)).toBeTruthy();
    expect(screen.getByText(/^attendance pending$/i)).toBeTruthy();
    // "Pending assessment tasks" appears as the KPI label and as the
    // section heading — the KPI card scopes via data-testid.
    expect(
      screen.getByTestId('kpi-pending-assessments').textContent ?? '',
    ).toMatch(/pending assessment tasks/i);
  });

  it('reflects the assigned-class count from the loaded payload', () => {
    renderDashboard();
    const totalClasses = __TEACHER_DASHBOARD_MOCK__.assignedClasses.length;
    expect(
      screen.getByTestId('kpi-assigned-classes').textContent,
    ).toMatch(String(totalClasses));
  });

  it('renders today\u2019s schedule via the timeline widget', () => {
    renderDashboard();
    expect(screen.getByTestId('today-schedule')).toBeTruthy();
    expect(screen.getAllByTestId('timeline-item').length).toBe(
      __TEACHER_DASHBOARD_MOCK__.todaySchedule.length,
    );
  });

  it('renders the attendance pending list with deep links to the attendance flow', () => {
    renderDashboard();
    expect(screen.getByTestId('attendance-pending')).toBeTruthy();
    const items = screen.getAllByTestId('attendance-pending-item');
    expect(items.length).toBe(
      __TEACHER_DASHBOARD_MOCK__.attendancePending.length,
    );
    const firstLink = items[0]?.querySelector('a');
    expect(firstLink?.getAttribute('href')).toMatch(
      /^\/app\/attendance\/today\?class=/,
    );
  });

  it('renders the pending assessment task checklist', () => {
    renderDashboard();
    expect(screen.getByTestId('pending-assessments')).toBeTruthy();
    expect(screen.getAllByTestId('task-checklist-item').length).toBe(
      __TEACHER_DASHBOARD_MOCK__.pendingAssessments.length,
    );
  });
});
