export interface ImportColumnMapping {
  /** Source column name from the file */
  sourceColumn: string;
  /** Target field name in the system */
  targetField: string;
  /** Whether this mapping is required */
  required: boolean;
  /** Whether the mapping is valid */
  valid: boolean;
}

export interface ImportRowError {
  /** Row number (1-based) */
  row: number;
  /** Column/field that has the error */
  field: string;
  /** Error message */
  message: string;
  /** The invalid value */
  value?: string;
  /** Error severity */
  severity: 'error' | 'warning';
}

export interface ImportPreviewRow {
  /** Row number */
  rowNumber: number;
  /** Row data as key-value pairs */
  data: Record<string, unknown>;
  /** Whether this row has validation errors */
  hasErrors: boolean;
  /** Errors for this specific row */
  errors: ImportRowError[];
}

export interface ImportValidationResult {
  /** Total rows in the file */
  totalRows: number;
  /** Number of valid rows */
  validRows: number;
  /** Number of rows with errors */
  errorRows: number;
  /** Number of rows with warnings */
  warningRows: number;
  /** All validation errors */
  errors: ImportRowError[];
  /** Preview of first N rows */
  preview: ImportPreviewRow[];
  /** Detected column mappings */
  columnMappings: ImportColumnMapping[];
}

export type ImportStep = 'upload' | 'mapping' | 'preview' | 'importing' | 'complete';

export interface BulkImportProps {
  /** Title for the import dialog */
  title: string;
  /** Description/instructions */
  description?: string;
  /** Accepted file types */
  acceptedFileTypes?: string[];
  /** Maximum file size in bytes */
  maxFileSize?: number;
  /** Target fields that data can be mapped to */
  targetFields: { name: string; label: string; required: boolean }[];
  /** Callback when file is selected for validation */
  onFileValidate: (file: File) => Promise<ImportValidationResult>;
  /** Callback when import is confirmed */
  onImportConfirm: (file: File, mappings: ImportColumnMapping[]) => Promise<{ success: number; failed: number }>;
  /** Callback to download a template file */
  onDownloadTemplate?: () => void;
  /** Callback when import is cancelled */
  onCancel?: () => void;
  /** Whether the component is in a loading state */
  loading?: boolean;
  /** Additional CSS class name */
  className?: string;
}
