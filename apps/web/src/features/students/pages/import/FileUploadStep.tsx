/**
 * FileUploadStep — Step 1 of the import wizard.
 * Handles file selection with drag-and-drop, type validation, and size checks.
 *
 * _Requirements: 6.7 (Excel files up to 50MB)_
 */
'use client';

import React, { useCallback, useRef, useState } from 'react';

interface FileUploadStepProps {
  /** Accepted file extensions */
  acceptedTypes: string[];
  /** Maximum file size in bytes */
  maxFileSize: number;
  /** Whether a file is currently being processed */
  isProcessing: boolean;
  /** Callback when a valid file is selected */
  onFileSelect: (file: File) => void;
  /** Optional callback to download a template */
  onDownloadTemplate?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUploadStep({
  acceptedTypes,
  maxFileSize,
  isProcessing,
  onFileSelect,
  onDownloadTemplate,
}: FileUploadStepProps) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndSelect = useCallback(
    (file: File) => {
      setError(null);

      // Validate file size
      if (file.size > maxFileSize) {
        setError(
          `File size (${formatFileSize(file.size)}) exceeds the maximum allowed (${formatFileSize(maxFileSize)}).`,
        );
        return;
      }

      // Validate file type
      const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;
      if (!acceptedTypes.some((t) => t.toLowerCase() === ext)) {
        setError(
          `File type "${ext}" is not supported. Accepted formats: ${acceptedTypes.join(', ')}`,
        );
        return;
      }

      onFileSelect(file);
    },
    [maxFileSize, acceptedTypes, onFileSelect],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) validateAndSelect(file);
    },
    [validateAndSelect],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) validateAndSelect(file);
    },
    [validateAndSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Upload File</h3>
        <p className="text-sm text-muted-foreground">
          Select an Excel (.xlsx, .xls) or CSV file containing student records to import. Maximum
          file size: {formatFileSize(maxFileSize)}.
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors ${
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-muted-foreground/50'
        } ${isProcessing ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        role="button"
        tabIndex={0}
        aria-label="Upload file area. Click or drag a file here."
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <span className="mb-3 text-4xl" aria-hidden="true">
          📄
        </span>
        <p className="text-sm font-medium">
          {dragOver ? 'Drop file here' : 'Click to browse or drag a file here'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Accepted: {acceptedTypes.join(', ')} (max {formatFileSize(maxFileSize)})
        </p>
      </div>

      <input
        ref={inputRef}
        id="import-file-input"
        type="file"
        accept={acceptedTypes.join(',')}
        onChange={handleFileChange}
        disabled={isProcessing}
        className="sr-only"
        aria-describedby="import-file-help"
      />
      <p id="import-file-help" className="sr-only">
        Upload an Excel or CSV file containing student data to import
      </p>

      {/* Error display */}
      {error && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
          aria-live="assertive"
        >
          {error}
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
          Analyzing file...
        </div>
      )}

      {/* Template download */}
      {onDownloadTemplate && (
        <div className="pt-2">
          <button
            type="button"
            onClick={onDownloadTemplate}
            className="text-sm text-primary underline-offset-4 hover:underline"
            aria-label="Download import template file"
          >
            Download import template
          </button>
        </div>
      )}
    </div>
  );
}

export default FileUploadStep;
