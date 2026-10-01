import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BulkImport, importErrorsToCsv } from './BulkImport';
import type { ImportValidationResult } from './types';

const targetFields = [
  { name: 'firstName', label: 'First Name', required: true },
  { name: 'lastName', label: 'Last Name', required: true },
  { name: 'email', label: 'Email', required: false },
];

const mockValidationResult: ImportValidationResult = {
  totalRows: 10,
  validRows: 8,
  errorRows: 2,
  warningRows: 0,
  errors: [
    { row: 3, field: 'firstName', message: 'Required field is empty', severity: 'error' },
    {
      row: 7,
      field: 'email',
      message: 'Invalid email format',
      value: 'not-an-email',
      severity: 'error',
    },
  ],
  preview: [
    {
      rowNumber: 1,
      data: { firstName: 'Alice', lastName: 'Smith', email: 'alice@test.com' },
      hasErrors: false,
      errors: [],
    },
    {
      rowNumber: 2,
      data: { firstName: 'Bob', lastName: 'Jones', email: 'bob@test.com' },
      hasErrors: false,
      errors: [],
    },
  ],
  columnMappings: [
    { sourceColumn: 'First Name', targetField: 'firstName', required: true, valid: true },
    { sourceColumn: 'Last Name', targetField: 'lastName', required: true, valid: true },
    { sourceColumn: 'Email Address', targetField: 'email', required: false, valid: true },
  ],
};

function createFile(name: string, size: number): File {
  const content = new Array(size).fill('a').join('');
  return new File([content], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('BulkImport', () => {
  it('renders title and upload step initially', () => {
    render(
      <BulkImport
        title="Import Students"
        targetFields={targetFields}
        onFileValidate={vi.fn()}
        onImportConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText('Import Students')).toBeInTheDocument();
    expect(screen.getByText(/choose a file/i)).toBeInTheDocument();
  });

  it('renders step indicator', () => {
    render(
      <BulkImport
        title="Import Students"
        targetFields={targetFields}
        onFileValidate={vi.fn()}
        onImportConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('Map Columns')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('shows error for oversized file', async () => {
    render(
      <BulkImport
        title="Import Students"
        targetFields={targetFields}
        maxFileSize={100}
        onFileValidate={vi.fn()}
        onImportConfirm={vi.fn()}
      />,
    );

    const file = createFile('big.xlsx', 200);
    const input = screen.getByLabelText(/choose a file/i);

    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/exceeds maximum/i)).toBeInTheDocument();
    });
  });

  it('shows error for invalid file type', async () => {
    render(
      <BulkImport
        title="Import Students"
        targetFields={targetFields}
        acceptedFileTypes={['.xlsx']}
        onFileValidate={vi.fn()}
        onImportConfirm={vi.fn()}
      />,
    );

    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    const input = screen.getByLabelText(/choose a file/i);

    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByText(/not accepted/i)).toBeInTheDocument();
    });
  });

  it('transitions to mapping step after successful validation', async () => {
    const onFileValidate = vi.fn().mockResolvedValue(mockValidationResult);
    render(
      <BulkImport
        title="Import Students"
        targetFields={targetFields}
        onFileValidate={onFileValidate}
        onImportConfirm={vi.fn()}
      />,
    );

    const file = createFile('students.xlsx', 100);
    const input = screen.getByLabelText(/choose a file/i);

    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByText('Map Columns to Fields')).toBeInTheDocument();
    });
  });

  it('renders download template button when handler provided', () => {
    const onDownloadTemplate = vi.fn();
    render(
      <BulkImport
        title="Import Students"
        targetFields={targetFields}
        onFileValidate={vi.fn()}
        onImportConfirm={vi.fn()}
        onDownloadTemplate={onDownloadTemplate}
      />,
    );

    const templateBtn = screen.getByRole('button', { name: /download import template/i });
    fireEvent.click(templateBtn);
    expect(onDownloadTemplate).toHaveBeenCalled();
  });

  it('renders cancel button when onCancel is provided', () => {
    const onCancel = vi.fn();
    render(
      <BulkImport
        title="Import Students"
        targetFields={targetFields}
        onFileValidate={vi.fn()}
        onImportConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const cancelBtn = screen.getByRole('button', { name: /cancel import/i });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalled();
  });

  it('has proper WCAG accessibility on step indicator', () => {
    render(
      <BulkImport
        title="Import Students"
        targetFields={targetFields}
        onFileValidate={vi.fn()}
        onImportConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('navigation', { name: /import progress/i })).toBeInTheDocument();
  });

  it('shows accepted file types in upload area', () => {
    render(
      <BulkImport
        title="Import Students"
        targetFields={targetFields}
        acceptedFileTypes={['.xlsx', '.csv']}
        onFileValidate={vi.fn()}
        onImportConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText(/\.xlsx, \.csv/)).toBeInTheDocument();
  });

  describe('duplicate column mapping (PRC-L193)', () => {
    it('shows an error and blocks Continue when a field is mapped twice', async () => {
      const onFileValidate = vi.fn().mockResolvedValue({
        ...mockValidationResult,
        columnMappings: [
          { sourceColumn: 'First Name', targetField: 'firstName', required: true, valid: true },
          { sourceColumn: 'Given Name', targetField: 'firstName', required: false, valid: true },
          { sourceColumn: 'Last Name', targetField: 'lastName', required: true, valid: true },
        ],
      });
      render(
        <BulkImport
          title="Import Students"
          targetFields={targetFields}
          onFileValidate={onFileValidate}
          onImportConfirm={vi.fn()}
        />,
      );
      const input = screen.getByLabelText(/choose a file/i);
      Object.defineProperty(input, 'files', { value: [createFile('students.xlsx', 100)] });
      fireEvent.change(input);
      await screen.findByText('Map Columns to Fields');
      expect(screen.getAllByText('Duplicate')).toHaveLength(2);
      fireEvent.click(screen.getByRole('button', { name: 'Continue to Preview' }));
      expect(screen.getByRole('alert')).toHaveTextContent(/mapped more than once: First Name/i);
      expect(screen.getByText('Map Columns to Fields')).toBeInTheDocument();
      expect(screen.queryByText('Validation Preview')).not.toBeInTheDocument();

      // Resolving the duplicate unblocks Continue; used options are disabled elsewhere
      fireEvent.change(screen.getByLabelText('Map Given Name to target field'), {
        target: { value: '' },
      });
      const givenNameSelect = screen.getByLabelText('Map Given Name to target field');
      const lastNameOption = Array.from(givenNameSelect.querySelectorAll('option')).find(
        (o) => o.value === 'lastName',
      );
      expect(lastNameOption).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Continue to Preview' }));
      expect(await screen.findByText('Validation Preview')).toBeInTheDocument();
    });
  });

  describe('error download (PRC-L194)', () => {
    const manyErrors = Array.from({ length: 75 }, (_, i) => ({
      row: i + 1,
      field: 'email',
      message: 'Invalid email format',
      value: i === 0 ? '=HYPERLINK("x")' : `bad${i}`,
      severity: 'error' as const,
    }));

    async function goToPreview(onDownloadErrors?: ReturnType<typeof vi.fn>) {
      const onFileValidate = vi
        .fn()
        .mockResolvedValue({ ...mockValidationResult, errors: manyErrors });
      render(
        <BulkImport
          title="Import Students"
          targetFields={targetFields}
          onFileValidate={onFileValidate}
          onImportConfirm={vi
            .fn()
            .mockResolvedValue({ success: 1, failed: 1, errors: [manyErrors[1]] })}
          onDownloadErrors={onDownloadErrors}
        />,
      );
      const input = screen.getByLabelText(/choose a file/i);
      Object.defineProperty(input, 'files', { value: [createFile('students.xlsx', 100)] });
      fireEvent.change(input);
      fireEvent.click(await screen.findByRole('button', { name: 'Continue to Preview' }));
    }

    it('offers the full error list when more than 50 errors exist', async () => {
      const onDownloadErrors = vi.fn();
      await goToPreview(onDownloadErrors);
      expect(screen.getByText('Showing first 50 of 75 errors')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Download all 75 errors (CSV)' }));
      expect(onDownloadErrors).toHaveBeenCalledWith(manyErrors, 'validation');

      fireEvent.click(screen.getByRole('button', { name: /import 8 valid rows/i }));
      fireEvent.click(
        await screen.findByRole('button', { name: 'Download 1 failed row errors (CSV)' }),
      );
      expect(onDownloadErrors).toHaveBeenLastCalledWith([manyErrors[1]], 'import');
    });

    it('falls back to a built-in CSV download', async () => {
      const createObjectURL = vi.fn().mockReturnValue('blob:x');
      const revokeObjectURL = vi.fn();
      Object.assign(URL, { createObjectURL, revokeObjectURL });
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      await goToPreview();
      fireEvent.click(screen.getByRole('button', { name: 'Download all 75 errors (CSV)' }));
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(click).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
      click.mockRestore();
    });

    it('serialises every error as CSV and neutralises formulas', () => {
      const csv = importErrorsToCsv(manyErrors);
      const lines = csv.split('\r\n');
      expect(lines).toHaveLength(76);
      expect(lines[0]).toBe('"Row","Field","Value","Error","Severity"');
      expect(lines[1]).toBe('"1","email","\'=HYPERLINK(""x"")","Invalid email format","error"');
    });
  });
});
