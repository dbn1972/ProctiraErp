import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FileUpload } from './FileUpload';

function createFile(name: string, size: number, type: string): File {
  const content = new Array(size).fill('a').join('');
  return new File([content], name, { type });
}

describe('FileUpload', () => {
  it('renders drop zone with label', () => {
    render(<FileUpload onFilesSelected={vi.fn()} ariaLabel="Upload documents" />);

    expect(screen.getByText(/drag and drop files here/i)).toBeInTheDocument();
  });

  it('renders accepted file types info', () => {
    render(
      <FileUpload
        accept={['.pdf', '.xlsx']}
        onFilesSelected={vi.fn()}
        ariaLabel="Upload documents"
      />,
    );

    expect(screen.getByText(/\.pdf, \.xlsx/)).toBeInTheDocument();
  });

  it('renders max file size info', () => {
    render(
      <FileUpload
        maxSize={10 * 1024 * 1024}
        onFilesSelected={vi.fn()}
        ariaLabel="Upload documents"
      />,
    );

    expect(screen.getByText(/10\.0 MB/)).toBeInTheDocument();
  });

  it('calls onFilesSelected with valid files', () => {
    const onFilesSelected = vi.fn();
    render(
      <FileUpload
        accept={['.pdf']}
        onFilesSelected={onFilesSelected}
        ariaLabel="Upload documents"
      />,
    );

    const file = createFile('test.pdf', 100, 'application/pdf');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    expect(onFilesSelected).toHaveBeenCalledWith([file]);
  });

  it('calls onValidationError for invalid file type', () => {
    const onValidationError = vi.fn();
    const onFilesSelected = vi.fn();
    render(
      <FileUpload
        accept={['.pdf']}
        onFilesSelected={onFilesSelected}
        onValidationError={onValidationError}
        ariaLabel="Upload documents"
      />,
    );

    const file = createFile('test.exe', 100, 'application/x-msdownload');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    expect(onValidationError).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ error: 'type' })]),
    );
    expect(onFilesSelected).not.toHaveBeenCalled();
  });

  it('calls onValidationError for oversized files', () => {
    const onValidationError = vi.fn();
    const onFilesSelected = vi.fn();
    render(
      <FileUpload
        maxSize={100}
        onFilesSelected={onFilesSelected}
        onValidationError={onValidationError}
        ariaLabel="Upload documents"
      />,
    );

    const file = createFile('big.pdf', 200, 'application/pdf');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    expect(onValidationError).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ error: 'size' })]),
    );
  });

  it('renders file list when files are provided', () => {
    const file = createFile('report.pdf', 1024, 'application/pdf');
    render(
      <FileUpload
        onFilesSelected={vi.fn()}
        files={[{ id: '1', file, progress: 100, status: 'complete' }]}
        ariaLabel="Upload documents"
      />,
    );

    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('renders remove button and calls onFileRemove', () => {
    const onFileRemove = vi.fn();
    const file = createFile('report.pdf', 1024, 'application/pdf');
    render(
      <FileUpload
        onFilesSelected={vi.fn()}
        onFileRemove={onFileRemove}
        files={[{ id: '1', file, progress: 100, status: 'complete' }]}
        ariaLabel="Upload documents"
      />,
    );

    const removeBtn = screen.getByRole('button', { name: /remove report\.pdf/i });
    fireEvent.click(removeBtn);
    expect(onFileRemove).toHaveBeenCalledWith('1');
  });

  it('shows progress bar for uploading files', () => {
    const file = createFile('report.pdf', 1024, 'application/pdf');
    render(
      <FileUpload
        onFilesSelected={vi.fn()}
        files={[{ id: '1', file, progress: 50, status: 'uploading' }]}
        ariaLabel="Upload documents"
      />,
    );

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '50');
  });

  it('disables drop zone when disabled', () => {
    render(<FileUpload onFilesSelected={vi.fn()} disabled ariaLabel="Upload documents" />);

    const dropZone = screen.getByRole('button');
    expect(dropZone).toHaveAttribute('aria-disabled', 'true');
  });

  it('supports keyboard activation of drop zone', () => {
    render(<FileUpload onFilesSelected={vi.fn()} ariaLabel="Upload documents" />);

    const dropZone = screen.getByRole('button');
    expect(dropZone).toHaveAttribute('tabIndex', '0');
  });

  describe('multi-file drop (PRC-L192)', () => {
    const drop = (files: File[]) => {
      fireEvent.drop(screen.getByRole('button'), { dataTransfer: { files } });
    };

    it('accepts several dropped files up to maxFiles when multiple', () => {
      const onFilesSelected = vi.fn();
      const onValidationError = vi.fn();
      render(
        <FileUpload
          multiple
          maxFiles={2}
          onFilesSelected={onFilesSelected}
          onValidationError={onValidationError}
          ariaLabel="Upload documents"
        />,
      );
      const files = ['a', 'b', 'c'].map((n) => createFile(`${n}.pdf`, 10, 'application/pdf'));
      drop(files);
      expect(onFilesSelected).toHaveBeenCalledWith([files[0], files[1]]);
      expect(onValidationError).toHaveBeenCalledWith([
        expect.objectContaining({ file: files[2], error: 'count' }),
      ]);
    });

    it('keeps only one dropped file in single-file mode', () => {
      const onFilesSelected = vi.fn();
      const onValidationError = vi.fn();
      render(
        <FileUpload
          onFilesSelected={onFilesSelected}
          onValidationError={onValidationError}
          ariaLabel="Upload documents"
        />,
      );
      const files = ['a', 'b'].map((n) => createFile(`${n}.pdf`, 10, 'application/pdf'));
      drop(files);
      expect(onFilesSelected).toHaveBeenCalledWith([files[0]]);
      expect(onValidationError).toHaveBeenCalledWith([
        expect.objectContaining({
          file: files[1],
          error: 'count',
          message: 'Maximum 1 file allowed',
        }),
      ]);
    });
  });
});
