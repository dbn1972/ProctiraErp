/**
 * PRC-M570: the live bulk-import panel submits the selected file with the
 * current duplicate resolution (no stale closure).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const submitBulkImportAction = vi.fn();
vi.mock('../../actions', () => ({
  submitBulkImportAction: (...args: unknown[]) => submitBulkImportAction(...args),
}));
import { BulkImportPanel } from './bulk-import-panel';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function choose(file: File) {
  const input = document.getElementById('import-file') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}
beforeEach(() => {
  submitBulkImportAction.mockReset();
  // jsdom's Blob may lack arrayBuffer(); read through FileReader instead.
  if (!('arrayBuffer' in Blob.prototype)) {
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      configurable: true,
      value(this: Blob) {
        return new Promise<ArrayBuffer>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.readAsArrayBuffer(this);
        });
      },
    });
  }
});
describe('BulkImportPanel', () => {
  it('select file then Import issues the import action with that file (PRC-M570)', async () => {
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
    render(<BulkImportPanel />);
    const importButton = screen.getByRole('button', { name: /import/i });
    expect(importButton).toBeDisabled();
    choose(new File(['xlsx-bytes'], 'students.xlsx', { type: XLSX }));
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(submitBulkImportAction).toHaveBeenCalledTimes(1));
    const payload = submitBulkImportAction.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      fileName: 'students.xlsx',
      mimeType: XLSX,
      duplicateResolution: 'skip',
      async: false,
    });
    expect(atob(String(payload['fileBase64']))).toBe('xlsx-bytes');
  });
});
