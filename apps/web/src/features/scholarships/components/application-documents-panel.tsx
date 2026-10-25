'use client';

/**
 * Reviewer and applicant document list: preview/download, verify, and reject.
 * Reject uses ConfirmActionDialog so a mis-tap cannot discard a file.
 */
import { useCallback, useEffect, useState } from 'react';

import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { BrowserGatewayError, scholarshipBrowserFetch } from '../scholarship-browser';

import { documentTypeLabel } from '../document-upload';

interface ScholarshipDocumentRow {
  id: string;
  documentType: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  rejectionReason: string | null;
}

interface ApplicationDocumentsPanelProps {
  applicationId: string;
  /** Reviewers can verify and reject. Applicants get download only. */
  canReview?: boolean;
  /** Same-origin API root. Defaults to the staff scholarship proxy. */
  apiRoot?: string;
}

export function ApplicationDocumentsPanel({
  applicationId,
  canReview = false,
  apiRoot = '/api/scholarships',
}: ApplicationDocumentsPanelProps) {
  const [rows, setRows] = useState<ScholarshipDocumentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const rejectRow = rows.find((row) => row.id === rejectId) ?? null;
  const reasonFieldId = `reject-reason-${applicationId}`;

  // PRC-L270: the reason is scoped to one reject dialog; reset on open/close.
  const closeReject = () => {
    setRejectId(null);
    setReason('');
    setReasonError(null);
  };
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await scholarshipBrowserFetch<{ data: ScholarshipDocumentRow[] }>(
        `/applications/${applicationId}/documents`,
        { apiRoot },
      );
      setRows(result.data);
    } catch (err) {
      setError(err instanceof BrowserGatewayError ? err.message : 'Could not load documents');
    } finally {
      setLoading(false);
    }
  }, [applicationId, apiRoot]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (id: string) => {
    setError(null);
    try {
      const result = await scholarshipBrowserFetch<{ url: string }>(
        `/applications/${applicationId}/documents/${id}/download`,
        { apiRoot },
      );
      const gateway = process.env['NEXT_PUBLIC_GATEWAY_URL'] ?? '';
      const target = result.url.startsWith('http') ? result.url : `${gateway}${result.url}`;
      window.open(target, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof BrowserGatewayError ? err.message : 'Download failed');
    }
  };

  const verify = async (id: string) => {
    setError(null);
    setPending(true);
    try {
      await scholarshipBrowserFetch(`/applications/${applicationId}/documents/${id}/verify`, {
        method: 'POST',
        json: {},
        apiRoot,
      });
      await load();
    } catch (err) {
      setError(err instanceof BrowserGatewayError ? err.message : 'Could not verify the document');
    } finally {
      setPending(false);
    }
  };

  const reject = async () => {
    if (!rejectId) return;
    setPending(true);
    setError(null);
    try {
      await scholarshipBrowserFetch(`/applications/${applicationId}/documents/${rejectId}/reject`, {
        method: 'POST',
        json: { reason },
        apiRoot,
      });
      closeReject();
      await load();
    } catch (err) {
      setError(err instanceof BrowserGatewayError ? err.message : 'Could not reject the document');
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-label="Supporting documents"
      data-testid="scholarship-documents"
      className="space-y-3"
    >
      <h2 className="text-lg font-medium">Supporting documents</h2>
      {loading ? <p className="text-sm text-muted-foreground">Loading documents…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!loading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
      ) : null}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            data-testid={`scholarship-document-${row.id}`}
          >
            <div>
              <div className="font-medium">{documentTypeLabel(row.documentType)}</div>
              <div className="text-muted-foreground">
                {row.originalFilename} · {row.verificationStatus}
                {row.rejectionReason ? ` · ${row.rejectionReason}` : ''}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border px-2 py-1 text-xs"
                onClick={() => void download(row.id)}
              >
                Download
              </button>
              {row.mimeType === 'application/pdf' || row.mimeType.startsWith('image/') ? (
                <button
                  type="button"
                  className="rounded-md border px-2 py-1 text-xs"
                  onClick={() => void download(row.id)}
                >
                  Preview
                </button>
              ) : null}
              {canReview && row.verificationStatus === 'PENDING' ? (
                <>
                  <button
                    type="button"
                    className="rounded-md bg-green-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                    disabled={pending}
                    data-testid={`document-verify-${row.id}`}
                    onClick={() => void verify(row.id)}
                  >
                    Verify
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-red-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                    disabled={pending}
                    data-testid={`document-reject-${row.id}`}
                    onClick={() => {
                      setReason('');
                      setReasonError(null);
                      setRejectId(row.id);
                    }}
                  >
                    Reject
                  </button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmActionDialog
        open={rejectId != null}
        onOpenChange={(open) => {
          if (!open) closeReject();
        }}
        title="Reject this document?"
        description={
          rejectRow
            ? `${documentTypeLabel(rejectRow.documentType)} (${rejectRow.originalFilename}) will be marked Rejected. The applicant will see your reason.`
            : 'The applicant will see your reason.'
        }
        confirmLabel="Reject document"
        destructive
        pending={pending}
        onConfirm={() => {
          if (!reason.trim()) {
            setReasonError('Enter a rejection reason before confirming.');
            return;
          }
          void reject();
        }}
        testId="scholarship-document-reject"
      >
        <div className="space-y-1.5">
          <label className="block text-xs font-medium" htmlFor={reasonFieldId}>
            Rejection reason (required)
          </label>
          <textarea
            id={reasonFieldId}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (reasonError) setReasonError(null);
            }}
            rows={3}
            required
            aria-required="true"
            aria-invalid={reasonError ? 'true' : undefined}
            aria-describedby={reasonError ? `${reasonFieldId}-error` : undefined}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
          {reasonError ? (
            <p id={`${reasonFieldId}-error`} role="alert" className="text-sm text-destructive">
              {reasonError}
            </p>
          ) : null}
        </div>
      </ConfirmActionDialog>
    </section>
  );
}
