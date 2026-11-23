/**
 * HL-O2: the incident form asked for a required "Reported by" value that the server
 * always replaces with the signed-in user (PRC-M520). The form now shows that user
 * read-only and does not submit the field.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const action = vi.hoisted(() => vi.fn());
vi.mock('../actions', () => ({ createNurseIncidentAction: action }));

import { CreateNurseIncidentForm } from './create-nurse-incident-form';

const STUDENT = '00000000-0000-4000-8000-0000000000e1';
const SCHOOL = '00000000-0000-4000-8000-0000000000e2';

function renderForm() {
  render(
    <CreateNurseIncidentForm
      studentOptionsJson={JSON.stringify([{ id: STUDENT, label: 'Asha Rao' }])}
      institutionOptionsJson={JSON.stringify([{ id: SCHOOL, label: 'SCH1 · School One' }])}
      recorderLabel="HL Nurse"
    />,
  );
}

beforeEach(() => {
  action.mockReset();
  action.mockResolvedValue({ status: 'success', sessionId: 'inc-1' });
});

describe('nurse incident form recorder (HL-O2)', () => {
  it('shows the signed-in user as the recorder, read-only and not submitted', () => {
    renderForm();
    const reporter = screen.getByLabelText('Reported by');
    expect(reporter).toHaveValue('HL Nurse');
    expect(reporter).toHaveAttribute('readonly');
    expect(reporter).not.toHaveAttribute('name');
    expect(reporter).not.toBeRequired();
  });

  it('saves without a reportedBy value', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Student/), { target: { value: STUDENT } });
    fireEvent.change(screen.getByLabelText('School'), { target: { value: SCHOOL } });
    fireEvent.change(screen.getByLabelText('Incident time'), {
      target: { value: '2026-11-01T09:30' },
    });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'illness' } });
    fireEvent.submit(screen.getByTestId('create-incident-form'));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const input = action.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).not.toHaveProperty('reportedBy');
    expect(input).toMatchObject({ studentId: STUDENT, institutionId: SCHOOL, category: 'illness' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
