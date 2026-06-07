/**
 * ImportWizard — Multi-step bulk import wizard for student records.
 *
 * Orchestrates the 5-step import flow:
 * 1. File Upload (Excel/CSV)
 * 2. Column Mapping (with type inference)
 * 3. Validation Review (row-level errors, download-as-Excel)
 * 4. Duplicate Resolution (skip / update / create)
 * 5. Import Confirmation (final results)
 *
 * Wired to the student bulk import API: POST /api/v1/students/import
 *
 * _Requirements: 6.7, 6.8, 19.2, 19.5_
 * _Design: A, F, K_
 */
'use client';

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { browserGatewayFetch } from '@/lib/api/browser-gateway';

import { ColumnMappingStep } from './ColumnMappingStep';
import { DuplicateResolutionStep } from './DuplicateResolutionStep';
import { FileUploadStep } from './FileUploadStep';
import { ImportConfirmationStep } from './ImportConfirmationStep';
import { StepIndicator } from './StepIndicator';
import { STUDENT_TARGET_FIELDS } from './studentFields';
import type {
  ColumnMapping,
  DuplicateMatch,
  DuplicateResolution,
  ImportResult,
  ImportWizardState,
  ImportWizardStep,
  ValidationResult,
} from './types';
import { ValidationReviewStep } from './ValidationReviewStep';

const ACCEPTED_FILE_TYPES = ['.xlsx', '.xls', '.csv'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per Requirement 6.7

export function ImportWizard() {
  const navigate = useNavigate();

  const [state, setState] = useState<ImportWizardState>({
    step: 'upload',
    file: null,
    mappings: [],
    validationResult: null,
    duplicates: [],
    importResult: null,
    isProcessing: false,
    error: null,
  });

  const setStep = (step: ImportWizardStep) =>
    setState((prev) => ({ ...prev, step }));

  const setError = (error: string | null) =>
    setState((prev) => ({ ...prev, error }));

  const setProcessing = (isProcessing: boolean) =>
    setState((prev) => ({ ...prev, isProcessing }));

  /* ------------------------------------------------------------------ Step 1: File Upload */

  const handleFileSelect = useCallback(async (file: File) => {
    setState((prev) => ({
      ...prev,
      file,
      isProcessing: true,
      error: null,
    }));

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', 'validate'); // dry-run validation

      const result = await browserGatewayFetch<ValidationResult>(
        '/students/import/validate',
        {
          method: 'POST',
          body: formData,
        },
      );

      setState((prev) => ({
        ...prev,
        validationResult: result,
        mappings: result.columnMappings,
        duplicates: result.duplicates.map((d) => ({
          ...d,
          resolution: 'unresolved' as DuplicateResolution,
        })),
        step: 'mapping',
        isProcessing: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to validate file. Please try again.',
      }));
    }
  }, []);

  /* ------------------------------------------------------------------ Step 2: Column Mapping */

  const handleMappingChange = useCallback(
    (sourceColumn: string, targetField: string) => {
      setState((prev) => ({
        ...prev,
        mappings: prev.mappings.map((m) =>
          m.sourceColumn === sourceColumn
            ? { ...m, targetField, valid: targetField !== '' }
            : m,
        ),
      }));
    },
    [],
  );

  const handleMappingConfirm = useCallback(() => {
    setStep('validation');
  }, []);

  /* ------------------------------------------------------------------ Step 3: Validation Review */

  const handleDownloadErrors = useCallback(() => {
    if (!state.validationResult) return;

    // Build CSV content from errors for download
    const errors = state.validationResult.errors;
    const csvHeader = 'Row,Field,Value,Message,Severity\n';
    const csvRows = errors
      .map(
        (e) =>
          `${e.row},"${e.field}","${(e.value ?? '').replace(/"/g, '""')}","${e.message.replace(/"/g, '""')}",${e.severity}`,
      )
      .join('\n');

    const blob = new Blob([csvHeader + csvRows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-errors.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [state.validationResult]);

  const handleRetry = useCallback(() => {
    setState((prev) => ({
      ...prev,
      step: 'upload',
      file: null,
      validationResult: null,
      mappings: [],
      duplicates: [],
      error: null,
    }));
  }, []);

  const handleValidationContinue = useCallback(() => {
    if (state.duplicates.length > 0) {
      setStep('duplicates');
    } else {
      // No duplicates — proceed directly to import
      handleImport();
    }
  }, [state.duplicates.length]);

  /* ------------------------------------------------------------------ Step 4: Duplicate Resolution */

  const handleResolutionChange = useCallback(
    (importRow: number, resolution: DuplicateResolution) => {
      setState((prev) => ({
        ...prev,
        duplicates: prev.duplicates.map((d) =>
          d.importRow === importRow ? { ...d, resolution } : d,
        ),
      }));
    },
    [],
  );

  const handleResolveAll = useCallback((resolution: DuplicateResolution) => {
    setState((prev) => ({
      ...prev,
      duplicates: prev.duplicates.map((d) => ({ ...d, resolution })),
    }));
  }, []);

  const handleDuplicateConfirm = useCallback(() => {
    handleImport();
  }, []);

  /* ------------------------------------------------------------------ Step 5: Import */

  const handleImport = useCallback(async () => {
    if (!state.file) return;

    setState((prev) => ({
      ...prev,
      step: 'confirmation',
      isProcessing: true,
      error: null,
    }));

    try {
      const formData = new FormData();
      formData.append('file', state.file);
      formData.append('mappings', JSON.stringify(state.mappings));
      formData.append(
        'duplicateResolutions',
        JSON.stringify(
          state.duplicates.map((d) => ({
            importRow: d.importRow,
            existingRecordId: d.existingRecord.id,
            resolution: d.resolution,
          })),
        ),
      );

      const result = await browserGatewayFetch<ImportResult>(
        '/students/import',
        {
          method: 'POST',
          body: formData,
        },
      );

      setState((prev) => ({
        ...prev,
        importResult: result,
        isProcessing: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error:
          err instanceof Error
            ? err.message
            : 'Import failed. Please try again.',
      }));
    }
  }, [state.file, state.mappings, state.duplicates]);

  /* ------------------------------------------------------------------ Reset & Navigation */

  const handleReset = useCallback(() => {
    setState({
      step: 'upload',
      file: null,
      mappings: [],
      validationResult: null,
      duplicates: [],
      importResult: null,
      isProcessing: false,
      error: null,
    });
  }, []);

  const handleDone = useCallback(() => {
    navigate('/app/students/directory');
  }, [navigate]);

  /* ------------------------------------------------------------------ Render */

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Header */}
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold">Import Students</h1>
        <p className="text-sm text-muted-foreground">
          Bulk import student records from Excel or CSV files.
        </p>
      </div>

      {/* Step indicator */}
      <div className="mb-8">
        <StepIndicator currentStep={state.step} />
      </div>

      {/* Global error */}
      {state.error && (
        <div
          className="mb-6 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
          aria-live="assertive"
        >
          {state.error}
        </div>
      )}

      {/* Step content */}
      {state.step === 'upload' && (
        <FileUploadStep
          acceptedTypes={ACCEPTED_FILE_TYPES}
          maxFileSize={MAX_FILE_SIZE}
          isProcessing={state.isProcessing}
          onFileSelect={handleFileSelect}
          onDownloadTemplate={() => {
            // Download a template file from the API
            window.open(
              `${process.env['NEXT_PUBLIC_GATEWAY_URL'] ?? ''}/api/v1/students/import/template`,
              '_blank',
            );
          }}
        />
      )}

      {state.step === 'mapping' && (
        <ColumnMappingStep
          mappings={state.mappings}
          targetFields={STUDENT_TARGET_FIELDS}
          onMappingChange={handleMappingChange}
          onConfirm={handleMappingConfirm}
          onBack={() => setStep('upload')}
          fileName={state.file?.name}
        />
      )}

      {state.step === 'validation' && state.validationResult && (
        <ValidationReviewStep
          validationResult={state.validationResult}
          hasDuplicates={state.duplicates.length > 0}
          onDownloadErrors={handleDownloadErrors}
          onRetry={handleRetry}
          onContinue={handleValidationContinue}
          onBack={() => setStep('mapping')}
        />
      )}

      {state.step === 'duplicates' && (
        <DuplicateResolutionStep
          duplicates={state.duplicates}
          onResolutionChange={handleResolutionChange}
          onResolveAll={handleResolveAll}
          onConfirm={handleDuplicateConfirm}
          onBack={() => setStep('validation')}
        />
      )}

      {state.step === 'confirmation' && (
        <ImportConfirmationStep
          importResult={state.importResult}
          isProcessing={state.isProcessing}
          onReset={handleReset}
          onDone={handleDone}
        />
      )}
    </div>
  );
}

export default ImportWizard;
