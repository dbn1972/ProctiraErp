/**
 * DuplicateResolutionStep — Step 4 of the import wizard.
 * Shows detected duplicate matches and allows the user to choose
 * how to resolve each: skip, update existing, or create new.
 *
 * _Requirements: 6.8 (duplicate detection and resolution)_
 */
'use client';

import { useCallback, useMemo } from 'react';
import type { DuplicateMatch, DuplicateResolution } from './types';

interface DuplicateResolutionStepProps {
  /** Detected duplicate matches */
  duplicates: DuplicateMatch[];
  /** Callback when a resolution is changed */
  onResolutionChange: (importRow: number, resolution: DuplicateResolution) => void;
  /** Callback to apply a resolution to all duplicates */
  onResolveAll: (resolution: DuplicateResolution) => void;
  /** Callback to proceed to confirmation */
  onConfirm: () => void;
  /** Callback to go back */
  onBack: () => void;
}

const RESOLUTION_OPTIONS: { value: DuplicateResolution; label: string; description: string }[] = [
  { value: 'skip', label: 'Skip', description: 'Do not import this row' },
  { value: 'update', label: 'Update', description: 'Update the existing record' },
  { value: 'create', label: 'Create New', description: 'Create as a new record' },
];

export function DuplicateResolutionStep({
  duplicates,
  onResolutionChange,
  onResolveAll,
  onConfirm,
  onBack,
}: DuplicateResolutionStepProps) {
  const unresolvedCount = useMemo(
    () => duplicates.filter((d) => d.resolution === 'unresolved').length,
    [duplicates],
  );

  const canProceed = unresolvedCount === 0;

  const handleConfirm = useCallback(() => {
    if (canProceed) onConfirm();
  }, [canProceed, onConfirm]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Resolve Duplicates</h3>
        <p className="text-sm text-muted-foreground">
          {duplicates.length} potential duplicate{duplicates.length !== 1 ? 's' : ''} found.
          For each match, choose whether to skip the import row, update the existing
          record, or create a new record.
        </p>
      </div>

      {/* Bulk actions */}
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
        <span className="text-sm font-medium">Apply to all:</span>
        {RESOLUTION_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onResolveAll(opt.value)}
            className="rounded-md border bg-background px-3 py-1 text-xs hover:bg-muted"
            aria-label={`${opt.label} all duplicates: ${opt.description}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Unresolved count */}
      {unresolvedCount > 0 && (
        <div
          className="rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-200"
          role="alert"
        >
          {unresolvedCount} duplicate{unresolvedCount !== 1 ? 's' : ''} still need resolution before importing.
        </div>
      )}

      {/* Duplicate list */}
      <div className="space-y-4">
        {duplicates.map((dup) => (
          <div
            key={dup.importRow}
            className={`rounded-md border p-4 ${
              dup.resolution === 'unresolved'
                ? 'border-amber-300 dark:border-amber-800'
                : 'border-muted'
            }`}
          >
            <div className="mb-3 flex items-start justify-between">
              <div>
                <p className="text-sm font-medium">
                  Row {dup.importRow} — Confidence:{' '}
                  <span
                    className={
                      dup.confidence >= 0.9
                        ? 'text-red-600'
                        : dup.confidence >= 0.7
                          ? 'text-amber-600'
                          : 'text-muted-foreground'
                    }
                  >
                    {Math.round(dup.confidence * 100)}%
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Matched on: {dup.matchedFields.join(', ')}
                </p>
              </div>
            </div>

            {/* Comparison */}
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                  Import Row
                </p>
                <dl className="space-y-1 text-sm">
                  {Object.entries(dup.importData).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <dt className="font-medium capitalize">{key}:</dt>
                      <dd className="text-muted-foreground">{String(value ?? '—')}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                  Existing Record
                </p>
                <dl className="space-y-1 text-sm">
                  <div className="flex gap-2">
                    <dt className="font-medium">Name:</dt>
                    <dd className="text-muted-foreground">
                      {dup.existingRecord.firstName} {dup.existingRecord.lastName}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="font-medium">DOB:</dt>
                    <dd className="text-muted-foreground">
                      {dup.existingRecord.dateOfBirth}
                    </dd>
                  </div>
                  {dup.existingRecord.nationalId && (
                    <div className="flex gap-2">
                      <dt className="font-medium">National ID:</dt>
                      <dd className="text-muted-foreground">
                        {dup.existingRecord.nationalId}
                      </dd>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <dt className="font-medium">ID:</dt>
                    <dd className="font-mono text-xs text-muted-foreground">
                      {dup.existingRecord.id}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Resolution selector */}
            <fieldset>
              <legend className="sr-only">
                Resolution for row {dup.importRow}
              </legend>
              <div className="flex flex-wrap gap-2">
                {RESOLUTION_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      dup.resolution === opt.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`resolution-${dup.importRow}`}
                      value={opt.value}
                      checked={dup.resolution === opt.value}
                      onChange={() =>
                        onResolutionChange(dup.importRow, opt.value)
                      }
                      className="sr-only"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canProceed}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          aria-label="Confirm import with duplicate resolutions"
        >
          Confirm Import
        </button>
      </div>
    </div>
  );
}

export default DuplicateResolutionStep;
