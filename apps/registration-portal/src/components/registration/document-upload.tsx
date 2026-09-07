'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useTranslations } from 'next-intl';
import { Upload, FileCheck2, X } from 'lucide-react';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_FILE_TYPES,
  DEFAULT_MAX_FILE_SIZE,
  validateFile,
} from '@/lib/validation';
import type { DocumentUploadMetadata } from '@/lib/api';
import { useRegistration } from './registration-context';

interface DocumentUploadProps {
  documentType: string;
  label: string;
  required: boolean;
}

/**
 * Single-document drag-and-drop upload widget.
 *
 * Validates file type and size in the browser (matching the backend's
 * ALLOWED_FILE_TYPES + MAX_FILE_SIZE_BYTES) and stores **metadata** in the
 * registration draft. File bytes stay in memory until submit (never
 * sessionStorage). The backend enforces the same rules on submission.
 */
export function DocumentUpload({ documentType, label, required }: DocumentUploadProps) {
  const t = useTranslations('documents');
  const { draft, addDocument, removeDocument } = useRegistration();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = draft.documents.find((d) => d.documentType === documentType);
  const maxSizeMB = Math.round(DEFAULT_MAX_FILE_SIZE / (1024 * 1024));

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;
      setError(null);

      const validation = validateFile(file);
      if (!validation.valid) {
        if (validation.error === 'file_too_large') {
          setError(t('fileTooLarge', { size: String(validation.maxSizeMB) }));
        } else if (validation.error === 'invalid_type') {
          setError(t('invalidType', { types: validation.allowedTypes ?? '' }));
        }
        return;
      }

      setUploading(true);
      try {
        const meta: DocumentUploadMetadata = {
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          documentType,
        };
        // Keep File in memory; metadata-only in draft / sessionStorage.
        addDocument(meta, file);
      } catch {
        setError(t('uploadError'));
      } finally {
        setUploading(false);
      }
    },
    [documentType, addDocument, t],
  );

  const accept = Array.from(ALLOWED_FILE_TYPES).reduce<Record<string, string[]>>((acc, mime) => {
    acc[mime] = [];
    return acc;
  }, {});

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept,
    disabled: uploading,
  });

  return (
    <div>
      <label className="input-label">
        {label}
        {required && (
          <span className="text-red-500" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>

      {existing ? (
        <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 p-4">
          <div className="flex items-center gap-3">
            <FileCheck2 className="h-5 w-5 text-green-600" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-gray-900">{existing.fileName}</p>
              <p className="text-xs text-gray-500">{(existing.fileSize / 1024).toFixed(1)} KB</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => removeDocument(documentType)}
            className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:text-red-700"
            aria-label={`${t('remove')} ${label}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span>{t('remove')}</span>
          </button>
        </div>
      ) : (
        <div
          {...getRootProps({
            // Avoid nested-interactive: the file input is the sole control;
            // do not also promote the wrapper to role=button.
            role: undefined,
            tabIndex: undefined,
          })}
          className={`dropzone ${isDragActive ? 'dropzone-active' : ''}`}
        >
          <input {...getInputProps()} aria-label={`Upload ${label}`} />
          {uploading ? (
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
              <span className="text-sm text-gray-600">{t('uploadSuccess')}…</span>
            </div>
          ) : (
            <>
              <Upload className="mb-2 h-8 w-8 text-gray-500" aria-hidden="true" />
              <p className="text-sm text-gray-700">{t('dragDrop')}</p>
              <p className="mt-1 text-xs text-gray-600">
                {t('maxSize', { size: String(maxSizeMB) })} ·{' '}
                {t('allowedTypes', { types: ALLOWED_EXTENSIONS })}
              </p>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="input-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
