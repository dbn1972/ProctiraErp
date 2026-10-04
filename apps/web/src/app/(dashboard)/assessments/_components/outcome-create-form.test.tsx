import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
const createOutcomeAction = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/app/(dashboard)/assessments/actions', () => ({
  createOutcomeAction: (...args: unknown[]) => createOutcomeAction(...args),
}));

import { OutcomeCreateForm } from './outcome-create-form';

const subjects = [{ id: 'sub-1', code: 'MATH', name: 'Mathematics' }];

describe('OutcomeCreateForm (PRC-L029)', () => {
  beforeEach(() => {
    refresh.mockReset();
    createOutcomeAction.mockReset();
  });

  it('clears the form and refreshes the list after a successful save', async () => {
    createOutcomeAction.mockResolvedValue({ status: 'success' });
    render(<OutcomeCreateForm subjects={subjects} defaultSubjectId="sub-1" />);

    const code = screen.getByLabelText('Code') as HTMLInputElement;
    const name = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(code, { target: { value: 'M1' } });
    fireEvent.change(name, { target: { value: 'Fractions' } });
    fireEvent.submit(screen.getByTestId('outcome-create-form'));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(createOutcomeAction).toHaveBeenCalledWith({
      subjectId: 'sub-1',
      code: 'M1',
      name: 'Fractions',
      description: '',
    });
    expect(code.value).toBe('');
    expect(name.value).toBe('');
  });

  it('keeps values and shows the error when the save fails', async () => {
    createOutcomeAction.mockResolvedValue({ status: 'error', message: 'Duplicate code' });
    render(<OutcomeCreateForm subjects={subjects} defaultSubjectId="sub-1" />);

    const code = screen.getByLabelText('Code') as HTMLInputElement;
    fireEvent.change(code, { target: { value: 'M1' } });
    fireEvent.submit(screen.getByTestId('outcome-create-form'));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Duplicate code');
    expect(code.value).toBe('M1');
    expect(refresh).not.toHaveBeenCalled();
  });
});
