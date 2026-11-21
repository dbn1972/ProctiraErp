export interface FileValidationError {
  file: File;
  /** `content`: the bytes do not match the declared type (PRC-L200). */
  error: 'type' | 'size' | 'count' | 'content';
  message: string;
}

/**
 * Topic 18: server-side malware-scan lifecycle of an upload. Only `clean`
 * files are usable; `pending` means the server has not finished scanning.
 */
export type FileScanStatus = 'pending' | 'clean' | 'infected' | 'error';

/** Server verdict for one selected file, returned by `onFilesSelected`. */
export interface FileScanResult {
  file: File;
  scanStatus: FileScanStatus;
  /** Optional server message shown instead of the default status text. */
  message?: string;
}

export interface UploadedFile {
  /** Original file object */
  file: File;
  /** Unique ID for tracking */
  id: string;
  /** Upload progress (0-100) */
  progress: number;
  /** Upload status */
  status: 'pending' | 'uploading' | 'complete' | 'error';
  /** Error message if upload failed */
  errorMessage?: string;
  /** Preview URL for images */
  previewUrl?: string;
  /** Server malware-scan status; the file is usable only when `clean`. */
  scanStatus?: FileScanStatus;
}

export interface FileUploadProps {
  /**
   * Accepted file types (MIME types or extensions).
   *
   * UX-only: matching uses the file-name extension and the browser-reported
   * `File.type`, both of which the user controls. Every upload endpoint must
   * re-validate size, content (magic bytes) and malware scan server-side.
   */
  accept?: string[];
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Maximum number of files */
  maxFiles?: number;
  /** Whether multiple files can be uploaded */
  multiple?: boolean;
  /**
   * Callback when files are selected. It may return a promise of per-file
   * server scan results; the component then shows each file as scanning until
   * the promise settles and announces the verdicts (a rejection marks every
   * file as failed). Returning nothing keeps the previous synchronous contract.
   */
  onFilesSelected: (files: File[]) => void | Promise<void | FileScanResult[]>;
  /** Callback when validation errors occur */
  onValidationError?: (errors: FileValidationError[]) => void;
  /**
   * Render rejected files as a visible `role="alert"` list inside the
   * component. Defaults to `true` so validation never fails silently; set
   * `false` only when the caller renders `onValidationError` output itself.
   */
  showValidationErrors?: boolean;
  /** Callback when a file is removed */
  onFileRemove?: (fileId: string) => void;
  /** Currently uploaded/uploading files */
  files?: UploadedFile[];
  /** Whether the upload area is disabled */
  disabled?: boolean;
  /** Custom label for the drop zone */
  dropZoneLabel?: string;
  /** Accessible label */
  ariaLabel: string;
  /** Additional CSS class name */
  className?: string;
}
