/**
 * Validation utilities for the registration portal.
 *
 * Mirrors the backend rules in @proctira/backend-registration:
 *   - File MIME types: jpeg/png/gif/pdf/doc/docx
 *   - Maximum file size: 5 MB
 *   - Tracking number format: REG-XXXXXXXX (8 alphanumeric uppercase chars)
 */

/** Maximum file size in bytes (5 MB) — matches backend MAX_FILE_SIZE_BYTES */
export const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Allowed MIME types — matches backend ALLOWED_FILE_TYPES */
export const ALLOWED_FILE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Human-readable list of allowed file extensions */
export const ALLOWED_EXTENSIONS = 'JPG, PNG, GIF, PDF, DOC, DOCX';

/** Result of file validation */
export interface FileValidationResult {
  valid: boolean;
  error?: 'file_too_large' | 'invalid_type';
  maxSizeMB?: number;
  allowedTypes?: string;
}

/**
 * Validates a single file for upload.
 * Returns `{ valid: true }` if the file passes both type and size checks.
 */
export function validateFile(
  file: File,
  maxSizeBytes: number = DEFAULT_MAX_FILE_SIZE,
  allowedTypes: ReadonlySet<string> = ALLOWED_FILE_TYPES,
): FileValidationResult {
  if (!allowedTypes.has(file.type)) {
    return {
      valid: false,
      error: 'invalid_type',
      allowedTypes: ALLOWED_EXTENSIONS,
    };
  }

  if (file.size > maxSizeBytes) {
    return {
      valid: false,
      error: 'file_too_large',
      maxSizeMB: Math.round(maxSizeBytes / (1024 * 1024)),
    };
  }

  return { valid: true };
}

/**
 * Validates required form fields. Returns a map of field id → error code (`required`).
 */
export function validateRequiredFields(
  values: Record<string, string>,
  requiredFields: string[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of requiredFields) {
    const value = values[field];
    if (!value || value.trim().length === 0) {
      errors[field] = 'required';
    }
  }
  return errors;
}

/** Basic e-mail format check (intentionally permissive — server-side does the strict check). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Basic phone format check (international/local digits with separators). */
export function isValidPhone(phone: string): boolean {
  return /^\+?[\d\s\-()]{7,20}$/.test(phone);
}

/**
 * Validates a tracking number against the backend format `REG-XXXXXXXX`.
 * Case-insensitive on input; the backend stores them upper-case.
 */
export function isValidTrackingNumber(trackingNumber: string): boolean {
  return /^REG-[A-Z0-9]{8}$/i.test(trackingNumber.trim());
}

/** Returns true if the input string is a valid YYYY-MM-DD calendar date. */
export function isValidDateOfBirth(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  // Round-trip check to reject impossible dates like 2024-02-31
  return date.toISOString().slice(0, 10) === value;
}
