/**
 * @vitest-environment jsdom
 *
 * PRC-M072: warehouse import never claims "Import queued" without a transfer
 * path, enforces the 50 MB / extension limits and masks the connection string.
 */
import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import {
  ImportSourceForms,
  MAX_IMPORT_FILE_BYTES,
  validateImportFile,
} from './import-source-forms';

function uploadCsv(file: File) {
  const input = screen.getByLabelText('Upload CSV file') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  const form = input.closest('form') as HTMLFormElement;
  fireEvent.submit(form);
}

describe('validateImportFile (PRC-M072)', () => {
  it('rejects files over 50 MB', () => {
    expect(validateImportFile({ name: 'big.csv', size: 60 * 1024 * 1024 }, '.csv', 'CSV')).toMatch(
      /50 MB/,
    );
  });
  it('rejects disallowed extensions', () => {
    expect(validateImportFile({ name: 'x.exe', size: 10 }, '.csv', 'CSV')).toMatch(/\.csv/);
  });
  it('accepts a small csv', () => {
    expect(
      validateImportFile({ name: 'a.CSV', size: MAX_IMPORT_FILE_BYTES }, '.csv', 'CSV'),
    ).toBeNull();
  });
});

describe('ImportSourceForms live mode (PRC-M072)', () => {
  it('says upload is not available instead of "Import queued"', async () => {
    render(<ImportSourceForms liveImport />);
    await act(async () => {
      uploadCsv(new File(['id,name\n1,Ada\n'], 'students.csv', { type: 'text/csv' }));
    });
    const alert = screen.getByTestId('csv-live-submit');
    expect(alert.textContent).toMatch(/not available yet/i);
    expect(screen.queryByText('Import queued')).toBeNull();
  });

  it('shows an error for a 60 MB file', async () => {
    render(<ImportSourceForms liveImport />);
    const big = new File(['x'], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(big, 'size', { value: 60 * 1024 * 1024 });
    await act(async () => {
      uploadCsv(big);
    });
    expect(screen.getByRole('alert').textContent).toMatch(/50 MB/);
  });

  it('masks the connection string input', () => {
    render(<ImportSourceForms liveImport />);
    const input = screen.getByLabelText(/connection string/i) as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
  });
});
