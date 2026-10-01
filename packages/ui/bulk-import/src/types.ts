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

export interface ImportResult {
  success: number;
  failed: number;
  /** Optional per-row errors for the failed rows, offered as a download */
  errors?: ImportRowError[];
}
export type ImportStep = 'upload' | 'mapping' | 'preview' | 'importing' | 'complete';

/**
 * User-facing strings for BulkImport. Every key has an English default; pass a
 * partial object (e.g. from the app's i18n catalogue) to translate.
 */
export interface BulkImportLabels {
  stepUpload: string;
  stepMapping: string;
  stepPreview: string;
  stepImport: string;
  stepComplete: string;
  stepsNav: string;
  chooseFile: string;
  acceptedHint: (types: string, maxSize: string) => string;
  fileHelp: string;
  downloadTemplate: string;
  downloadTemplateAria: string;
  mappingTitle: string;
  mappingInfo: string;
  mappingTable: string;
  sourceColumn: string;
  targetField: string;
  status: string;
  skip: string;
  mapColumn: (column: string) => string;
  alreadyMapped: string;
  required: string;
  duplicate: string;
  mapped: string;
  back: string;
  continueToPreview: string;
  previewTitle: string;
  totalRows: string;
  validRows: string;
  errorRows: string;
  warningRows: string;
  validationErrorsTitle: (count: number) => string;
  validationErrorsRegion: string;
  validationErrorsTable: string;
  columnRow: string;
  columnField: string;
  columnValue: string;
  columnError: string;
  columnSeverity: string;
  showingFirstErrors: (shown: number, total: number) => string;
  downloadAllErrors: (count: number) => string;
  dataPreviewTitle: (count: number) => string;
  dataPreviewRegion: string;
  dataPreviewTable: string;
  rowHasErrors: string;
  rowValid: string;
  importValidRows: (count: number) => string;
  importing: string;
  completeTitle: string;
  successfullyImported: string;
  failed: string;
  downloadFailedRows: (count: number) => string;
  importAnother: string;
  done: string;
  cancelImport: string;
  validatingFile: string;
  fileTooLarge: (size: string, max: string) => string;
  fileTypeNotAccepted: (ext: string, allowed: string) => string;
  validateFailed: string;
  importFailed: string;
  duplicateMapping: (fields: string) => string;
  requiredNotMapped: (fields: string) => string;
}
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
  onImportConfirm: (file: File, mappings: ImportColumnMapping[]) => Promise<ImportResult>;
  /**
   * Called with the complete error list when the user asks to download errors.
   * When omitted, the component downloads a CSV of all errors itself.
   */
  onDownloadErrors?: (errors: ImportRowError[], source: 'validation' | 'import') => void;
  /** Callback to download a template file */
  onDownloadTemplate?: () => void;
  /** Callback when import is cancelled */
  onCancel?: () => void;
  /** Whether the component is in a loading state */
  loading?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** Translated UI strings; missing keys fall back to English */
  labels?: Partial<BulkImportLabels>;
}
