/**
 * @vitest-environment jsdom
 *
 * PRC-L270 — removing an uploaded scholarship document needs an explicit
 * confirmation; a single mis-tap must not delete the file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const scholarshipBrowserFetch = vi.hoisted(() => vi.fn());

vi.mock('../scholarship-browser', async () => {
  const actual =
    await vi.importActual<typeof import('../scholarship-browser')>('../scholarship-browser');
  return { ...actual, scholarshipBrowserFetch };
});

import { DocumentUploadSlots } from './document-upload-slots';

const DOC = {
  id: 'doc-1',
  documentType: 'other',
  originalFilename: 'income-certificate.pdf',
  verificationStatus: 'PENDING',
  sizeBytes: 1024,
};

function renderSlots(onRemoved = vi.fn()) {
  render(
    <DocumentUploadSlots
      applicationId="app-1"
      types={['other']}
      requiredTypes={[]}
      documents={[DOC]}
      onUploaded={vi.fn()}
      onRemoved={onRemoved}
    />,
  );
  return onRemoved;
}

beforeEach(() => {
  scholarshipBrowserFetch.mockReset();
  scholarshipBrowserFetch.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('DocumentUploadSlots remove (PRC-L270)', () => {
  it('asks for confirmation before deleting, and Cancel keeps the file', () => {
    const onRemoved = renderSlots();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });

    expect(scholarshipBrowserFetch).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('income-certificate.pdf');

    act(() => {
      fireEvent.click(screen.getByTestId('scholarship-document-remove-cancel'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(scholarshipBrowserFetch).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(screen.getByText('income-certificate.pdf')).toBeTruthy();
  });

  it('deletes only after the user confirms', async () => {
    const onRemoved = renderSlots();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('scholarship-document-remove-confirm'));
    });

    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith('doc-1'));
    expect(scholarshipBrowserFetch).toHaveBeenCalledTimes(1);
    expect(scholarshipBrowserFetch).toHaveBeenCalledWith('/applications/app-1/documents/doc-1', {
      method: 'DELETE',
      apiRoot: '/api/scholarships',
    });
  });
});
