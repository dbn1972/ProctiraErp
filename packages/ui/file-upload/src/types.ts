export interface FileValidationError {
  file: File;
  error: 'type' | 'size' | 'count';
  message: string;
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
}

export interface FileUploadProps {
  /** Accepted file types (MIME types or extensions) */
  accept?: string[];
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Maximum number of files */
  maxFiles?: number;
  /** Whether multiple files can be uploaded */
  multiple?: boolean;
  /** Callback when files are selected */
  onFilesSelected: (files: File[]) => void;
  /** Callback when validation errors occur */
  onValidationError?: (errors: FileValidationError[]) => void;
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
