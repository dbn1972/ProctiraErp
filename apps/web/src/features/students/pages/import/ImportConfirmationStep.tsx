/**
 * ImportConfirmationStep — Step 5 of the import wizard.
 * Shows the final import result with success/failure counts.
 * Allows starting a new import or navigating away.
 *
 * _Requirements: 6.7_
 */
'use client';

import type { ImportResult } from './types';

interface ImportConfirmationStepProps {
  /** Final import result from the server */
  importResult: ImportResult | null;
  /** Whether the import is currently in progress */
  isProcessing: boolean;
  /** Callback to start a new import */
  onReset: () => void;
  /** Callback to navigate to the students directory */
  onDone: () => void;
}

export function ImportConfirmationStep({
  importResult,
  isProcessing,
  onReset,
  onDone,
}: ImportConfirmationStepProps) {
  if (isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center py-12" aria-live="polite">
        <span
          className="mb-4 inline-block h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"
          aria-hidden="true"
        />
        <p className="text-lg font-medium">Importing records...</p>
        <p className="text-sm text-muted-foreground">
          This may take a moment for large files. Please do not close this page.
        </p>
      </div>
    );
  }

  if (!importResult) {
    return null;
  }

  const totalProcessed =
    importResult.success + importResult.failed + importResult.skipped + importResult.updated;
  const hasFailures = importResult.failed > 0;

  return (
    <div className="space-y-6" aria-live="polite">
      <div className="flex flex-col items-center py-6">
        <span className={`mb-3 text-5xl ${hasFailures ? '' : ''}`} aria-hidden="true">
          {hasFailures ? '⚠️' : '✅'}
        </span>
        <h3 className="text-xl font-semibold">
          {hasFailures ? 'Import Completed with Issues' : 'Import Successful'}
        </h3>
        <p className="text-sm text-muted-foreground">{totalProcessed} records processed</p>
      </div>

      {/* Result stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-green-200 bg-green-50 p-4 text-center dark:border-green-900 dark:bg-green-950/30">
          <p className="text-3xl font-bold text-green-700 dark:text-green-400">
            {importResult.success}
          </p>
          <p className="text-xs text-green-600 dark:text-green-500">Created</p>
        </div>
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-center dark:border-blue-900 dark:bg-blue-950/30">
          <p className="text-3xl font-bold text-blue-700 dark:text-blue-400">
            {importResult.updated}
          </p>
          <p className="text-xs text-blue-600 dark:text-blue-500">Updated</p>
        </div>
        <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-center dark:border-gray-700 dark:bg-gray-900/30">
          <p className="text-3xl font-bold text-gray-700 dark:text-gray-400">
            {importResult.skipped}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-500">Skipped</p>
        </div>
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-center dark:border-red-900 dark:bg-red-950/30">
          <p className="text-3xl font-bold text-red-700 dark:text-red-400">{importResult.failed}</p>
          <p className="text-xs text-red-600 dark:text-red-500">Failed</p>
        </div>
      </div>

      {/* Failed rows detail */}
      {importResult.errors.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-destructive">
            Failed Rows ({importResult.errors.length})
          </h4>
          <div
            className="max-h-48 overflow-auto rounded-md border"
            role="region"
            aria-label="Failed import rows"
          >
            <table className="w-full text-sm" aria-label="Failed rows during import">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium" scope="col">
                    Row
                  </th>
                  <th className="px-3 py-2 text-left font-medium" scope="col">
                    Field
                  </th>
                  <th className="px-3 py-2 text-left font-medium" scope="col">
                    Error
                  </th>
                </tr>
              </thead>
              <tbody>
                {importResult.errors.slice(0, 50).map((err, idx) => (
                  <tr key={`${err.row}-${err.field}-${idx}`} className="border-b">
                    <td className="px-3 py-2 font-mono text-xs">{err.row}</td>
                    <td className="px-3 py-2">{err.field}</td>
                    <td className="px-3 py-2 text-destructive">{err.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-center gap-3 pt-4">
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
          aria-label="Import another file"
        >
          Import Another File
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          aria-label="Go to students directory"
        >
          Go to Students
        </button>
      </div>
    </div>
  );
}

export default ImportConfirmationStep;
