/**
 * PRC-M130: the bus attendance panel loads the trip it marks, offers only the
 * selected route's riders, sends the rider's assigned stop, and can mark every
 * unmarked rider of the loaded trip in one action.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ upsertTripAttendanceAction: vi.fn() }));
vi.mock('../actions', () => actions);
const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { AttendancePanel } from './attendance-panel';

const routes = [
  { id: 'r1', name: 'North Loop' },
  { id: 'r2', name: 'South Loop' },
] as never;
const assignments = [
  {
    id: 'a1',
    studentId: 's1',
    routeId: 'r1',
    stopId: 'stop-1',
    startDate: '2026-09-01',
    isActive: true,
  },
  {
    id: 'a2',
    studentId: 's2',
    routeId: 'r1',
    stopId: 'stop-1',
    startDate: '2026-09-01',
    isActive: true,
  },
  {
    id: 'a3',
    studentId: 's3',
    routeId: 'r2',
    stopId: 'stop-9',
    startDate: '2026-09-01',
    isActive: true,
  },
];
const labels = { s1: 'Asha', s2: 'Bina', s3: 'Chitra' };
const tripQuery = { routeId: 'r1', tripDate: '2026-09-09', direction: 'pickup' as const };
const trip = {
  data: [
    { id: 'm1', studentId: 's1', stopId: 'stop-1', status: 'boarded' as const, recordedAt: '' },
  ],
  summary: { boarded: 1, alighted: 0, absent: 0, unmarked: 1 },
};

function studentOptions(): string[] {
  return [...document.querySelectorAll('#att-student option')]
    .map((o) => (o as HTMLOptionElement).value)
    .filter(Boolean);
}

beforeEach(() => {
  actions.upsertTripAttendanceAction.mockReset();
  actions.upsertTripAttendanceAction.mockResolvedValue({
    status: 'success',
    message: 'Attendance saved.',
  });
  router.refresh.mockReset();
  router.replace.mockReset();
});

describe('AttendancePanel (PRC-M130)', () => {
  it('prefills the loaded trip and offers only that route’s riders', () => {
    render(
      <AttendancePanel
        routes={routes}
        assignments={assignments}
        trip={trip}
        tripQuery={tripQuery}
        studentLabels={labels}
      />,
    );
    expect((screen.getByLabelText(/Route/) as HTMLSelectElement).value).toBe('r1');
    expect((screen.getByLabelText(/Trip date/) as HTMLInputElement).value).toBe('2026-09-09');
    expect(studentOptions()).toEqual(['s1', 's2']);
    fireEvent.change(screen.getByLabelText(/Route/), { target: { value: 'r2' } });
    expect(studentOptions()).toEqual(['s3']);
  });

  it('sends the rider’s assigned stop and refreshes the loaded trip', async () => {
    render(
      <AttendancePanel
        routes={routes}
        assignments={assignments}
        trip={trip}
        tripQuery={tripQuery}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Student/), { target: { value: 's2' } });
    fireEvent.submit(screen.getByTestId('transport-attendance-form'));
    expect(await screen.findByRole('status')).toHaveTextContent('Attendance saved.');
    expect(actions.upsertTripAttendanceAction).toHaveBeenCalledWith({
      ...tripQuery,
      studentId: 's2',
      stopId: 'stop-1',
      status: 'boarded',
    });
    expect(router.refresh).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('loads a different trip into the page after marking it', async () => {
    render(<AttendancePanel routes={routes} assignments={assignments} trip={null} />);
    fireEvent.change(screen.getByLabelText(/Route/), { target: { value: 'r2' } });
    fireEvent.change(screen.getByLabelText(/Trip date/), { target: { value: '2026-09-10' } });
    fireEvent.change(screen.getByLabelText(/Student/), { target: { value: 's3' } });
    fireEvent.submit(screen.getByTestId('transport-attendance-form'));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        '/transport/attendance?routeId=r2&tripDate=2026-09-10&direction=pickup',
      ),
    );
    expect(actions.upsertTripAttendanceAction).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 's3', stopId: 'stop-9' }),
    );
  });

  it('Load trip opens the chosen trip, and asks for a route and date first', () => {
    render(<AttendancePanel routes={routes} assignments={assignments} trip={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load trip' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a route and a trip date');
    expect(router.replace).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Route/), { target: { value: 'r1' } });
    fireEvent.change(screen.getByLabelText(/Trip date/), { target: { value: '2026-09-09' } });
    fireEvent.change(screen.getByLabelText(/Direction/), { target: { value: 'drop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load trip' }));
    expect(router.replace).toHaveBeenCalledWith(
      '/transport/attendance?routeId=r1&tripDate=2026-09-09&direction=drop',
    );
  });

  it('marks every unmarked rider of the loaded trip in one action', async () => {
    render(
      <AttendancePanel
        routes={routes}
        assignments={assignments}
        trip={trip}
        tripQuery={tripQuery}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Status/), { target: { value: 'absent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark 1 unmarked as selected status' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved 1 marks.');
    expect(actions.upsertTripAttendanceAction).toHaveBeenCalledTimes(1);
    expect(actions.upsertTripAttendanceAction).toHaveBeenCalledWith({
      ...tripQuery,
      studentId: 's2',
      stopId: 'stop-1',
      status: 'absent',
    });
  });
});
