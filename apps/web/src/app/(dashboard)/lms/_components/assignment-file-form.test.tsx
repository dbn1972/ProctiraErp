/**
 * @vitest-environment jsdom
 *
 * PRC-M099 — the 5 MB LMS upload limit is enforced client-side with a distinct
 * size message (alert), and the action schema refuses over-limit payloads.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lmsFileUploadSchema } from '@/lib/validation/lms-depth-schema';

const uploadLmsFileAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../depth-actions', () => ({
  uploadLmsFileAction: (...args: unknown[]) => uploadLmsFileAction(...args),
  gradeWithRubricAction: vi.fn(),
}));

import { AssignmentFileForm, fileTooLargeMessage } from './depth-grade-forms';

const UUID = '12345678-1234-4234-8234-123456789abc';

function pick(file: File) {
  const input = screen.getByLabelText('Submission file') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.submit(screen.getByTestId('lms-file-form'));
}

describe('AssignmentFileForm (PRC-M099)', () => {
  beforeEach(() => uploadLmsFileAction.mockReset());

  it('rejects a 5.1 MB file with a specific size alert and no upload', () => {
    render(<AssignmentFileForm assignmentId={UUID} />);
    const file = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: Math.round(5.1 * 1024 * 1024) });
    pick(file);
    expect(screen.getByRole('alert').textContent).toBe(fileTooLargeMessage(file.size));
    expect(screen.getByRole('alert').textContent).toContain('5.1 MB');
    expect(uploadLmsFileAction).not.toHaveBeenCalled();
  });

  it('uploads an in-limit file and reports success as status', async () => {
    uploadLmsFileAction.mockResolvedValue({ status: 'success', id: 'f1' });
    render(<AssignmentFileForm assignmentId={UUID} />);
    pick(new File(['%PDF-1.7'], 'ok.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('File uploaded.'));
  });

  it('surfaces a server rejection (e.g. content mismatch) as an alert', async () => {
    uploadLmsFileAction.mockResolvedValue({
      status: 'error',
      message: 'File content does not match application/pdf',
    });
    render(<AssignmentFileForm assignmentId={UUID} />);
    pick(new File(['MZ'], 'evil.pdf', { type: 'application/pdf' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('does not match application/pdf'),
    );
  });

  it('schema refuses a base64 payload larger than 5 MB of bytes', () => {
    const base = { assignmentId: UUID, filename: 'a.pdf', mimeType: 'application/pdf' } as const;
    expect(
      lmsFileUploadSchema.safeParse({ ...base, contentBase64: 'A'.repeat(6_990_508) }).success,
    ).toBe(true);
    expect(
      lmsFileUploadSchema.safeParse({ ...base, contentBase64: 'A'.repeat(6_990_512) }).success,
    ).toBe(false);
  });
});
