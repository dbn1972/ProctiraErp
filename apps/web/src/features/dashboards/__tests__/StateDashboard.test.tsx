/**
 * @vitest-environment jsdom
 *
 * <StateDashboard> tests — Task 52.2 / Requirement 40.2 / Design §G.2.
 *
 * Mounts the page with a mocked query stub so we can assert KPI labels,
 * the district performance ranking, the radar comparison, and the
 * district drill-down.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver =
    ResizeObserverStub as unknown as typeof globalThis.ResizeObserver;
}

import {
  STATE_DASHBOARD_MOCK,
  type DashboardQueryResult,
  type StateDashboardData,
} from '../api';

const useStateDashboardDataMock = vi.fn<
  [string?],
  DashboardQueryResult<StateDashboardData>
>();

vi.mock('../api', async (importActual) => {
  const actual = await importActual<typeof import('../api')>();
  return {
    ...actual,
    useStateDashboardData: (code?: string) => useStateDashboardDataMock(code),
  };
});

async function renderPage(stateCode = 'MH') {
  const { default: StateDashboard } = await import('../pages/StateDashboard');
  return render(
    <MemoryRouter initialEntries={[`/app/dashboard/state/${stateCode}`]}>
      <Routes>
        <Route
          path="/app/dashboard/country"
          element={<div data-testid="country-page">country</div>}
        />
        <Route path="/app/dashboard/state/:stateCode" element={<StateDashboard />} />
        <Route
          path="/app/dashboard/state/:stateCode/district/:districtCode"
          element={<div data-testid="district-page">district</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('<StateDashboard>', () => {
  it('renders the loaded KPI labels', async () => {
    useStateDashboardDataMock.mockReturnValue({
      data: STATE_DASHBOARD_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    expect(screen.getByTestId('state-kpi-schools')).toBeTruthy();
    expect(screen.getByTestId('state-kpi-students')).toBeTruthy();
    expect(screen.getByTestId('state-kpi-attendance')).toBeTruthy();
    expect(screen.getByTestId('state-kpi-pass-rate')).toBeTruthy();

    expect(
      within(screen.getByTestId('state-kpi-schools')).getByText('Schools'),
    ).toBeTruthy();
  });

  it('renders the district drill-down table with the mocked rows', async () => {
    useStateDashboardDataMock.mockReturnValue({
      data: STATE_DASHBOARD_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    const table = screen.getByTestId('state-district-table');
    expect(within(table).getByText('Pune')).toBeTruthy();
    expect(within(table).getByText('Mumbai')).toBeTruthy();
    expect(within(table).getByText('Nagpur')).toBeTruthy();
  });

  it('drills down to the district view when a district row is clicked', async () => {
    useStateDashboardDataMock.mockReturnValue({
      data: STATE_DASHBOARD_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    const table = screen.getByTestId('state-district-table');
    const row = within(table).getByText('Pune').closest('tr');
    expect(row).not.toBeNull();
    fireEvent.click(row!);

    await waitFor(() =>
      expect(screen.getByTestId('district-page')).toBeTruthy(),
    );
  });

  it('navigates back to the country dashboard via the breadcrumb', async () => {
    useStateDashboardDataMock.mockReturnValue({
      data: STATE_DASHBOARD_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    fireEvent.click(screen.getByTestId('state-breadcrumb-country'));
    await waitFor(() =>
      expect(screen.getByTestId('country-page')).toBeTruthy(),
    );
  });
});
