/**
 * PRC-L058 — transport forms and template download announce success/failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({
  upsertTripAttendanceAction: vi.fn(),
  createAlertRuleAction: vi.fn(),
  evaluateAlertsAction: vi.fn(),
  acknowledgeAlertAction: vi.fn(),
  ingestGpsPingAction: vi.fn(),
  registerVehicleDeviceAction: vi.fn(),
}));
vi.mock('../actions', () => actions);

import { AttendancePanel } from './attendance-panel';
import { AlertsPanel } from './alerts-panel';
import { GpsDeviceForms } from './gps-device-forms';
import { DownloadTemplateButton } from '../../students/import/_components/download-template-button';

const route = { id: 'r1', name: 'Route A' } as never;

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transport form feedback (PRC-L058)', () => {
  it('attendance save shows a status message', async () => {
    actions.upsertTripAttendanceAction.mockResolvedValue({
      status: 'success',
      message: 'Attendance saved.',
    });
    render(<AttendancePanel routes={[route]} assignments={[]} trip={null} />);
    fireEvent.submit(screen.getByTestId('transport-attendance-form'));
    expect(await screen.findByRole('status')).toHaveTextContent('Attendance saved.');
  });

  it('evaluate-now surfaces the evaluated count', async () => {
    actions.evaluateAlertsAction.mockResolvedValue({
      status: 'success',
      message: 'Evaluated 3 alert(s).',
    });
    render(<AlertsPanel routes={[route]} rules={[]} alerts={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate now' }));
    await waitFor(() =>
      expect(screen.getByText('Evaluated 3 alert(s).')).toHaveAttribute('role', 'status'),
    );
  });

  it('alert rule create shows status and resets the form', async () => {
    actions.createAlertRuleAction.mockResolvedValue({
      status: 'success',
      message: 'Alert rule created.',
    });
    render(<AlertsPanel routes={[route]} rules={[]} alerts={[]} />);
    const threshold = screen.getByLabelText(/Threshold/) as HTMLInputElement;
    fireEvent.change(threshold, { target: { value: '10' } });
    fireEvent.submit(screen.getByTestId('transport-alert-rule-form'));
    expect(await screen.findByText('Alert rule created.')).toHaveAttribute('role', 'status');
    expect(threshold.value).toBe('');
  });

  it('GPS ping success resets the form', async () => {
    actions.ingestGpsPingAction.mockResolvedValue({ status: 'success', message: 'Ping stored.' });
    render(<GpsDeviceForms vehicles={[]} />);
    const device = screen.getByLabelText(/^Device id/, { selector: '#gps-device' });
    fireEvent.change(device, { target: { value: 'dev-1' } });
    fireEvent.submit(screen.getByTestId('transport-gps-form'));
    expect(await screen.findByRole('status')).toHaveTextContent('Ping stored.');
    expect((device as HTMLInputElement).value).toBe('');
  });
});

describe('DownloadTemplateButton (PRC-L058)', () => {
  it('announces a failed download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', { status: 500 })));
    render(<DownloadTemplateButton />);
    fireEvent.click(screen.getByRole('button', { name: /Download template/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be downloaded/);
  });

  it('announces a successful download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('xlsx', { status: 200 })));
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<DownloadTemplateButton />);
    fireEvent.click(screen.getByRole('button', { name: /Download template/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('Template downloaded.');
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  });
});
