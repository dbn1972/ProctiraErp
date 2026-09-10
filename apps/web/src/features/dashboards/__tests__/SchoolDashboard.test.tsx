/**
 * @vitest-environment jsdom
 *
 * SchoolDashboard tests — Task 52.4 / Requirement 40.6.
 *
 * Verifies that the principal dashboard:
 *   - Renders the headline KPI labels (enrollment, attendance %, staff
 *     utilization, pending approvals).
 *   - Mounts the persistent `<ConnectivityIndicator>` so the offline/
 *     online state is visible at a glance (Req 38.1).
 *   - Surfaces quick-action shortcuts to the attendance and student
 *     creation flows.
 *
 * The dashboard hook is mocked so the test can render the loaded state
 * deterministically; the connectivity provider is mocked so the
 * indicator can resolve without live navigator.onLine plumbing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { NextIntlClientProvider } from 'next-intl';

import enMessages from '@/messages/en.json';

import { __SCHOOL_DASHBOARD_MOCK__ } from '../api';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    useSchoolDashboard: () => ({
      data: actual.__SCHOOL_DASHBOARD_MOCK__,
      isLoading: false,
      error: null,
    }),
  };
});

vi.mock('@/providers/ConnectivityProvider', () => ({
  useConnectivity: () => ({
    status: 'online' as const,
    isOnline: true,
    isSyncing: false,
    checkConnectivity: vi.fn(),
    replaySyncQueue: vi.fn(),
  }),
}));

import SchoolDashboard from '../pages/SchoolDashboard';

// ─── Harness ─────────────────────────────────────────────────────────────────

function renderDashboard() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MemoryRouter>
        <SchoolDashboard />
      </MemoryRouter>
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('<SchoolDashboard> — Task 52.4 / Req 40.6', () => {
  it('renders the page heading', () => {
    renderDashboard();
    expect(screen.getByRole('heading', { level: 1, name: /school dashboard/i })).toBeTruthy();
  });

  it('renders all four headline KPI labels', () => {
    renderDashboard();
    expect(screen.getByText(/total enrollment/i)).toBeTruthy();
    expect(screen.getByText(/today's attendance/i)).toBeTruthy();
    expect(screen.getByText(/staff utilization/i)).toBeTruthy();
    expect(screen.getByText(/pending approvals/i)).toBeTruthy();
  });

  it('formats KPI values from the loaded payload', () => {
    renderDashboard();
    const { kpis } = __SCHOOL_DASHBOARD_MOCK__;
    // 1,247 — formatted via Intl.NumberFormat
    expect(screen.getByTestId('kpi-total-students').textContent).toMatch(/1,247/);
    // 94.2% — one decimal place
    expect(screen.getByTestId('kpi-attendance').textContent).toMatch(/94\.0%|94\.2%/);
    expect(screen.getByTestId('kpi-pending-approvals').textContent).toMatch(
      String(kpis.pendingApprovals),
    );
  });

  it('mounts the persistent <ConnectivityIndicator> in the header', () => {
    renderDashboard();
    expect(screen.getByTestId('connectivity-indicator')).toBeTruthy();
    expect(screen.getByTestId('school-dashboard-connectivity')).toBeTruthy();
  });

  it('renders the "Mark attendance" quick action linking to /app/attendance/today', () => {
    renderDashboard();
    const link = screen.getByTestId('action-mark-attendance');
    // `Button asChild` renders the child Link directly, so the testid lands
    // on the anchor itself rather than on a wrapping element.
    expect(link.tagName.toLowerCase()).toBe('a');
    expect(link.getAttribute('href')).toBe('/app/attendance/today');
  });

  it('renders the "Add student" quick action linking to /app/students/new', () => {
    renderDashboard();
    const link = screen.getByTestId('action-add-student');
    expect(link.tagName.toLowerCase()).toBe('a');
    expect(link.getAttribute('href')).toBe('/app/students/new');
  });

  it('renders a recent activity feed and a pending tasks list', () => {
    renderDashboard();
    expect(screen.getByTestId('recent-activity')).toBeTruthy();
    expect(screen.getAllByTestId('recent-activity-item').length).toBeGreaterThan(0);
    expect(screen.getByTestId('pending-tasks')).toBeTruthy();
  });
});
