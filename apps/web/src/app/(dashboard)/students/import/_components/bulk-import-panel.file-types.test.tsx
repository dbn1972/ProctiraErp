/**
 * PRC-M571: the live bulk-import panel accepts only the Excel types the backend
 * import route accepts, so CSV is blocked consistently in UI and API
 * (packages/backend/student import-routes.test covers the API side).
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
describe('BulkImportPanel file types', () => {
  it('blocks CSV consistently with the API (PRC-M571)', () => {
    render(<BulkImportPanel />);
    const input = document.getElementById('import-file') as HTMLInputElement;
    expect(input.accept).not.toMatch(/csv/i);
    choose(new File(['a,b'], 'students.csv', { type: 'text/csv' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/only excel/i);
    expect(screen.getByRole('button', { name: /import/i })).toBeDisabled();
    expect(submitBulkImportAction).not.toHaveBeenCalled();
  });
});
