import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BulkImport } from './BulkImport';

/**
 * PRC-L200: the file-name extension must match the file's bytes; a renamed
 * binary is rejected before onFileValidate sees it.
 */
const targetFields = [{ name: 'firstName', label: 'First Name', required: true }];

function choose(file: File): void {
  const input = screen.getByLabelText(/choose a file/i);
  Object.defineProperty(input, 'files', { value: [file] });
  fireEvent.change(input);
}

describe('BulkImport content sniffing (PRC-L200)', () => {
  it('rejects a .xlsx whose bytes are not a ZIP workbook', async () => {
    const onFileValidate = vi.fn();
    render(
      <BulkImport
        title="Import"
        targetFields={targetFields}
        onFileValidate={onFileValidate}
        onImportConfirm={vi.fn()}
      />,
    );
    choose(new File(['MZ\u0090\u0000not a workbook'], 'students.xlsx'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/does not match its \.xlsx type/),
    );
    expect(onFileValidate).not.toHaveBeenCalled();
  });

  it('rejects a binary file renamed to .csv', async () => {
    const onFileValidate = vi.fn();
    render(
      <BulkImport
        title="Import"
        targetFields={targetFields}
        acceptedFileTypes={['.csv']}
        onFileValidate={onFileValidate}
        onImportConfirm={vi.fn()}
      />,
    );
    choose(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00])], 'r.csv'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onFileValidate).not.toHaveBeenCalled();
  });

  it('passes a text CSV through to onFileValidate', async () => {
    const onFileValidate = vi.fn().mockRejectedValue(new Error('stop here'));
    render(
      <BulkImport
        title="Import"
        targetFields={targetFields}
        acceptedFileTypes={['.csv']}
        onFileValidate={onFileValidate}
        onImportConfirm={vi.fn()}
      />,
    );
    const csv = new File(['studentId,Maths\nS1,90\n'], 'r.csv', { type: 'text/csv' });
    choose(csv);
    await waitFor(() => expect(onFileValidate).toHaveBeenCalledWith(csv));
  });
});
