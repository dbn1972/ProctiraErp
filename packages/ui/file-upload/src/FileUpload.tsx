'use client';

import React, { useState, useCallback, useRef } from 'react';
import type { FileUploadProps, FileValidationError } from './types';

/**
 * FileUpload component with drag-and-drop, file type and size validation.
 * Meets WCAG 2.1 Level AA accessibility standards.
 *
 * @example
 * ```tsx
 * <FileUpload
 *   accept={['.pdf', '.xlsx', 'image/*']}
 *   maxSize={50 * 1024 * 1024}
 *   maxFiles={5}
 *   multiple
 *   onFilesSelected={(files) => handleUpload(files)}
 *   ariaLabel="Upload student documents"
 * />
 * ```
 */
export function FileUpload({
  accept,
  maxSize,
  maxFiles = 10,
  multiple = false,
  onFilesSelected,
  onValidationError,
  onFileRemove,
  files = [],
  disabled = false,
  dropZoneLabel,
  ariaLabel,
  className = '',
}: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const validateFiles = useCallback(
    (fileList: File[]): { valid: File[]; errors: FileValidationError[] } => {
      const valid: File[] = [];
      const errors: FileValidationError[] = [];

      const currentCount = files.length;
      let addedCount = 0;

      for (const file of fileList) {
        // Check max files
        if (currentCount + addedCount >= maxFiles) {
          errors.push({
            file,
            error: 'count',
            message: `Maximum ${maxFiles} files allowed`,
          });
          continue;
        }

        // Check file type
        if (accept && accept.length > 0) {
          const isAccepted = accept.some((type) => {
            if (type.startsWith('.')) {
              return file.name.toLowerCase().endsWith(type.toLowerCase());
            }
            if (type.endsWith('/*')) {
              const category = type.split('/')[0];
              return file.type.startsWith(`${category}/`);
            }
            return file.type === type;
          });

          if (!isAccepted) {
            errors.push({
              file,
              error: 'type',
              message: `File type "${file.type || 'unknown'}" is not accepted. Allowed: ${accept.join(', ')}`,
            });
            continue;
          }
        }

        // Check file size
        if (maxSize && file.size > maxSize) {
          errors.push({
            file,
            error: 'size',
            message: `File size (${formatFileSize(file.size)}) exceeds maximum (${formatFileSize(maxSize)})`,
          });
          continue;
        }

        valid.push(file);
        addedCount++;
      }

      return { valid, errors };
    },
    [accept, maxSize, maxFiles, files.length],
  );

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;

      const fileArray = Array.from(fileList);
      const { valid, errors } = validateFiles(fileArray);

      if (errors.length > 0) {
        onValidationError?.(errors);
      }

      if (valid.length > 0) {
        onFilesSelected(valid);
      }
    },
    [validateFiles, onFilesSelected, onValidationError],
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setIsDragOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setIsDragOver(true);
    },
    [disabled],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (disabled) return;
      handleFiles(e.dataTransfer.files);
    },
    [disabled, handleFiles],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Reset input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [handleFiles],
  );

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleBrowseClick();
      }
    },
    [handleBrowseClick],
  );

  const acceptString = accept?.join(',');

  return (
    <div className={`proctira-file-upload ${className}`} aria-label={ariaLabel}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptString}
        multiple={multiple}
        onChange={handleInputChange}
        disabled={disabled}
        className="proctira-file-upload__input"
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Drop zone */}
      <div
        ref={dropZoneRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={handleBrowseClick}
        onKeyDown={handleKeyDown}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`proctira-file-upload__dropzone ${isDragOver ? 'proctira-file-upload__dropzone--active' : ''} ${disabled ? 'proctira-file-upload__dropzone--disabled' : ''}`}
        aria-label={
          dropZoneLabel ??
          `Drop files here or click to browse. ${accept ? `Accepted types: ${accept.join(', ')}` : ''} ${maxSize ? `Maximum size: ${formatFileSize(maxSize)}` : ''}`
        }
        aria-disabled={disabled}
      >
        <div className="proctira-file-upload__icon" aria-hidden="true">
          📁
        </div>
        <p className="proctira-file-upload__text">
          {dropZoneLabel ?? 'Drag and drop files here, or click to browse'}
        </p>
        <p className="proctira-file-upload__constraints">
          {accept && <span>Accepted: {accept.join(', ')}</span>}
          {maxSize && <span> • Max size: {formatFileSize(maxSize)}</span>}
          {multiple && <span> • Max files: {maxFiles}</span>}
        </p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <ul className="proctira-file-upload__file-list" aria-label="Uploaded files">
          {files.map((uploadedFile) => (
            <li key={uploadedFile.id} className="proctira-file-upload__file-item">
              <div className="proctira-file-upload__file-info">
                <span className="proctira-file-upload__file-name">{uploadedFile.file.name}</span>
                <span className="proctira-file-upload__file-size">
                  {formatFileSize(uploadedFile.file.size)}
                </span>
              </div>
              <div className="proctira-file-upload__file-status">
                {uploadedFile.status === 'uploading' && (
                  <div
                    className="proctira-file-upload__progress"
                    role="progressbar"
                    aria-valuenow={uploadedFile.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Uploading ${uploadedFile.file.name}: ${uploadedFile.progress}%`}
                  >
                    <div
                      className="proctira-file-upload__progress-bar"
                      style={{ width: `${uploadedFile.progress}%` }}
                    />
                  </div>
                )}
                {uploadedFile.status === 'complete' && (
                  <span
                    className="proctira-file-upload__status--complete"
                    aria-label="Upload complete"
                  >
                    ✓
                  </span>
                )}
                {uploadedFile.status === 'error' && (
                  <span className="proctira-file-upload__status--error" role="alert">
                    {uploadedFile.errorMessage ?? 'Upload failed'}
                  </span>
                )}
              </div>
              {onFileRemove && (
                <button
                  type="button"
                  onClick={() => onFileRemove(uploadedFile.id)}
                  className="proctira-file-upload__remove-btn"
                  aria-label={`Remove ${uploadedFile.file.name}`}
                  disabled={disabled}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
