/**
 * ColumnMappingStep — Step 2 of the import wizard.
 * Displays detected columns from the file and allows mapping to target fields.
 * Includes type inference hints and required field indicators.
 *
 * _Requirements: 19.2_
 */
'use client';

import { useCallback, useMemo } from 'react';
import type { ColumnMapping, TargetField } from './types';

interface ColumnMappingStepProps {
  /** Current column mappings (auto-detected from file headers) */
  mappings: ColumnMapping[];
  /** Available target fields in the student schema */
  targetFields: TargetField[];
  /** Callback when a mapping is changed */
  onMappingChange: (sourceColumn: string, targetField: string) => void;
  /** Callback to proceed to next step */
  onConfirm: () => void;
  /** Callback to go back */
  onBack: () => void;
  /** File name for display */
  fileName?: string;
}

export function ColumnMappingStep({
  mappings,
  targetFields,
  onMappingChange,
  onConfirm,
  onBack,
  fileName,
}: ColumnMappingStepProps) {
  const requiredFields = useMemo(() => targetFields.filter((f) => f.required), [targetFields]);

  const mappedTargets = useMemo(
    () => mappings.filter((m) => m.valid).map((m) => m.targetField),
    [mappings],
  );

  const missingRequired = useMemo(
    () => requiredFields.filter((f) => !mappedTargets.includes(f.name)),
    [requiredFields, mappedTargets],
  );

  const canProceed = missingRequired.length === 0;

  const handleConfirm = useCallback(() => {
    if (canProceed) onConfirm();
  }, [canProceed, onConfirm]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Map Columns</h3>
        <p className="text-sm text-muted-foreground">
          Match the columns from {fileName && <span className="font-medium">{fileName}</span>} to
          the corresponding student fields. Required fields are marked with *.
        </p>
      </div>

      {/* Missing required fields warning */}
      {missingRequired.length > 0 && (
        <div
          className="rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-200"
          role="alert"
        >
          <strong>Required fields not mapped:</strong>{' '}
          {missingRequired.map((f) => f.label).join(', ')}
        </div>
      )}

      {/* Mapping table */}
      <div className="rounded-md border">
        <table className="w-full text-sm" aria-label="Column mapping configuration">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium" scope="col">
                File Column
              </th>
              <th className="px-4 py-3 text-left font-medium" scope="col">
                Detected Type
              </th>
              <th className="px-4 py-3 text-left font-medium" scope="col">
                Maps To
              </th>
              <th className="px-4 py-3 text-left font-medium" scope="col">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((mapping) => (
              <tr key={mapping.sourceColumn} className="border-b">
                <td className="px-4 py-3 font-medium">{mapping.sourceColumn}</td>
                <td className="px-4 py-3 text-muted-foreground capitalize">
                  {mapping.inferredType ?? 'text'}
                </td>
                <td className="px-4 py-3">
                  <label htmlFor={`mapping-select-${mapping.sourceColumn}`} className="sr-only">
                    Map &quot;{mapping.sourceColumn}&quot; to field
                  </label>
                  <select
                    id={`mapping-select-${mapping.sourceColumn}`}
                    value={mapping.targetField}
                    onChange={(e) => onMappingChange(mapping.sourceColumn, e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Map "${mapping.sourceColumn}" to target field`}
                  >
                    <option value="">— Skip this column —</option>
                    {targetFields.map((field) => (
                      <option
                        key={field.name}
                        value={field.name}
                        disabled={
                          mappedTargets.includes(field.name) && mapping.targetField !== field.name
                        }
                      >
                        {field.label}
                        {field.required ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  {mapping.valid ? (
                    <span className="text-green-600" aria-label="Mapped">
                      ✓
                    </span>
                  ) : mapping.required ? (
                    <span className="text-destructive text-xs" role="alert">
                      Required
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">Skipped</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          aria-label="Continue to validation review"
        >
          Continue to Review
        </button>
      </div>
    </div>
  );
}

export default ColumnMappingStep;
