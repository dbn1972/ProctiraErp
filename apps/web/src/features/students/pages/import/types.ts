/**
 * Types for the Student Bulk Import Wizard.
 *
 * Supports the 5-step import flow:
 * 1. File Upload (Excel/CSV)
 * 2. Column Mapping
 * 3. Validation Review (row-level errors)
 * 4. Duplicate Resolution
 * 5. Import Confirmation
 *
 * _Requirements: 6.7, 19.2, 19.5_
 */

/** Steps in the import wizard */
export type ImportWizardStep =
  | 'upload'
  | 'mapping'
  | 'validation'
  | 'duplicates'
  | 'confirmation';

/** Column mapping between source file and target system fields */
export interface ColumnMapping {
  /** Column header from the uploaded file */
  sourceColumn: string;
  /** Target field in the student schema */
  targetField: string;
  /** Whether this mapping is required */
  required: boolean;
  /** Whether the mapping is currently valid */
  valid: boolean;
  /** Inferred type from file data */
  inferredType?: 'text' | 'number' | 'date' | 'email' | 'phone';
}

/** A single row-level validation error */
export interface RowError {
  /** 1-based row number in the source file */
  row: number;
  /** Field/column that has the error */
  field: string;
  /** Human-readable error message */
  message: string;
  /** The invalid value (if available) */
  value?: string;
  /** Error severity */
  severity: 'error' | 'warning';
}

/** A preview row from the uploaded file */
export interface PreviewRow {
  /** 1-based row number */
  rowNumber: number;
  /** Row data as key-value pairs */
  data: Record<string, unknown>;
  /** Whether this row has validation errors */
  hasErrors: boolean;
  /** Errors specific to this row */
  errors: RowError[];
}

/** Result of server-side file validation (dry-run) */
export interface ValidationResult {
  /** Total rows parsed from the file */
  totalRows: number;
  /** Number of rows that passed validation */
  validRows: number;
  /** Number of rows with errors */
  errorRows: number;
  /** Number of rows with warnings only */
  warningRows: number;
  /** All validation errors */
  errors: RowError[];
  /** Preview of first N rows */
  preview: PreviewRow[];
  /** Auto-detected column mappings */
  columnMappings: ColumnMapping[];
  /** Detected duplicates */
  duplicates: DuplicateMatch[];
}

/** A potential duplicate match found during validation */
export interface DuplicateMatch {
  /** Row number in the import file */
  importRow: number;
  /** Data from the import row */
  importData: Record<string, unknown>;
  /** Existing record that matches */
  existingRecord: {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    nationalId?: string;
  };
  /** Fields that matched */
  matchedFields: string[];
  /** Confidence score (0-1) */
  confidence: number;
  /** User's resolution choice */
  resolution: DuplicateResolution;
}

/** How to resolve a duplicate */
export type DuplicateResolution = 'skip' | 'update' | 'create' | 'unresolved';

/** Target fields available for student import mapping */
export interface TargetField {
  /** Field name (API key) */
  name: string;
  /** Human-readable label */
  label: string;
  /** Whether this field is required */
  required: boolean;
  /** Field type for validation hints */
  type: 'text' | 'number' | 'date' | 'email' | 'phone' | 'select';
}

/** Final import result from the server */
export interface ImportResult {
  /** Number of successfully imported records */
  success: number;
  /** Number of records that failed */
  failed: number;
  /** Number of records skipped (duplicates resolved as skip) */
  skipped: number;
  /** Number of records updated (duplicates resolved as update) */
  updated: number;
  /** Errors for failed rows */
  errors: RowError[];
}

/** State of the import wizard */
export interface ImportWizardState {
  /** Current step */
  step: ImportWizardStep;
  /** Selected file */
  file: File | null;
  /** Column mappings */
  mappings: ColumnMapping[];
  /** Validation result from dry-run */
  validationResult: ValidationResult | null;
  /** Duplicate matches with resolutions */
  duplicates: DuplicateMatch[];
  /** Final import result */
  importResult: ImportResult | null;
  /** Whether a request is in progress */
  isProcessing: boolean;
  /** Current error message */
  error: string | null;
}
