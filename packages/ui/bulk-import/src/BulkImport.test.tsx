import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BulkImport } from './BulkImport';
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
});
