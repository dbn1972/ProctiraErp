/**
 * @vitest-environment jsdom
 *
 * <CrossBoardTransferDashboard> tests — Task 52.3 / Requirement 40.5 /
 * Design §G.5.
 *
 * Mounts the page with a mocked query stub so we can assert the state-
 * machine stepper renders all six states, the approval list renders,
 * the equivalency mapping table renders, and the approver-action
 * buttons render with correct enablement.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import {
  CROSS_BOARD_TRANSFER_MOCK,
  type CrossBoardTransferData,
  type DashboardQueryResult,
} from '../api';

const useCrossBoardTransferDataMock = vi.fn<
  [string?],
  DashboardQueryResult<CrossBoardTransferData>
>();

vi.mock('../api', async (importActual) => {
  const actual = await importActual<typeof import('../api')>();
  return {
    ...actual,
    useCrossBoardTransferData: (id?: string) => useCrossBoardTransferDataMock(id),
  };
});

async function renderPage(transferId?: string) {
  const { default: CrossBoardTransferDashboard } =
    await import('../pages/CrossBoardTransferDashboard');
  const path = transferId
    ? `/app/dashboard/cross-board-transfer/${transferId}`
    : '/app/dashboard/cross-board-transfer';
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/app/dashboard/cross-board-transfer"
          element={<CrossBoardTransferDashboard />}
        />
        <Route
          path="/app/dashboard/cross-board-transfer/:transferId"
          element={<CrossBoardTransferDashboard />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('<CrossBoardTransferDashboard>', () => {
  it('renders the stepper with all six transfer states', async () => {
    useCrossBoardTransferDataMock.mockReturnValue({
      data: CROSS_BOARD_TRANSFER_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    const stepper = screen.getByTestId('cross-board-transfer-stepper');
    expect(stepper).toBeTruthy();

    for (const stateId of [
      'initiated',
      'documents_uploaded',
      'equivalency_mapped',
      'source_approved',
      'destination_approved',
      'completed',
    ]) {
      expect(within(stepper).getByTestId(`cross-board-transfer-step-${stateId}`)).toBeTruthy();
    }

    const currentStep = screen.getByTestId('cross-board-transfer-step-equivalency_mapped');
    expect(currentStep.getAttribute('data-status')).toBe('current');
  });

  it('renders the source and destination institution cards', async () => {
    useCrossBoardTransferDataMock.mockReturnValue({
      data: CROSS_BOARD_TRANSFER_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    const source = screen.getByTestId('cross-board-transfer-source-card');
    const destination = screen.getByTestId('cross-board-transfer-destination-card');
    expect(within(source).getByText(/Maharashtra State Board School/)).toBeTruthy();
    expect(within(destination).getByText(/CBSE Academy/)).toBeTruthy();
  });

  it('renders the approval list with all configured steps', async () => {
    useCrossBoardTransferDataMock.mockReturnValue({
      data: CROSS_BOARD_TRANSFER_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    const list = screen.getByTestId('cross-board-transfer-approvals-list');
    expect(within(list).getByText('Initiated by Parent')).toBeTruthy();
    expect(within(list).getByText('Source Principal Review')).toBeTruthy();
    expect(within(list).getByText('Equivalency Check')).toBeTruthy();
    expect(within(list).getByText('Destination Principal')).toBeTruthy();
  });

  it('renders the equivalency mapping table', async () => {
    useCrossBoardTransferDataMock.mockReturnValue({
      data: CROSS_BOARD_TRANSFER_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    const table = screen.getByTestId('cross-board-transfer-equivalency-table');
    expect(within(table).getByText(/Mathematics \(Marathi medium\)/)).toBeTruthy();
    expect(within(table).getByText(/Marathi \(First Language\)/)).toBeTruthy();
    // Bridge exam status badge
    expect(within(table).getByText('Bridge exam')).toBeTruthy();
  });

  it('renders the approver action buttons enabled when current user is the active approver', async () => {
    useCrossBoardTransferDataMock.mockReturnValue({
      data: CROSS_BOARD_TRANSFER_MOCK,
      isLoading: false,
      error: null,
    });

    await renderPage();

    const approve = screen.getByTestId('cross-board-transfer-approve-button');
    const reject = screen.getByTestId('cross-board-transfer-reject-button');
    const info = screen.getByTestId('cross-board-transfer-info-button');

    expect(approve).toBeTruthy();
    expect(reject).toBeTruthy();
    expect(info).toBeTruthy();

    // Mock sets `currentApprover` to the active step id, so the buttons
    // should be enabled.
    expect((approve as HTMLButtonElement).disabled).toBe(false);
    expect((reject as HTMLButtonElement).disabled).toBe(false);
    expect((info as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables approver action buttons when the current user is not the active approver', async () => {
    useCrossBoardTransferDataMock.mockReturnValue({
      data: { ...CROSS_BOARD_TRANSFER_MOCK, currentApprover: 'someone-else' },
      isLoading: false,
      error: null,
    });

    await renderPage();

    const approve = screen.getByTestId('cross-board-transfer-approve-button') as HTMLButtonElement;
    const reject = screen.getByTestId('cross-board-transfer-reject-button') as HTMLButtonElement;
    const info = screen.getByTestId('cross-board-transfer-info-button') as HTMLButtonElement;

    expect(approve.disabled).toBe(true);
    expect(reject.disabled).toBe(true);
    expect(info.disabled).toBe(true);
  });
});
