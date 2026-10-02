import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { FileUpload } from './FileUpload';

/** PRC-L396: validation failures must be visible without onValidationError. */
function selectFiles(files: File[]): void {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

describe('FileUpload visible validation errors (PRC-L396)', () => {
  it('shows a visible alert for an oversize file when no onValidationError is wired', () => {
    const onFilesSelected = vi.fn();
    render(<FileUpload onFilesSelected={onFilesSelected} maxSize={100} ariaLabel="Upload logo" />);
    selectFiles([new File(['x'.repeat(500)], 'logo.png', { type: 'image/png' })]);
    const alert = screen.getByRole('alert');
    expect(alert).toBeVisible();
    expect(alert).toHaveTextContent('logo.png');
    expect(alert).toHaveTextContent(/exceeds maximum/);
    expect(onFilesSelected).not.toHaveBeenCalled();
  });

  it('shows a visible alert for a wrong file type and clears it after a valid pick', () => {
    const onFilesSelected = vi.fn();
    render(
      <FileUpload onFilesSelected={onFilesSelected} accept={['image/png']} ariaLabel="Upload" />,
    );
    selectFiles([new File(['a'], 'notes.txt', { type: 'text/plain' })]);
    expect(screen.getByRole('alert')).toHaveTextContent(/not accepted/);
    selectFiles([new File(['a'], 'ok.png', { type: 'image/png' })]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onFilesSelected).toHaveBeenCalledTimes(1);
  });

  it('still calls onValidationError and can opt out of the built-in alert', () => {
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
    expect(onValidationError).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('file-upload-errors')).toBeNull();
  });
});
