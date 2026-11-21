import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FileUpload } from './FileUpload';
import type { FileScanResult } from './types';

/** PRC-L201 / topic 18: FileUpload shows the server's async scan status. */
function selectFiles(files: File[]): void {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('FileUpload async scan status (PRC-L201)', () => {
  it('shows scanning until the server verdict arrives, then announces it', async () => {
    const scan = deferred<FileScanResult[]>();
    const file = new File(['data'], 'report.bin');
    render(<FileUpload onFilesSelected={() => scan.promise} ariaLabel="Upload" />);
    selectFiles([file]);
    const status = await screen.findByTestId('file-upload-scan-status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent(/report\.bin: Scanning/);
    await act(async () => {
      scan.resolve([{ file, scanStatus: 'infected' }]);
      await scan.promise;
    });
    expect(screen.getByTestId('file-upload-scan-status')).toHaveTextContent(
      /report\.bin: Blocked: malware detected/,
    );
  });

  it('marks every file failed when the upload promise rejects', async () => {
    const scan = deferred<FileScanResult[]>();
    const file = new File(['data'], 'report.bin');
    render(<FileUpload onFilesSelected={() => scan.promise} ariaLabel="Upload" />);
    selectFiles([file]);
    await act(async () => {
      scan.reject(new Error('Scanner unavailable'));
      await scan.promise.catch(() => undefined);
    });
    expect(screen.getByTestId('file-upload-scan-status')).toHaveTextContent(
      /report\.bin: Scanner unavailable/,
    );
  });

  it('renders the scan status of consumer-managed files', () => {
    const file = new File(['data'], 'evidence.pdf');
    render(
      <FileUpload
        onFilesSelected={() => undefined}
        files={[{ id: '1', file, progress: 100, status: 'complete', scanStatus: 'pending' }]}
        ariaLabel="Upload"
      />,
    );
    expect(screen.getByTestId('file-upload-file-scan-1')).toHaveTextContent('Scanning…');
  });
});
