import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileUpload } from './FileUpload';

/**
 * PRC-L200: the declared type (extension / client MIME) must match the file's
 * magic bytes; a forged MIME type is rejected before onFilesSelected.
 */
function selectFiles(files: File[]): void {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

const PE_HEADER = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

describe('FileUpload content sniffing (PRC-L200)', () => {
  it('rejects an executable renamed to .pdf with a forged application/pdf type', async () => {
    const onFilesSelected = vi.fn();
    const onValidationError = vi.fn();
    render(
      <FileUpload
        accept={['.pdf']}
        onFilesSelected={onFilesSelected}
        onValidationError={onValidationError}
        ariaLabel="Upload"
      />,
    );
    selectFiles([new File([PE_HEADER], 'invoice.pdf', { type: 'application/pdf' })]);
    await waitFor(() =>
      expect(onValidationError).toHaveBeenCalledWith([
        expect.objectContaining({ error: 'content' }),
      ]),
    );
    expect(onFilesSelected).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/does not match its declared type/);
  });

  it('rejects a PNG declared as JPEG', async () => {
    const onFilesSelected = vi.fn();
    const onValidationError = vi.fn();
    render(
      <FileUpload
        onFilesSelected={onFilesSelected}
        onValidationError={onValidationError}
        ariaLabel="Upload"
      />,
    );
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    selectFiles([new File([png], 'photo.jpg', { type: 'image/jpeg' })]);
    await waitFor(() => expect(onValidationError).toHaveBeenCalled());
    expect(onFilesSelected).not.toHaveBeenCalled();
  });

  it('accepts a genuine PDF', async () => {
    const onFilesSelected = vi.fn();
    render(<FileUpload accept={['.pdf']} onFilesSelected={onFilesSelected} ariaLabel="Upload" />);
    const pdf = new File(['%PDF-1.7\n'], 'invoice.pdf', { type: 'application/pdf' });
    selectFiles([pdf]);
    await waitFor(() => expect(onFilesSelected).toHaveBeenCalledWith([pdf]));
  });

  it('does not sniff types it has no signature for', async () => {
    const onFilesSelected = vi.fn();
    render(<FileUpload onFilesSelected={onFilesSelected} ariaLabel="Upload" />);
    const txt = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    selectFiles([txt]);
    await waitFor(() => expect(onFilesSelected).toHaveBeenCalledWith([txt]));
  });
});
