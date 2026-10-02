import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const register = vi.fn();
vi.mock('../actions', () => ({
  registerVehicleDeviceAction: (...args: unknown[]) => register(...args),
  ingestGpsPingAction: vi.fn(),
}));

import { GpsDeviceForms } from './gps-device-forms';

const vehicles = [{ id: 'veh-1', registrationNumber: 'KA01AB1234' }] as never;

function submitRegistration() {
  fireEvent.change(screen.getByLabelText(/^vehicle/i), { target: { value: 'veh-1' } });
  fireEvent.submit(screen.getByRole('form', { name: /register gps device/i }));
}

describe('GpsDeviceForms device key (PRC-L251)', () => {
  beforeEach(() => {
    register.mockReset();
    register.mockResolvedValue({ status: 'success', deviceId: 'dev-9', deviceKey: 'secret-key' });
  });

  it('keeps the key visible until acknowledged and blocks another register meanwhile', async () => {
    render(<GpsDeviceForms vehicles={vehicles} />);
    submitRegistration();
    const panel = await screen.findByTestId('transport-device-key');
    expect(screen.getByLabelText(/device key$/i, { selector: '#dev-key-value' })).toHaveValue(
      'secret-key',
    );
    expect(screen.getByRole('button', { name: /register device/i })).toBeDisabled();
    expect(panel).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /i have stored it/i }));
    expect(screen.queryByTestId('transport-device-key')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register device/i })).toBeEnabled();
  });

  it('asks for confirmation before re-registering the same vehicle', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<GpsDeviceForms vehicles={vehicles} />);
    submitRegistration();
    await screen.findByTestId('transport-device-key');
    fireEvent.click(screen.getByRole('button', { name: /i have stored it/i }));
    submitRegistration();
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(register).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
});
