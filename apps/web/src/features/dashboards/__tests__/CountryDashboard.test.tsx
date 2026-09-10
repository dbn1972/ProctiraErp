/**
 * @vitest-environment jsdom
 *
 * <CountryDashboard> tests — Task 52.2 / Requirement 40.1 / Design §G.1.
 *
 * Mounts the page with a mocked TanStack-Query stub so we can assert
 * the KPI labels appear, the board-wise summary table renders, and the
 * state drill-down navigates to the State_Dashboard route. The mock
 * lives in `apps/web/src/features/dashboards/api/mockData.ts` and is
 * imported through the same `useCountryDashboardData()` boundary the
 * page uses, so a future swap to the real API client (task 60.3) only
 * needs to update the loader.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// jsdom doesn't ship ResizeObserver, which Recharts <ResponsiveContainer>
// uses to size charts. Provide a no-op so the dashboard chart card mounts.
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
  COUNTRY_DASHBOARD_MOCK,
  type CountryDashboardData,
  type DashboardQueryResult,
} from '../api';

// Stub the query hook with a synchronous response so the page renders the
// loaded state on first paint. Each test re-imports the page via
// `await import()` so this mock applies before module evaluation.
const useCountryDashboardDataMock = vi.fn<[], DashboardQueryResult<CountryDashboardData>>();

vi.mock('../api', async (importActual) => {
  const actual = await importActual<typeof import('../api')>();
  return {
    ...actual,
    useCountryDashboardData: () => useCountryDashboardDataMock(),
  };
});

async function renderPage() {
  const { default: CountryDashboard } = await import('../pages/CountryDashboard');
  return render(
    <MemoryRouter initialEntries={['/app/dashboard/country']}>
      <Routes>
        <Route path="/app/dashboard/country" element={<CountryDashboard />} />
        <Route
          path="/app/dashboard/state/:stateCode"
          element={<div data-testid="state-page">state</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('<CountryDashboard>', () => {
  it('renders the loaded KPI labels from the mocked query', async () => {
    useCountryDashboardDataMock.mockReturnValue({
      data: COUNTRY_DASHBOARD_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    // Each KPI tile carries `data-testid="country-kpi-{id}"` plus the
    // label text. Assert all six show up — Schools, Students, Teachers,
    // Attendance, Pass Rate, GPI per Design §G.1.
    expect(screen.getByTestId('country-kpi-schools')).toBeTruthy();
    expect(screen.getByTestId('country-kpi-students')).toBeTruthy();
    expect(screen.getByTestId('country-kpi-teachers')).toBeTruthy();
    expect(screen.getByTestId('country-kpi-attendance')).toBeTruthy();
    expect(screen.getByTestId('country-kpi-pass-rate')).toBeTruthy();
    expect(screen.getByTestId('country-kpi-gpi')).toBeTruthy();

    expect(within(screen.getByTestId('country-kpi-schools')).getByText('Schools')).toBeTruthy();
    expect(
      within(screen.getByTestId('country-kpi-attendance')).getByText('Attendance'),
    ).toBeTruthy();
    expect(within(screen.getByTestId('country-kpi-gpi')).getByText('GPI')).toBeTruthy();
  });

  it('renders the board-wise summary and state drill-down tables', async () => {
    useCountryDashboardDataMock.mockReturnValue({
      data: COUNTRY_DASHBOARD_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    const boardTable = screen.getByTestId('country-board-table');
    expect(within(boardTable).getByText('CBSE')).toBeTruthy();
    expect(within(boardTable).getByText('State Boards')).toBeTruthy();
    expect(within(boardTable).getByText('ICSE')).toBeTruthy();
    expect(within(boardTable).getByText('IB')).toBeTruthy();

    const stateTable = screen.getByTestId('country-state-table');
    expect(within(stateTable).getByText('Maharashtra')).toBeTruthy();
    expect(within(stateTable).getByText('Karnataka')).toBeTruthy();
  });

  it('drills down to the State Dashboard when a state row is clicked', async () => {
    useCountryDashboardDataMock.mockReturnValue({
      data: COUNTRY_DASHBOARD_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    const stateTable = screen.getByTestId('country-state-table');
    const row = within(stateTable).getByText('Maharashtra').closest('tr');
    expect(row).not.toBeNull();
    fireEvent.click(row!);

    await waitFor(() => expect(screen.getByTestId('state-page')).toBeTruthy());
  });

  it('shows skeleton placeholders while the query is loading', async () => {
    useCountryDashboardDataMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    await renderPage();

    // The DashboardSection paints a `data-state="loading"` skeleton row
    // until the query resolves; assert the section element flips state.
    const sections = document.querySelectorAll('[data-testid="dashboard-section-skeleton"]');
    expect(sections.length).toBeGreaterThan(0);
  });
});
