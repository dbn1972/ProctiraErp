'use client';

/**
 * Per-type file slots for a scholarship draft. Drag-drop and a button both
 * feed the same labelled file input so keyboard users are not stuck.
 */
import { useId, useRef, useState } from 'react';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';
import { CSRF_HEADER, readCsrfTokenFromDocument } from '@/lib/auth/csrf';

import {
  clientFileError,
  documentTypeLabel,
  SCHOLARSHIP_DOCUMENT_ACCEPT,
} from '../document-upload';

export interface UploadedScholarshipDocument {
  id: string;
  documentType: string;
  originalFilename: string;
  verificationStatus: string;
  sizeBytes: number;
}

interface DocumentUploadSlotsProps {
  applicationId: string;
  /** Slots to render. Required ones are also listed in `requiredTypes`. */
  types: string[];
  requiredTypes: string[];
  documents: UploadedScholarshipDocument[];
  onUploaded: (doc: UploadedScholarshipDocument) => void;
  onRemoved: (id: string) => void;
}

async function uploadWithProgress(
  applicationId: string,
  documentType: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<UploadedScholarshipDocument> {
  const body = new FormData();
  body.set('documentType', documentType);
  body.set('file', file, file.name);
  const base = process.env['NEXT_PUBLIC_GATEWAY_URL'] ?? '';
  const url = `${base}/api/v1/scholarships/applications/${applicationId}/documents`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    const csrf = readCsrfTokenFromDocument();
    if (csrf) xhr.setRequestHeader(CSRF_HEADER, csrf);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as UploadedScholarshipDocument);
        return;
      }
      const message =
        payload && typeof payload === 'object' && 'message' in payload
          ? String((payload as { message: unknown }).message)
          : 'Upload failed';
      reject(new BrowserGatewayError({ status: xhr.status, code: 'UPLOAD_FAILED', message }));
    };
    xhr.onerror = () => {
      reject(
        new BrowserGatewayError({ status: 0, code: 'NETWORK_ERROR', message: 'Upload failed' }),
      );
    };
    xhr.send(body);
  });
}

function Slot({
  applicationId,
  documentType,
  required,
  existing,
  onUploaded,
  onRemoved,
}: {
  applicationId: string;
  documentType: string;
  required: boolean;
  existing: UploadedScholarshipDocument | undefined;
  onUploaded: (doc: UploadedScholarshipDocument) => void;
  onRemoved: (id: string) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const label = documentTypeLabel(documentType);

  const send = async (file: File | undefined) => {
    if (!file) return;
    const problem = clientFileError(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setProgress(0);
    try {
      const uploaded = await uploadWithProgress(applicationId, documentType, file, setProgress);
      onUploaded(uploaded);
    } catch (err) {
      setError(err instanceof BrowserGatewayError ? err.message : 'Upload failed');
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="rounded-md border border-dashed p-4">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
        {required ? <span className="text-destructive"> (required)</span> : null}
      </label>
      <p className="mt-1 text-xs text-muted-foreground" id={`${inputId}-hint`}>
        PDF, JPEG, or PNG. 10 MB maximum.
      </p>
      {existing ? (
        <p className="mt-2 text-sm">
          <span className="font-medium">{existing.originalFilename}</span>
          <span className="ml-2 text-muted-foreground">{existing.verificationStatus}</span>
          <button
            type="button"
            className="ml-3 text-xs text-destructive underline"
            onClick={() => {
              void browserGatewayFetch(
                `/scholarships/applications/${applicationId}/documents/${existing.id}`,
                {
                  method: 'DELETE',
                },
              )
                .then(() => onRemoved(existing.id))
                .catch((err: unknown) => {
                  setError(
                    err instanceof BrowserGatewayError ? err.message : 'Could not remove the file',
                  );
                });
            }}
          >
            Remove
          </button>
        </p>
      ) : null}
      <div
        className="mt-3 flex flex-wrap items-center gap-2"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          void send(event.dataTransfer.files[0]);
        }}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={SCHOLARSHIP_DOCUMENT_ACCEPT}
          className="sr-only"
          aria-describedby={`${inputId}-hint`}
          onChange={(event) => {
            void send(event.target.files?.[0]);
          }}
        />
        <button
          type="button"
          className="rounded-md border px-3 py-1.5 text-sm"
          onClick={() => inputRef.current?.click()}
        >
          {existing ? `Replace ${label}` : `Upload ${label}`}
        </button>
        <span className="text-xs text-muted-foreground">or drop a file here</span>
      </div>
      {progress != null ? (
        <div
          className="mt-2"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={`Uploading ${label}`}
        >
          <div className="h-1.5 rounded-full bg-muted">
            <div className="h-1.5 rounded-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{progress}%</p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function DocumentUploadSlots({
  applicationId,
  types,
  requiredTypes,
  documents,
  onUploaded,
  onRemoved,
}: DocumentUploadSlotsProps) {
  const slots = types.includes('other') ? types : [...types, 'other'];
  return (
    <div className="space-y-3">
      {slots.map((type) => (
        <Slot
          key={type}
          applicationId={applicationId}
          documentType={type}
          required={requiredTypes.includes(type)}
          existing={documents.find((doc) => doc.documentType === type)}
          onUploaded={onUploaded}
          onRemoved={onRemoved}
        />
      ))}
    </div>
  );
}
