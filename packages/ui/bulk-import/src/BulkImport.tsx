'use client';

import React, { useState, useCallback } from 'react';
import type {
  BulkImportProps,
  ImportStep,
  ImportValidationResult,
  ImportColumnMapping,
} from './types';

/**
 * BulkImport component with validation preview and error display.
 * Supports multi-step workflow: Upload → Mapping → Preview → Import → Complete.
 * Meets WCAG 2.1 Level AA accessibility standards.
 *
 * @example
 * ```tsx
 * <BulkImport
 *   title="Import Students"
 *   targetFields={[
 *     { name: 'firstName', label: 'First Name', required: true },
 *     { name: 'lastName', label: 'Last Name', required: true },
 *   ]}
 *   onFileValidate={async (file) => validateStudentFile(file)}
 *   onImportConfirm={async (file, mappings) => importStudents(file, mappings)}
 * />
 * ```
 */
export function BulkImport({
  title,
  description,
  acceptedFileTypes = ['.xlsx', '.xls', '.csv'],
  maxFileSize = 50 * 1024 * 1024, // 50MB default
  targetFields,
  onFileValidate,
  onImportConfirm,
  onDownloadTemplate,
  onCancel,
  loading = false,
  className = '',
}: BulkImportProps) {
  const [step, setStep] = useState<ImportStep>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<ImportValidationResult | null>(null);
  const [columnMappings, setColumnMappings] = useState<ImportColumnMapping[]>([]);
  const [importResult, setImportResult] = useState<{ success: number; failed: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setError(null);

      // Validate file size
      if (file.size > maxFileSize) {
        setError(
          `File size (${formatFileSize(file.size)}) exceeds maximum (${formatFileSize(maxFileSize)})`,
        );
        return;
      }

      // Validate file type
      const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;
      if (!acceptedFileTypes.some((t) => t.toLowerCase() === ext)) {
        setError(`File type "${ext}" is not accepted. Allowed: ${acceptedFileTypes.join(', ')}`);
        return;
      }

      setSelectedFile(file);
      setIsProcessing(true);

      try {
        const result = await onFileValidate(file);
        setValidationResult(result);
        setColumnMappings(result.columnMappings);
        setStep('mapping');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to validate file');
      } finally {
        setIsProcessing(false);
      }
    },
    [maxFileSize, acceptedFileTypes, onFileValidate],
  );

  const handleMappingChange = useCallback((sourceColumn: string, targetField: string) => {
    setColumnMappings((prev) =>
      prev.map((m) =>
        m.sourceColumn === sourceColumn ? { ...m, targetField, valid: targetField !== '' } : m,
      ),
    );
  }, []);

  const handleConfirmMapping = useCallback(() => {
    // Check all required fields are mapped
    const requiredFields = targetFields.filter((f) => f.required);
    const mappedTargets = columnMappings.filter((m) => m.valid).map((m) => m.targetField);
    const missingRequired = requiredFields.filter((f) => !mappedTargets.includes(f.name));

    if (missingRequired.length > 0) {
      setError(`Required fields not mapped: ${missingRequired.map((f) => f.label).join(', ')}`);
      return;
    }

    setError(null);
    setStep('preview');
  }, [columnMappings, targetFields]);

  const handleImport = useCallback(async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setStep('importing');
    setError(null);

    try {
      const result = await onImportConfirm(selectedFile, columnMappings);
      setImportResult(result);
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setStep('preview');
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, columnMappings, onImportConfirm]);

  const handleReset = useCallback(() => {
    setStep('upload');
    setSelectedFile(null);
    setValidationResult(null);
    setColumnMappings([]);
    setImportResult(null);
    setError(null);
  }, []);

  const renderStepIndicator = () => {
    const steps: { key: ImportStep; label: string }[] = [
      { key: 'upload', label: 'Upload' },
      { key: 'mapping', label: 'Map Columns' },
      { key: 'preview', label: 'Preview' },
      { key: 'importing', label: 'Import' },
      { key: 'complete', label: 'Complete' },
    ];

    const currentIndex = steps.findIndex((s) => s.key === step);

    return (
      <nav className="proctira-bulk-import__steps" aria-label="Import progress">
        <ol className="proctira-bulk-import__step-list">
          {steps.map((s, index) => (
            <li
              key={s.key}
              className={`proctira-bulk-import__step ${index === currentIndex ? 'proctira-bulk-import__step--active' : ''} ${index < currentIndex ? 'proctira-bulk-import__step--complete' : ''}`}
              aria-current={index === currentIndex ? 'step' : undefined}
            >
              <span className="proctira-bulk-import__step-number" aria-hidden="true">
                {index < currentIndex ? '✓' : index + 1}
              </span>
              <span className="proctira-bulk-import__step-label">{s.label}</span>
            </li>
          ))}
        </ol>
      </nav>
    );
  };

  const renderUploadStep = () => (
    <div className="proctira-bulk-import__upload">
      {description && <p className="proctira-bulk-import__description">{description}</p>}

      <div className="proctira-bulk-import__upload-area">
        <label htmlFor="bulk-import-file" className="proctira-bulk-import__upload-label">
          <span className="proctira-bulk-import__upload-icon" aria-hidden="true">
            📄
          </span>
          <span>Choose a file or drag it here</span>
          <span className="proctira-bulk-import__upload-hint">
            Accepted: {acceptedFileTypes.join(', ')} (max {formatFileSize(maxFileSize)})
          </span>
        </label>
        <input
          id="bulk-import-file"
          type="file"
          accept={acceptedFileTypes.join(',')}
          onChange={handleFileSelect}
          disabled={loading || isProcessing}
          className="proctira-bulk-import__file-input"
          aria-describedby="bulk-import-file-help"
        />
        <p id="bulk-import-file-help" className="sr-only">
          Upload an Excel or CSV file containing data to import
        </p>
      </div>

      {onDownloadTemplate && (
        <button
          type="button"
          onClick={onDownloadTemplate}
          className="proctira-bulk-import__template-btn"
          aria-label="Download import template file"
        >
          Download Template
        </button>
      )}
    </div>
  );

  const renderMappingStep = () => (
    <div className="proctira-bulk-import__mapping">
      <h3 className="proctira-bulk-import__subtitle">Map Columns to Fields</h3>
      <p className="proctira-bulk-import__mapping-info">
        Match the columns from your file to the corresponding system fields.
      </p>

      <table className="proctira-bulk-import__mapping-table" aria-label="Column mapping">
        <thead>
          <tr>
            <th scope="col">Source Column</th>
            <th scope="col">Target Field</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {columnMappings.map((mapping) => (
            <tr key={mapping.sourceColumn}>
              <td>{mapping.sourceColumn}</td>
              <td>
                <label htmlFor={`mapping-${mapping.sourceColumn}`} className="sr-only">
                  Map {mapping.sourceColumn} to field
                </label>
                <select
                  id={`mapping-${mapping.sourceColumn}`}
                  value={mapping.targetField}
                  onChange={(e) => handleMappingChange(mapping.sourceColumn, e.target.value)}
                  className="proctira-bulk-import__mapping-select"
                  aria-label={`Map ${mapping.sourceColumn} to target field`}
                >
                  <option value="">-- Skip --</option>
                  {targetFields.map((field) => (
                    <option key={field.name} value={field.name}>
                      {field.label} {field.required ? '*' : ''}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {mapping.required && !mapping.valid && (
                  <span className="proctira-bulk-import__status--error" role="alert">
                    Required
                  </span>
                )}
                {mapping.valid && (
                  <span className="proctira-bulk-import__status--ok" aria-label="Mapped">
                    ✓
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="proctira-bulk-import__actions">
        <button
          type="button"
          onClick={() => setStep('upload')}
          className="proctira-bulk-import__back-btn"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleConfirmMapping}
          className="proctira-bulk-import__next-btn"
        >
          Continue to Preview
        </button>
      </div>
    </div>
  );

  const renderPreviewStep = () => (
    <div className="proctira-bulk-import__preview">
      <h3 className="proctira-bulk-import__subtitle">Validation Preview</h3>

      {validationResult && (
        <div className="proctira-bulk-import__summary" role="status" aria-live="polite">
          <dl className="proctira-bulk-import__stats">
            <div className="proctira-bulk-import__stat">
              <dt>Total Rows</dt>
              <dd>{validationResult.totalRows}</dd>
            </div>
            <div className="proctira-bulk-import__stat proctira-bulk-import__stat--success">
              <dt>Valid</dt>
              <dd>{validationResult.validRows}</dd>
            </div>
            <div className="proctira-bulk-import__stat proctira-bulk-import__stat--error">
              <dt>Errors</dt>
              <dd>{validationResult.errorRows}</dd>
            </div>
            <div className="proctira-bulk-import__stat proctira-bulk-import__stat--warning">
              <dt>Warnings</dt>
              <dd>{validationResult.warningRows}</dd>
            </div>
          </dl>
        </div>
      )}

      {/* Error list */}
      {validationResult && validationResult.errors.length > 0 && (
        <div className="proctira-bulk-import__errors">
          <h4 className="proctira-bulk-import__errors-title">
            Validation Errors ({validationResult.errors.length})
          </h4>
          <div
            className="proctira-bulk-import__errors-table-container"
            role="region"
            aria-label="Validation errors"
          >
            <table
              className="proctira-bulk-import__errors-table"
              aria-label="Import validation errors"
            >
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Field</th>
                  <th scope="col">Value</th>
                  <th scope="col">Error</th>
                  <th scope="col">Severity</th>
                </tr>
              </thead>
              <tbody>
                {validationResult.errors.slice(0, 50).map((err, index) => (
                  <tr key={index} className={`proctira-bulk-import__error-row--${err.severity}`}>
                    <td>{err.row}</td>
                    <td>{err.field}</td>
                    <td>{err.value ?? '-'}</td>
                    <td>{err.message}</td>
                    <td>
                      <span className={`proctira-bulk-import__severity--${err.severity}`}>
                        {err.severity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {validationResult.errors.length > 50 && (
              <p className="proctira-bulk-import__errors-more">
                Showing first 50 of {validationResult.errors.length} errors
              </p>
            )}
          </div>
        </div>
      )}

      {/* Data preview */}
      {validationResult && validationResult.preview.length > 0 && (
        <div className="proctira-bulk-import__data-preview">
          <h4>Data Preview (first {validationResult.preview.length} rows)</h4>
          <div
            className="proctira-bulk-import__preview-table-container"
            role="region"
            aria-label="Data preview"
          >
            <table
              className="proctira-bulk-import__preview-table"
              aria-label="Preview of import data"
            >
              <thead>
                <tr>
                  <th scope="col">#</th>
                  {Object.keys(validationResult.preview[0]?.data ?? {}).map((key) => (
                    <th key={key} scope="col">
                      {key}
                    </th>
                  ))}
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {validationResult.preview.map((row) => (
                  <tr
                    key={row.rowNumber}
                    className={row.hasErrors ? 'proctira-bulk-import__row--error' : ''}
                  >
                    <td>{row.rowNumber}</td>
                    {Object.values(row.data).map((value, i) => (
                      <td key={i}>{String(value ?? '')}</td>
                    ))}
                    <td>
                      {row.hasErrors ? (
                        <span
                          className="proctira-bulk-import__row-status--error"
                          aria-label="Has errors"
                        >
                          ✕
                        </span>
                      ) : (
                        <span className="proctira-bulk-import__row-status--ok" aria-label="Valid">
                          ✓
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="proctira-bulk-import__actions">
        <button
          type="button"
          onClick={() => setStep('mapping')}
          className="proctira-bulk-import__back-btn"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleImport}
          disabled={validationResult?.validRows === 0}
          className="proctira-bulk-import__import-btn"
          aria-label={`Import ${validationResult?.validRows ?? 0} valid rows`}
        >
          Import {validationResult?.validRows ?? 0} Valid Rows
        </button>
      </div>
    </div>
  );

  const renderImportingStep = () => (
    <div className="proctira-bulk-import__importing" aria-live="polite">
      <div className="proctira-bulk-import__spinner" aria-hidden="true">
        ⟳
      </div>
      <p>Importing data... Please wait.</p>
    </div>
  );

  const renderCompleteStep = () => (
    <div className="proctira-bulk-import__complete" aria-live="polite">
      <div className="proctira-bulk-import__complete-icon" aria-hidden="true">
        ✓
      </div>
      <h3>Import Complete</h3>
      {importResult && (
        <dl className="proctira-bulk-import__result-stats">
          <div className="proctira-bulk-import__stat proctira-bulk-import__stat--success">
            <dt>Successfully Imported</dt>
            <dd>{importResult.success}</dd>
          </div>
          <div className="proctira-bulk-import__stat proctira-bulk-import__stat--error">
            <dt>Failed</dt>
            <dd>{importResult.failed}</dd>
          </div>
        </dl>
      )}
      <div className="proctira-bulk-import__actions">
        <button type="button" onClick={handleReset} className="proctira-bulk-import__reset-btn">
          Import Another File
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="proctira-bulk-import__done-btn">
            Done
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className={`proctira-bulk-import ${className}`} aria-label={title}>
      <h2 className="proctira-bulk-import__title">{title}</h2>

      {renderStepIndicator()}

      {/* Error display */}
      {error && (
        <div className="proctira-bulk-import__error" role="alert" aria-live="assertive">
          <span className="proctira-bulk-import__error-icon" aria-hidden="true">
            ⚠️
          </span>
          {error}
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && step === 'upload' && (
        <div className="proctira-bulk-import__processing" aria-live="polite">
          Validating file...
        </div>
      )}

      {/* Step content */}
      <div className="proctira-bulk-import__content">
        {step === 'upload' && renderUploadStep()}
        {step === 'mapping' && renderMappingStep()}
        {step === 'preview' && renderPreviewStep()}
        {step === 'importing' && renderImportingStep()}
        {step === 'complete' && renderCompleteStep()}
      </div>

      {/* Cancel button (available on most steps) */}
      {onCancel && step !== 'complete' && step !== 'importing' && (
        <div className="proctira-bulk-import__cancel">
          <button type="button" onClick={onCancel} className="proctira-bulk-import__cancel-btn">
            Cancel Import
          </button>
        </div>
      )}
    </div>
  );
}
