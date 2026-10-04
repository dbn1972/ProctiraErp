import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const dryRun = vi.fn();
const commit = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('../hr-actions', () => ({
  dryRunImportAction: (...args: unknown[]) => dryRun(...args),
  commitImportAction: (...args: unknown[]) => commit(...args),
}));

import { StaffImportForm } from './staff-import-form';

const commitButton = () => screen.getByRole('button', { name: /commit import/i });

describe('StaffImportForm commit gating (PRC-L246)', () => {
  beforeEach(() => {
    dryRun.mockReset();
    commit.mockReset();
  });

  it('keeps Commit disabled until a clean dry-run and re-disables it after an edit', async () => {
    dryRun.mockResolvedValue({ status: 'success', report: { rows: 1, valid: 1, errors: [] } });
    render(<StaffImportForm />);
    expect(commitButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /dry-run/i }));
    await waitFor(() => expect(commitButton()).toBeEnabled());
    fireEvent.change(screen.getByLabelText(/csv text/i), { target: { value: 'edited' } });
    expect(commitButton()).toBeDisabled();
  });

  it('requires the valid-rows-only checkbox when the dry-run had errors', async () => {
    dryRun.mockResolvedValue({
      status: 'success',
      report: { rows: 2, valid: 1, errors: [{ row: 2, message: 'Required' }] },
    });
    render(<StaffImportForm />);
    fireEvent.click(screen.getByRole('button', { name: /dry-run/i }));
    const box = await screen.findByLabelText(/commit valid rows only/i);
    expect(commitButton()).toBeDisabled();
    fireEvent.click(box);
    expect(commitButton()).toBeEnabled();
  });

  it('renders a partial commit distinctly', async () => {
    dryRun.mockResolvedValue({
      status: 'success',
      report: { rows: 2, valid: 1, errors: [{ row: 2, message: 'Required' }] },
    });
    commit.mockResolvedValue({
      status: 'partial',
      message: 'Created 1 staff record(s); 1 row error(s) were not imported.',
      report: { rows: 2, valid: 1, created: 1, errors: [{ row: 2, message: 'Required' }] },
    });
    render(<StaffImportForm />);
    fireEvent.click(screen.getByRole('button', { name: /dry-run/i }));
    fireEvent.click(await screen.findByLabelText(/commit valid rows only/i));
    fireEvent.click(commitButton());
    const notice = await screen.findByTestId('staff-import-notice');
    expect(notice).toHaveAttribute('data-kind', 'partial');
    expect(notice).toHaveTextContent(/partially imported/i);
  });
});
