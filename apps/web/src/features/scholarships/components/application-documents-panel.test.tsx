/**
 * @vitest-environment jsdom
 *
 * PRC-L270 — the rejection reason belongs to the reject confirmation for the
 * specific document, not to a free-floating textarea outside every row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

const scholarshipBrowserFetch = vi.hoisted(() => vi.fn());

vi.mock('../scholarship-browser', async () => {
  const actual =
    await vi.importActual<typeof import('../scholarship-browser')>('../scholarship-browser');
  return { ...actual, scholarshipBrowserFetch };
});

import { ApplicationDocumentsPanel } from './application-documents-panel';

const ROW = {
  id: 'doc-1',
  documentType: 'other',
  originalFilename: 'income-certificate.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  verificationStatus: 'PENDING' as const,
  rejectionReason: null,
};

beforeEach(() => {
  scholarshipBrowserFetch.mockReset();
  scholarshipBrowserFetch.mockImplementation(async (path: string) =>
    path.endsWith('/documents') ? { data: [ROW] } : {},
  );
});

afterEach(() => {
  cleanup();
});

function rejectCalls() {
  return scholarshipBrowserFetch.mock.calls.filter(([path]) => String(path).endsWith('/reject'));
}

async function openReject() {
  render(<ApplicationDocumentsPanel applicationId="app-1" canReview />);
  await screen.findByTestId('scholarship-document-doc-1');
  act(() => {
    fireEvent.click(screen.getByTestId('document-reject-doc-1'));
  });
  return screen.getByRole('dialog');
}

describe('ApplicationDocumentsPanel reject (PRC-L270)', () => {
  it('renders the reason field only inside the open reject dialog', async () => {
    render(<ApplicationDocumentsPanel applicationId="app-1" canReview />);
    await screen.findByTestId('scholarship-document-doc-1');
    expect(screen.queryByLabelText(/Rejection reason/)).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId('document-reject-doc-1'));
    });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/Rejection reason/).tagName).toBe('TEXTAREA');
    // The dialog names the document being rejected.
    expect(dialog.textContent).toContain('income-certificate.pdf');
  });

  it('blocks an empty reason with an alert and posts nothing', async () => {
    const dialog = await openReject();
    act(() => {
      fireEvent.click(screen.getByTestId('scholarship-document-reject-confirm'));
    });
    expect(within(dialog).getByRole('alert').textContent).toContain('rejection reason');
    expect(rejectCalls()).toEqual([]);
  });

  it('posts the reason for the selected document', async () => {
    const dialog = await openReject();
    fireEvent.change(within(dialog).getByLabelText(/Rejection reason/), {
      target: { value: 'Scan is blurry' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('scholarship-document-reject-confirm'));
    });
    await waitFor(() => expect(rejectCalls()).toHaveLength(1));
    expect(rejectCalls()[0]).toEqual([
      '/applications/app-1/documents/doc-1/reject',
      { method: 'POST', json: { reason: 'Scan is blurry' }, apiRoot: '/api/scholarships' },
    ]);
  });

  it('clears the reason when the dialog is reopened', async () => {
    const dialog = await openReject();
    fireEvent.change(within(dialog).getByLabelText(/Rejection reason/), {
      target: { value: 'Draft text' },
    });
    act(() => {
      fireEvent.click(screen.getByTestId('scholarship-document-reject-cancel'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('document-reject-doc-1'));
    });
    const reopened = screen.getByRole('dialog');
    expect((within(reopened).getByLabelText(/Rejection reason/) as HTMLTextAreaElement).value).toBe(
      '',
    );
  });
});
