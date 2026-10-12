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

const SOURCE = {
  id: '00000000-0000-4000-8000-0000000005a1',
  name: '2025-26',
  startDate: '2025-06-01',
  status: 'active',
};
const TARGET = {
  id: '00000000-0000-4000-8000-0000000005b2',
  name: '2026-27',
  startDate: '2026-06-01',
  status: 'active',
};

function previewSummary() {
  return {
    success: true,
    data: {
      dryRun: true,
      targetPeriodId: TARGET.id,
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

  it('encodes the option set into a bounded executed idempotency key', async () => {
    rolloverAction.mockImplementation((_id: string, input: { dryRun: boolean }) =>
      Promise.resolve(
        input.dryRun
          ? previewSummary()
          : { success: true, data: { ...previewSummary().data, dryRun: false } },
      ),
    );
    const { unmount } = render(
      <RolloverCard source={SOURCE as never} targets={[TARGET as never]} institutions={[]} />,
    );

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
    // Scoped to the source period…
    expect(key.startsWith(`rollover-${SOURCE.id}-`)).toBe(true);
    // …and — the regression this guards — within the gateway/schema bound
    // (`rolloverFormSchema` caps idempotencyKey at 128 chars). The previous
    // key embedded two raw UUIDs plus the option string and overflowed, so the
    // execute failed validation and the summary stayed in dry-run.
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(128);
    const feesOnKey = key;
    unmount();

    // Toggling an option changes the fingerprint, so a different option set can
    // never collapse onto a previous attempt's idempotency key.
    rolloverAction.mockClear();
    render(<RolloverCard source={SOURCE as never} targets={[TARGET as never]} institutions={[]} />);
    fireEvent.click(screen.getByTestId('rollover-copy-fees')); // fees off
    fireEvent.click(screen.getByTestId('rollover-preview'));
    await waitFor(() => expect(screen.getByTestId('rollover-execute')).toBeEnabled());
    fireEvent.click(screen.getByTestId('rollover-execute'));
    fireEvent.click(await screen.findByTestId('academic-period-rollover-confirm-confirm'));
    await waitFor(() =>
      expect(
        rolloverAction.mock.calls.find((c) => (c[1] as { dryRun: boolean }).dryRun === false),
      ).toBeTruthy(),
    );
    const feesOffCall = rolloverAction.mock.calls.find(
      (c) => (c[1] as { dryRun: boolean }).dryRun === false,
    );
    const feesOffKey = (feesOffCall![1] as { idempotencyKey: string }).idempotencyKey;
    expect(feesOffKey).not.toBe(feesOnKey);
    expect(feesOffKey.length).toBeLessThanOrEqual(128);
  });
});
