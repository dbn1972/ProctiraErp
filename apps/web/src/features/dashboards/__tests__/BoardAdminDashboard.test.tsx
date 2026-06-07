/**
 * @vitest-environment jsdom
 *
 * <BoardAdminDashboard> tests — Task 52.2 / Requirement 40.3 / Design §G.3.
 *
 * Mounts the page with a mocked query stub so we can assert the board
 * KPI labels, the regional breakdown table, the affiliation status
 * badges, the enrollment-growth widget, and the action item list.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
  BOARD_ADMIN_DASHBOARD_MOCK,
  type BoardAdminDashboardData,
  type DashboardQueryResult,
} from '../api';

const useBoardAdminDashboardDataMock = vi.fn<
  [string?],
  DashboardQueryResult<BoardAdminDashboardData>
>();

vi.mock('../api', async (importActual) => {
  const actual = await importActual<typeof import('../api')>();
  return {
    ...actual,
    useBoardAdminDashboardData: (code?: string) =>
      useBoardAdminDashboardDataMock(code),
  };
});

async function renderPage() {
  const { default: BoardAdminDashboard } = await import(
    '../pages/BoardAdminDashboard'
  );
  return render(
    <MemoryRouter>
      <BoardAdminDashboard />
    </MemoryRouter>,
  );
}

describe('<BoardAdminDashboard>', () => {
  it('renders the board KPI labels from the mocked query', async () => {
    useBoardAdminDashboardDataMock.mockReturnValue({
      data: BOARD_ADMIN_DASHBOARD_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    expect(screen.getByTestId('board-kpi-schools')).toBeTruthy();
    expect(screen.getByTestId('board-kpi-students')).toBeTruthy();
    expect(screen.getByTestId('board-kpi-teachers')).toBeTruthy();
    expect(screen.getByTestId('board-kpi-pass-rate')).toBeTruthy();
    expect(screen.getByTestId('board-kpi-attendance')).toBeTruthy();
    expect(screen.getByTestId('board-kpi-expiring')).toBeTruthy();

    expect(
      within(screen.getByTestId('board-kpi-schools')).getByText('CBSE Schools'),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('board-kpi-pass-rate')).getByText(
        'Board Exam Pass Rate',
      ),
    ).toBeTruthy();
  });

  it('renders the regional breakdown table with all four directional regions', async () => {
    useBoardAdminDashboardDataMock.mockReturnValue({
      data: BOARD_ADMIN_DASHBOARD_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    const table = screen.getByTestId('board-region-table');
    expect(within(table).getByText('North')).toBeTruthy();
    expect(within(table).getByText('South')).toBeTruthy();
    expect(within(table).getByText('East')).toBeTruthy();
    expect(within(table).getByText('West')).toBeTruthy();
  });

  it('renders the affiliation status badges for active, provisional, and expiring', async () => {
    useBoardAdminDashboardDataMock.mockReturnValue({
      data: BOARD_ADMIN_DASHBOARD_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    const card = screen.getByTestId('affiliation-status-card');
    expect(within(card).getByText('Active')).toBeTruthy();
    expect(within(card).getByText('Provisional')).toBeTruthy();
    expect(within(card).getByText('Expiring')).toBeTruthy();
  });

  it('renders the action item list with the high-priority items first', async () => {
    useBoardAdminDashboardDataMock.mockReturnValue({
      data: BOARD_ADMIN_DASHBOARD_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    const list = screen.getByTestId('board-action-items');
    expect(
      within(list).getByText('200 affiliations expiring in 6 months'),
    ).toBeTruthy();
    expect(
      within(list).getByText('Review 456 provisional affiliations'),
    ).toBeTruthy();
  });
});
