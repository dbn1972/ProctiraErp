import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { FileUpload } from './FileUpload';

/** PRC-L396: validation failures must be visible without onValidationError. */
function selectFiles(files: File[]): void {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

describe('FileUpload visible validation errors (PRC-L396)', () => {
  it('shows a visible alert for an oversize file when no onValidationError is wired', async () => {
    const onFilesSelected = vi.fn();
    render(<FileUpload onFilesSelected={onFilesSelected} maxSize={100} ariaLabel="Upload logo" />);
    selectFiles([new File(['x'.repeat(500)], 'logo.png', { type: 'image/png' })]);
    const alert = await screen.findByRole('alert');
    expect(alert).toBeVisible();
    expect(alert).toHaveTextContent('logo.png');
    expect(alert).toHaveTextContent(/exceeds maximum/);
    expect(onFilesSelected).not.toHaveBeenCalled();
  });

  it('shows a visible alert for a wrong file type and clears it after a valid pick', async () => {
    const onFilesSelected = vi.fn();
    render(
      <FileUpload onFilesSelected={onFilesSelected} accept={['image/png']} ariaLabel="Upload" />,
    );
    selectFiles([new File(['a'], 'notes.txt', { type: 'text/plain' })]);
    expect(await screen.findByRole('alert')).toHaveTextContent(/not accepted/);
    // PRC-L200: a real PNG signature so content sniffing accepts it.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    selectFiles([new File([png], 'ok.png', { type: 'image/png' })]);
    await waitFor(() => expect(onFilesSelected).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still calls onValidationError and can opt out of the built-in alert', async () => {
    const onValidationError = vi.fn();
    render(
      <FileUpload
        onFilesSelected={vi.fn()}
        onValidationError={onValidationError}
        showValidationErrors={false}
        maxSize={1}
        ariaLabel="Upload"
      />,
    );
    selectFiles([new File(['abc'], 'big.png', { type: 'image/png' })]);
    await waitFor(() => expect(onValidationError).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('file-upload-errors')).toBeNull();
  });
});
