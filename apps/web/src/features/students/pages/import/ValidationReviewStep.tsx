/**
 * ValidationReviewStep — Step 3 of the import wizard.
 * Shows row-level validation errors with severity indicators.
 * Supports downloading errors as Excel and retrying with corrections.
 *
 * _Requirements: 6.7, 19.2_
 */
'use client';

import { useMemo } from 'react';
import type { ValidationResult } from './types';

interface ValidationReviewStepProps {
  /** Validation result from the dry-run */
  validationResult: ValidationResult;
  /** Whether there are duplicates to resolve */
  hasDuplicates: boolean;
  /** Callback to download errors as Excel */
  onDownloadErrors: () => void;
  /** Callback to go back and re-upload */
  onRetry: () => void;
  /** Callback to proceed (to duplicates or confirmation) */
  onContinue: () => void;
  /** Callback to go back to mapping */
  onBack: () => void;
}

export function ValidationReviewStep({
  validationResult,
  hasDuplicates,
  onDownloadErrors,
  onRetry,
  onContinue,
  onBack,
}: ValidationReviewStepProps) {
  const { totalRows, validRows, errorRows, warningRows, errors, preview } = validationResult;

  const errorsByRow = useMemo(() => {
    const map = new Map<number, typeof errors>();
    for (const err of errors) {
      const existing = map.get(err.row) ?? [];
      existing.push(err);
      map.set(err.row, existing);
    }
    return map;
  }, [errors]);

  const criticalErrors = useMemo(() => errors.filter((e) => e.severity === 'error'), [errors]);

  const warnings = useMemo(() => errors.filter((e) => e.severity === 'warning'), [errors]);

  const canProceed = validRows > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Validation Review</h3>
        <p className="text-sm text-muted-foreground">
          Review the validation results below. Rows with errors will not be imported. You can
          download the error report, fix the file, and re-upload.
        </p>
      </div>

      {/* Summary stats */}
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        role="status"
        aria-live="polite"
        aria-label="Validation summary"
      >
        <div className="rounded-md border p-3 text-center">
          <p className="text-2xl font-semibold">{totalRows}</p>
          <p className="text-xs text-muted-foreground">Total Rows</p>
        </div>
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-center dark:border-green-900 dark:bg-green-950/30">
          <p className="text-2xl font-semibold text-green-700 dark:text-green-400">{validRows}</p>
          <p className="text-xs text-green-600 dark:text-green-500">Valid</p>
        </div>
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-center dark:border-red-900 dark:bg-red-950/30">
          <p className="text-2xl font-semibold text-red-700 dark:text-red-400">{errorRows}</p>
          <p className="text-xs text-red-600 dark:text-red-500">Errors</p>
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-center dark:border-amber-900 dark:bg-amber-950/30">
          <p className="text-2xl font-semibold text-amber-700 dark:text-amber-400">{warningRows}</p>
          <p className="text-xs text-amber-600 dark:text-amber-500">Warnings</p>
        </div>
      </div>

      {/* Error table */}
      {criticalErrors.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-destructive">
              Errors ({criticalErrors.length})
            </h4>
            <button
              type="button"
              onClick={onDownloadErrors}
              className="text-xs text-primary underline-offset-4 hover:underline"
              aria-label="Download error report as Excel file"
            >
              Download as Excel
            </button>
          </div>
          <div
            className="max-h-64 overflow-auto rounded-md border"
            role="region"
            aria-label="Validation errors"
          >
            <table className="w-full text-sm" aria-label="Row-level validation errors">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium" scope="col">
                    Row
                  </th>
                  <th className="px-3 py-2 text-left font-medium" scope="col">
                    Field
                  </th>
                  <th className="px-3 py-2 text-left font-medium" scope="col">
                    Value
                  </th>
                  <th className="px-3 py-2 text-left font-medium" scope="col">
                    Error
                  </th>
                </tr>
              </thead>
              <tbody>
                {criticalErrors.slice(0, 100).map((err, idx) => (
                  <tr key={`${err.row}-${err.field}-${idx}`} className="border-b">
                    <td className="px-3 py-2 font-mono text-xs">{err.row}</td>
                    <td className="px-3 py-2">{err.field}</td>
                    <td className="px-3 py-2 text-muted-foreground">{err.value ?? '—'}</td>
                    <td className="px-3 py-2 text-destructive">{err.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {criticalErrors.length > 100 && (
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                Showing first 100 of {criticalErrors.length} errors. Download the full report for
                all errors.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-amber-600 dark:text-amber-400">
            Warnings ({warnings.length})
          </h4>
          <div
            className="max-h-40 overflow-auto rounded-md border border-amber-200 dark:border-amber-900"
            role="region"
            aria-label="Validation warnings"
          >
            <table className="w-full text-sm" aria-label="Row-level warnings">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b bg-amber-50/50 dark:bg-amber-950/20">
                  <th className="px-3 py-2 text-left font-medium" scope="col">
                    Row
                  </th>
                  <th className="px-3 py-2 text-left font-medium" scope="col">
                    Field
                  </th>
                  <th className="px-3 py-2 text-left font-medium" scope="col">
                    Message
                  </th>
                </tr>
              </thead>
              <tbody>
                {warnings.slice(0, 50).map((w, idx) => (
                  <tr key={`${w.row}-${w.field}-${idx}`} className="border-b">
                    <td className="px-3 py-2 font-mono text-xs">{w.row}</td>
                    <td className="px-3 py-2">{w.field}</td>
                    <td className="px-3 py-2 text-amber-700 dark:text-amber-300">{w.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Data preview */}
      {preview.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Data Preview (first {preview.length} rows)</h4>
          <div
            className="max-h-48 overflow-auto rounded-md border"
            role="region"
            aria-label="Data preview"
          >
            <table className="w-full text-sm" aria-label="Preview of import data">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium" scope="col">
                    #
                  </th>
                  {preview[0] &&
                    Object.keys(preview[0].data).map((key) => (
                      <th key={key} className="px-3 py-2 text-left font-medium" scope="col">
                        {key}
                      </th>
                    ))}
                  <th className="px-3 py-2 text-left font-medium" scope="col">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr
                    key={row.rowNumber}
                    className={`border-b ${row.hasErrors ? 'bg-red-50/50 dark:bg-red-950/10' : ''}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{row.rowNumber}</td>
                    {Object.values(row.data).map((value, i) => (
                      <td key={i} className="px-3 py-2">
                        {String(value ?? '')}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      {row.hasErrors ? (
                        <span className="text-destructive" aria-label="Has errors">
                          ✕
                        </span>
                      ) : (
                        <span className="text-green-600" aria-label="Valid">
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

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
            aria-label="Re-upload a corrected file"
          >
            Re-upload File
          </button>
        </div>
        <button
          type="button"
          onClick={onContinue}
          disabled={!canProceed}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          aria-label={
            hasDuplicates
              ? 'Continue to duplicate resolution'
              : `Confirm import of ${validRows} valid rows`
          }
        >
          {hasDuplicates ? 'Resolve Duplicates' : `Import ${validRows} Valid Rows`}
        </button>
      </div>
    </div>
  );
}

export default ValidationReviewStep;
