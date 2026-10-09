/**
 * @vitest-environment jsdom
 *
 * PRC-M135: the rollover Execute must only run the options that were previewed.
 * Toggling any option after a preview clears the summary (disabling Execute),
 * and the executed idempotency key encodes the option set.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const rolloverAction = vi.fn();
const routerRefresh = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
vi.mock('@/lib/institutions/actions', () => ({
  createCalendarEventAction: vi.fn(),
  deleteCalendarEventAction: vi.fn(),
  rolloverAcademicPeriodAction: (...args: unknown[]) => rolloverAction(...args),
}));

import { RolloverCard } from './academic-calendar-panel';

const SOURCE = { id: 'src-1', name: '2025-26', startDate: '2025-06-01', status: 'active' };
const TARGET = { id: 'tgt-1', name: '2026-27', startDate: '2026-06-01', status: 'active' };

function previewSummary() {
  return {
    success: true,
    data: {
      dryRun: true,
      targetPeriodId: 'tgt-1',
      classes: { toCreate: 1, created: 0, existing: 0 },
      enrollments: {
        considered: 1,
        toPromote: 1,
        promoted: 0,
        graduating: 0,
        alreadyInTarget: 0,
      },
    },
  };
}

beforeEach(() => {
  rolloverAction.mockReset();
  routerRefresh.mockReset();
});

describe('RolloverCard execute parity (PRC-M135)', () => {
  it('clears the preview and disables Execute when an option changes', async () => {
    rolloverAction.mockResolvedValue(previewSummary());
    render(<RolloverCard source={SOURCE as never} targets={[TARGET as never]} institutions={[]} />);

    fireEvent.click(screen.getByTestId('rollover-preview'));
    await waitFor(() => expect(screen.getByTestId('rollover-execute')).toBeEnabled());

    // Toggle an option off -> preview invalidated -> Execute disabled again.
    fireEvent.click(screen.getByTestId('rollover-copy-fees'));
    expect(screen.getByTestId('rollover-execute')).toBeDisabled();
  });

  it('encodes the option set into the executed idempotency key', async () => {
    rolloverAction.mockImplementation((_id: string, input: { dryRun: boolean }) =>
      Promise.resolve(
        input.dryRun
          ? previewSummary()
          : { success: true, data: { ...previewSummary().data, dryRun: false } },
      ),
    );
    render(<RolloverCard source={SOURCE as never} targets={[TARGET as never]} institutions={[]} />);

    fireEvent.click(screen.getByTestId('rollover-preview'));
    await waitFor(() => expect(screen.getByTestId('rollover-execute')).toBeEnabled());
    fireEvent.click(screen.getByTestId('rollover-execute'));
    fireEvent.click(await screen.findByTestId('academic-period-rollover-confirm-confirm'));

    await waitFor(() => {
      const executeCall = rolloverAction.mock.calls.find(
        (c) => (c[1] as { dryRun: boolean }).dryRun === false,
      );
      expect(executeCall).toBeTruthy();
    });
    const executeCall = rolloverAction.mock.calls.find(
      (c) => (c[1] as { dryRun: boolean }).dryRun === false,
    );
    const key = (executeCall![1] as { idempotencyKey: string }).idempotencyKey;
    expect(key).toContain('rollover-src-1-tgt-1-');
    expect(key).toContain('f1'); // copyFees on in the previewed+executed set
  });
});
