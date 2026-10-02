/**
 * PRC-L227: board export requires an explicit institution and a confirmation
 * that states board, institution and cohort scope before the job is created.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createJob = vi.fn();
vi.mock('@/app/(dashboard)/examinations/board-exports/actions', () => ({
  createBoardExportJobAction: (...args: unknown[]) => createJob(...args),
}));

import { BoardExportTriggerForm } from './board-export-trigger-form';

const institutions = [
  { id: 'inst-1', label: 'NHS · North High' },
  { id: 'inst-2', label: 'SHS · South High' },
];

function chooseInstitution(id: string) {
  fireEvent.change(screen.getByLabelText('Institution', { selector: 'select' }), {
    target: { value: id },
  });
}

beforeEach(() => {
  createJob.mockReset();
  createJob.mockResolvedValue({ ok: true, status: 'COMPLETED', checksum: 'abc' });
});

describe('BoardExportTriggerForm', () => {
  it('does not default the institution and disables submit until one is chosen', () => {
    render(<BoardExportTriggerForm institutionOptions={institutions} />);
    const submit = screen.getByRole('button', { name: 'Generate board pack' });
    expect(submit).toBeDisabled();
    chooseInstitution('inst-2');
    expect(submit).toBeEnabled();
  });

  it('confirms cohort scope before creating the job', async () => {
    render(
      <BoardExportTriggerForm
        institutionOptions={institutions}
        boardOptions={[{ code: 'ICSE', label: 'ICSE' }]}
      />,
    );
    chooseInstitution('inst-2');
    fireEvent.click(screen.getByRole('button', { name: 'Generate board pack' }));

    const dialog = await screen.findByTestId('board-export-confirm');
    expect(dialog).toHaveTextContent('ICSE pack for SHS · South High');
    expect(dialog).toHaveTextContent('all students in the institution cohort');
    expect(createJob).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Generate pack' }));
    await waitFor(() =>
      expect(createJob).toHaveBeenCalledWith({
        boardCode: 'ICSE',
        institutionId: 'inst-2',
        studentIds: undefined,
      }),
    );
  });

  it('shows the selected student count in the confirmation', async () => {
    render(
      <BoardExportTriggerForm
        institutionOptions={institutions}
        studentOptions={[
          { id: 's1', label: 'Asha' },
          { id: 's2', label: 'Ravi' },
        ]}
      />,
    );
    chooseInstitution('inst-1');
    const studentSelect = screen.getByLabelText(/Students/);
    fireEvent.change(studentSelect, { target: { value: 's1' } });
    fireEvent.change(studentSelect, { target: { value: 's2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate board pack' }));
    expect(await screen.findByTestId('board-export-confirm')).toHaveTextContent(
      '2 selected students',
    );
  });

  it('cancelling the confirmation creates no job', async () => {
    render(<BoardExportTriggerForm institutionOptions={institutions} />);
    chooseInstitution('inst-1');
    fireEvent.click(screen.getByRole('button', { name: 'Generate board pack' }));
    fireEvent.click(await screen.findByTestId('board-export-confirm-cancel'));
    expect(createJob).not.toHaveBeenCalled();
  });
});
