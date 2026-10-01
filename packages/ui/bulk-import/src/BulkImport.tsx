'use client';

import React, { useState, useCallback, useMemo } from 'react';

import type {
  BulkImportProps,
  ImportStep,
  ImportValidationResult,
  ImportColumnMapping,
  ImportResult,
  ImportRowError,
  BulkImportLabels,
} from './types';

/** English defaults for every BulkImport string (PRC-L195). */
export const DEFAULT_BULK_IMPORT_LABELS: BulkImportLabels = {
  stepUpload: 'Upload',
  stepMapping: 'Map Columns',
  stepPreview: 'Preview',
  stepImport: 'Import',
  stepComplete: 'Complete',
  stepsNav: 'Import progress',
  chooseFile: 'Choose a file or drag it here',
  acceptedHint: (types, maxSize) => `Accepted: ${types} (max ${maxSize})`,
  fileHelp: 'Upload an Excel or CSV file containing data to import',
  downloadTemplate: 'Download Template',
  downloadTemplateAria: 'Download import template file',
  mappingTitle: 'Map Columns to Fields',
  mappingInfo: 'Match the columns from your file to the corresponding system fields.',
  mappingTable: 'Column mapping',
  sourceColumn: 'Source Column',
  targetField: 'Target Field',
  status: 'Status',
  skip: '-- Skip --',
  mapColumn: (column) => `Map ${column} to target field`,
  alreadyMapped: '(already mapped)',
  required: 'Required',
  duplicate: 'Duplicate',
  mapped: 'Mapped',
  back: 'Back',
  continueToPreview: 'Continue to Preview',
  previewTitle: 'Validation Preview',
  totalRows: 'Total Rows',
  validRows: 'Valid',
  errorRows: 'Errors',
  warningRows: 'Warnings',
  validationErrorsTitle: (count) => `Validation Errors (${count})`,
  validationErrorsRegion: 'Validation errors',
  validationErrorsTable: 'Import validation errors',
  columnRow: 'Row',
  columnField: 'Field',
  columnValue: 'Value',
  columnError: 'Error',
  columnSeverity: 'Severity',
  showingFirstErrors: (shown, total) => `Showing first ${shown} of ${total} errors`,
  downloadAllErrors: (count) => `Download all ${count} errors (CSV)`,
  dataPreviewTitle: (count) => `Data Preview (first ${count} rows)`,
  dataPreviewRegion: 'Data preview',
  dataPreviewTable: 'Preview of import data',
  rowHasErrors: 'Has errors',
  rowValid: 'Valid',
  importValidRows: (count) => `Import ${count} Valid Rows`,
  importing: 'Importing data... Please wait.',
  completeTitle: 'Import Complete',
  successfullyImported: 'Successfully Imported',
  failed: 'Failed',
  downloadFailedRows: (count) => `Download ${count} failed row errors (CSV)`,
  importAnother: 'Import Another File',
  done: 'Done',
  cancelImport: 'Cancel Import',
  validatingFile: 'Validating file...',
  fileTooLarge: (size, max) => `File size (${size}) exceeds maximum (${max})`,
  fileTypeNotAccepted: (ext, allowed) => `File type "${ext}" is not accepted. Allowed: ${allowed}`,
  validateFailed: 'Failed to validate file',
  importFailed: 'Import failed',
  duplicateMapping: (fields) =>
    `Each field can only be mapped once. Mapped more than once: ${fields}`,
  requiredNotMapped: (fields) => `Required fields not mapped: ${fields}`,
};

/** Visible error rows in the preview; the full list is always downloadable. */
const ERROR_PREVIEW_LIMIT = 50;

/** Neutralise spreadsheet formula injection and quote a CSV cell. */
function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Serialise import row errors as CSV (header + one line per error). */
export function importErrorsToCsv(errors: ImportRowError[]): string {
  const header = ['Row', 'Field', 'Value', 'Error', 'Severity'];
  const lines = errors.map((e) =>
    [e.row, e.field, e.value ?? '', e.message, e.severity].map(csvCell).join(','),
  );
  return [header.map(csvCell).join(','), ...lines].join('\r\n');
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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
  onDownloadErrors,
  onCancel,
  loading = false,
  className = '',
  labels: labelOverrides,
}: BulkImportProps) {
  const t = useMemo(() => ({ ...DEFAULT_BULK_IMPORT_LABELS, ...labelOverrides }), [labelOverrides]);
  const [step, setStep] = useState<ImportStep>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<ImportValidationResult | null>(null);
  const [columnMappings, setColumnMappings] = useState<ImportColumnMapping[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
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
        setError(t.fileTooLarge(formatFileSize(file.size), formatFileSize(maxFileSize)));
        return;
      }

      // Validate file type
      const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
      if (!acceptedFileTypes.some((t) => t.toLowerCase() === ext)) {
        setError(t.fileTypeNotAccepted(ext, acceptedFileTypes.join(', ')));
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
        setError(err instanceof Error ? err.message : t.validateFailed);
      } finally {
        setIsProcessing(false);
      }
    },
    [maxFileSize, acceptedFileTypes, onFileValidate, t],
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

    // A target field may only receive one source column; duplicates would make
    // the import ambiguous (last-write-wins on the server).
    const duplicateTargets = [
      ...new Set(mappedTargets.filter((t, i) => mappedTargets.indexOf(t) !== i)),
    ];
    if (duplicateTargets.length > 0) {
      const labels = duplicateTargets.map(
        (name) => targetFields.find((f) => f.name === name)?.label ?? name,
      );
      setError(t.duplicateMapping(labels.join(', ')));
      return;
    }

    if (missingRequired.length > 0) {
      setError(t.requiredNotMapped(missingRequired.map((f) => f.label).join(', ')));
      return;
    }

    setError(null);
    setStep('preview');
  }, [columnMappings, targetFields, t]);

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
      setError(err instanceof Error ? err.message : t.importFailed);
      setStep('preview');
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, columnMappings, onImportConfirm, t]);

  const handleDownloadErrors = useCallback(
    (errors: ImportRowError[], source: 'validation' | 'import') => {
      if (onDownloadErrors) {
        onDownloadErrors(errors, source);
        return;
      }
      downloadCsv(
        source === 'import' ? 'import-failed-rows.csv' : 'import-validation-errors.csv',
        importErrorsToCsv(errors),
      );
    },
    [onDownloadErrors],
  );

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
      { key: 'upload', label: t.stepUpload },
      { key: 'mapping', label: t.stepMapping },
      { key: 'preview', label: t.stepPreview },
      { key: 'importing', label: t.stepImport },
      { key: 'complete', label: t.stepComplete },
    ];

    const currentIndex = steps.findIndex((s) => s.key === step);

    return (
      <nav className="proctira-bulk-import__steps" aria-label={t.stepsNav}>
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
          <span>{t.chooseFile}</span>
          <span className="proctira-bulk-import__upload-hint">
            {t.acceptedHint(acceptedFileTypes.join(', '), formatFileSize(maxFileSize))}
          </span>
        </label>
        <input
          id="bulk-import-file"
          type="file"
          accept={acceptedFileTypes.join(',')}
          onChange={(e) => void handleFileSelect(e)}
          disabled={loading || isProcessing}
          className="proctira-bulk-import__file-input"
          aria-describedby="bulk-import-file-help"
        />
        <p id="bulk-import-file-help" className="sr-only">
          {t.fileHelp}
        </p>
      </div>

      {onDownloadTemplate && (
        <button
          type="button"
          onClick={onDownloadTemplate}
          className="proctira-bulk-import__template-btn"
          aria-label={t.downloadTemplateAria}
        >
          {t.downloadTemplate}
        </button>
      )}
    </div>
  );

  const renderMappingStep = () => {
    const targetUseCount = new Map<string, number>();
    for (const m of columnMappings) {
      if (m.valid && m.targetField) {
        targetUseCount.set(m.targetField, (targetUseCount.get(m.targetField) ?? 0) + 1);
      }
    }
    return (
      <div className="proctira-bulk-import__mapping">
        <h3 className="proctira-bulk-import__subtitle">{t.mappingTitle}</h3>
        <p className="proctira-bulk-import__mapping-info">{t.mappingInfo}</p>

        <table className="proctira-bulk-import__mapping-table" aria-label={t.mappingTable}>
          <thead>
            <tr>
              <th scope="col">{t.sourceColumn}</th>
              <th scope="col">{t.targetField}</th>
              <th scope="col">{t.status}</th>
            </tr>
          </thead>
          <tbody>
            {columnMappings.map((mapping) => (
              <tr key={mapping.sourceColumn}>
                <td>{mapping.sourceColumn}</td>
                <td>
                  <label htmlFor={`mapping-${mapping.sourceColumn}`} className="sr-only">
                    {t.mapColumn(mapping.sourceColumn)}
                  </label>
                  <select
                    id={`mapping-${mapping.sourceColumn}`}
                    value={mapping.targetField}
                    onChange={(e) => handleMappingChange(mapping.sourceColumn, e.target.value)}
                    className="proctira-bulk-import__mapping-select"
                    aria-label={t.mapColumn(mapping.sourceColumn)}
                  >
                    <option value="">{t.skip}</option>
                    {targetFields.map((field) => {
                      // Disable fields already used by another column (keep this row's own choice selectable)
                      const usedElsewhere =
                        field.name !== mapping.targetField &&
                        (targetUseCount.get(field.name) ?? 0) > 0;
                      return (
                        <option key={field.name} value={field.name} disabled={usedElsewhere}>
                          {field.label} {field.required ? '*' : ''}
                          {usedElsewhere ? ` ${t.alreadyMapped}` : ''}
                        </option>
                      );
                    })}
                  </select>
                </td>
                <td>
                  {mapping.required && !mapping.valid && (
                    <span className="proctira-bulk-import__status--error" role="alert">
                      {t.required}
                    </span>
                  )}
                  {mapping.valid && (targetUseCount.get(mapping.targetField) ?? 0) > 1 ? (
                    <span className="proctira-bulk-import__status--error">{t.duplicate}</span>
                  ) : (
                    mapping.valid && (
                      <span className="proctira-bulk-import__status--ok" aria-label={t.mapped}>
                        ✓
                      </span>
                    )
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
            {t.back}
          </button>
          <button
            type="button"
            onClick={handleConfirmMapping}
            className="proctira-bulk-import__next-btn"
          >
            {t.continueToPreview}
          </button>
        </div>
      </div>
    );
  };

  const renderPreviewStep = () => (
    <div className="proctira-bulk-import__preview">
      <h3 className="proctira-bulk-import__subtitle">{t.previewTitle}</h3>

      {validationResult && (
        <div className="proctira-bulk-import__summary" role="status" aria-live="polite">
          <dl className="proctira-bulk-import__stats">
            <div className="proctira-bulk-import__stat">
              <dt>{t.totalRows}</dt>
              <dd>{validationResult.totalRows}</dd>
            </div>
            <div className="proctira-bulk-import__stat proctira-bulk-import__stat--success">
              <dt>{t.validRows}</dt>
              <dd>{validationResult.validRows}</dd>
            </div>
            <div className="proctira-bulk-import__stat proctira-bulk-import__stat--error">
              <dt>{t.errorRows}</dt>
              <dd>{validationResult.errorRows}</dd>
            </div>
            <div className="proctira-bulk-import__stat proctira-bulk-import__stat--warning">
              <dt>{t.warningRows}</dt>
              <dd>{validationResult.warningRows}</dd>
            </div>
          </dl>
        </div>
      )}

      {/* Error list */}
      {validationResult && validationResult.errors.length > 0 && (
        <div className="proctira-bulk-import__errors">
          <h4 className="proctira-bulk-import__errors-title">
            {t.validationErrorsTitle(validationResult.errors.length)}
          </h4>
          <div
            className="proctira-bulk-import__errors-table-container"
            role="region"
            aria-label={t.validationErrorsRegion}
          >
            <table
              className="proctira-bulk-import__errors-table"
              aria-label={t.validationErrorsTable}
            >
              <thead>
                <tr>
                  <th scope="col">{t.columnRow}</th>
                  <th scope="col">{t.columnField}</th>
                  <th scope="col">{t.columnValue}</th>
                  <th scope="col">{t.columnError}</th>
                  <th scope="col">{t.columnSeverity}</th>
                </tr>
              </thead>
              <tbody>
                {validationResult.errors.slice(0, ERROR_PREVIEW_LIMIT).map((err, index) => (
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
            {validationResult.errors.length > ERROR_PREVIEW_LIMIT && (
              <p className="proctira-bulk-import__errors-more">
                {t.showingFirstErrors(ERROR_PREVIEW_LIMIT, validationResult.errors.length)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => handleDownloadErrors(validationResult.errors, 'validation')}
            className="proctira-bulk-import__download-errors-btn"
          >
            {t.downloadAllErrors(validationResult.errors.length)}
          </button>
        </div>
      )}

      {/* Data preview */}
      {validationResult && validationResult.preview.length > 0 && (
        <div className="proctira-bulk-import__data-preview">
          <h4>{t.dataPreviewTitle(validationResult.preview.length)}</h4>
          <div
            className="proctira-bulk-import__preview-table-container"
            role="region"
            aria-label={t.dataPreviewRegion}
          >
            <table className="proctira-bulk-import__preview-table" aria-label={t.dataPreviewTable}>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  {Object.keys(validationResult.preview[0]?.data ?? {}).map((key) => (
                    <th key={key} scope="col">
                      {key}
                    </th>
                  ))}
                  <th scope="col">{t.status}</th>
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
                          aria-label={t.rowHasErrors}
                        >
                          ✕
                        </span>
                      ) : (
                        <span
                          className="proctira-bulk-import__row-status--ok"
                          aria-label={t.rowValid}
                        >
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
          {t.back}
        </button>
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={validationResult?.validRows === 0}
          className="proctira-bulk-import__import-btn"
        >
          {t.importValidRows(validationResult?.validRows ?? 0)}
        </button>
      </div>
    </div>
  );

  const renderImportingStep = () => (
    <div className="proctira-bulk-import__importing" aria-live="polite">
      <div className="proctira-bulk-import__spinner" aria-hidden="true">
        ⟳
      </div>
      <p>{t.importing}</p>
    </div>
  );

  const renderCompleteStep = () => (
    <div className="proctira-bulk-import__complete" aria-live="polite">
      <div className="proctira-bulk-import__complete-icon" aria-hidden="true">
        ✓
      </div>
      <h3>{t.completeTitle}</h3>
      {importResult && (
        <dl className="proctira-bulk-import__result-stats">
          <div className="proctira-bulk-import__stat proctira-bulk-import__stat--success">
            <dt>{t.successfullyImported}</dt>
            <dd>{importResult.success}</dd>
          </div>
          <div className="proctira-bulk-import__stat proctira-bulk-import__stat--error">
            <dt>{t.failed}</dt>
            <dd>{importResult.failed}</dd>
          </div>
        </dl>
      )}
      {importResult?.errors && importResult.errors.length > 0 && (
        <button
          type="button"
          onClick={() => handleDownloadErrors(importResult.errors ?? [], 'import')}
          className="proctira-bulk-import__download-errors-btn"
        >
          {t.downloadFailedRows(importResult.errors.length)}
        </button>
      )}
      <div className="proctira-bulk-import__actions">
        <button type="button" onClick={handleReset} className="proctira-bulk-import__reset-btn">
          {t.importAnother}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="proctira-bulk-import__done-btn">
            {t.done}
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
          {t.validatingFile}
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
            {t.cancelImport}
          </button>
        </div>
      )}
    </div>
  );
}
