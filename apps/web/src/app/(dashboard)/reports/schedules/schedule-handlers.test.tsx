/**
 * PRC-L049 — schedule form clears after create without touching a stale
 * currentTarget; row actions surface their result; failed delete keeps the
 * confirmation dialog open and shows the error.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createReportScheduleAction = vi.fn();
const deleteReportScheduleAction = vi.fn();
const runReportScheduleAction = vi.fn();
const toggleReportScheduleAction = vi.fn();

vi.mock('../actions', () => ({
  createReportScheduleAction: (...a: unknown[]) => createReportScheduleAction(...a),
  deleteReportScheduleAction: (...a: unknown[]) => deleteReportScheduleAction(...a),
  runReportScheduleAction: (...a: unknown[]) => runReportScheduleAction(...a),
  toggleReportScheduleAction: (...a: unknown[]) => toggleReportScheduleAction(...a),
  runDueSchedulesAction: vi.fn(),
}));

import { ReportScheduleForm } from './schedule-form';
import { ScheduleRowActions } from './schedule-actions';

describe('report schedule handlers (PRC-L049)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the form after create without a console error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    createReportScheduleAction.mockResolvedValue({ status: 'success', message: 'Created' });
    render(
      <ReportScheduleForm
        templates={[{ id: 't1', name: 'Attendance', reportKey: 'attendance' } as never]}
      />,
    );
    const select = screen.getByLabelText(/Report/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'attendance' } });
    fireEvent.submit(screen.getByTestId('report-schedule-form'));
    await waitFor(() => expect(screen.getByText('Created')).toBeTruthy());
    expect(select.value).toBe('');
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('keeps the delete dialog open and shows the error on failure', async () => {
    deleteReportScheduleAction.mockResolvedValue({ status: 'error', message: 'Forbidden' });
    render(<ScheduleRowActions scheduleId="s1" enabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete schedule' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Forbidden'));
    expect(screen.getByTestId('report-schedule-delete-confirm')).toBeTruthy();
  });

  it('announces the run-now result', async () => {
    runReportScheduleAction.mockResolvedValue({ status: 'error', message: 'Run failed' });
    render(<ScheduleRowActions scheduleId="s1" enabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() =>
      expect(screen.getByTestId('report-schedule-row-feedback').textContent).toBe('Run failed'),
    );
    expect(screen.getByTestId('report-schedule-row-feedback').getAttribute('role')).toBe('alert');
  });
});
