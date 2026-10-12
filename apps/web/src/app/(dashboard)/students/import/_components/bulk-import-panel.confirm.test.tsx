/**
 * @vitest-environment jsdom
 *
 * PRC-M127: "Start import" must not commit immediately. It opens a confirmation
 * dialog; the server action only runs after the operator confirms.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const submitBulkImportAction = vi.fn();
vi.mock('../../actions', () => ({
  submitBulkImportAction: (...args: unknown[]) => submitBulkImportAction(...args),
}));

import { BulkImportPanel } from './bulk-import-panel';

function selectFile() {
  const input = screen.getByLabelText('Excel file', { selector: 'input' }) as HTMLInputElement;
  const file = new File(['data'], 'students.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  submitBulkImportAction.mockReset();
  submitBulkImportAction.mockResolvedValue({
    status: 'success',
    data: {
      totalRows: 1,
      successCount: 1,
      errorCount: 0,
      duplicateCount: 0,
      errors: [],
      duplicates: [],
    },
  });
  // jsdom's File has no arrayBuffer(); provide one so the submit path runs.
  if (!('arrayBuffer' in File.prototype)) {
    Object.defineProperty(File.prototype, 'arrayBuffer', {
      configurable: true,
      value: () => Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer),
    });
  } else {
    vi.spyOn(File.prototype, 'arrayBuffer').mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer);
  }
});

describe('BulkImportPanel confirm-before-commit (PRC-M127)', () => {
  it('opens a confirmation dialog and does not import until confirmed', async () => {
    render(<BulkImportPanel />);
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: 'Start import' }));
    expect(screen.getByTestId('bulk-import-confirm')).toBeTruthy();
    expect(submitBulkImportAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('bulk-import-confirm-confirm'));
    await waitFor(() => expect(submitBulkImportAction).toHaveBeenCalledTimes(1));
  });

  it('cancelling the confirmation imports nothing', async () => {
    render(<BulkImportPanel />);
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: 'Start import' }));
    fireEvent.click(screen.getByTestId('bulk-import-confirm-cancel'));
    expect(submitBulkImportAction).not.toHaveBeenCalled();
  });
});
