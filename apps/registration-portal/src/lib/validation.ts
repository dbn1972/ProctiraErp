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

/** PRC-L018: oldest accepted applicant date of birth, in years before today. */
export const MAX_APPLICANT_AGE_YEARS = 100;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Latest selectable date of birth (today, UTC) for the `max` input attribute. */
export function maxDateOfBirth(today: Date = new Date()): string {
  return isoDay(today);
}

/** Earliest selectable date of birth for the `min` input attribute. */
export function minDateOfBirth(
  today: Date = new Date(),
  maxAgeYears: number = MAX_APPLICANT_AGE_YEARS,
): string {
  const min = new Date(today.getTime());
  min.setUTCFullYear(min.getUTCFullYear() - maxAgeYears);
  return isoDay(min);
}

/**
 * Returns true if the input is a valid YYYY-MM-DD calendar date that is not in
 * the future and not older than `maxAgeYears` (PRC-L018).
 */
export function isValidDateOfBirth(
  value: string,
  options: { today?: Date; maxAgeYears?: number } = {},
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  // Round-trip check to reject impossible dates like 2024-02-31
  if (date.toISOString().slice(0, 10) !== value) return false;
  const today = options.today ?? new Date();
  // ISO YYYY-MM-DD strings compare lexicographically in date order.
  if (value > maxDateOfBirth(today)) return false;
  if (value < minDateOfBirth(today, options.maxAgeYears ?? MAX_APPLICANT_AGE_YEARS)) return false;
  return true;
}

/** PRC-L019: minimal shape of a published configurable field's rules. */
export interface ConfigurableFieldRules {
  id: string;
  type: string;
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export type CustomFieldErrorCode =
  'invalid_number' | 'out_of_range' | 'too_short' | 'too_long' | 'invalid_format' | 'invalid_date';

/**
 * PRC-L019: enforce a published field's validation rules client-side.
 * Empty values are left to the `required` check. Returns null when valid.
 */
export function validateCustomFieldValue(
  field: ConfigurableFieldRules,
  rawValue: string | undefined,
): CustomFieldErrorCode | null {
  const value = (rawValue ?? '').trim();
  if (!value || field.type === 'checkbox' || field.type === 'file') return null;
  const rules = field.validation ?? {};
  if (field.type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'invalid_number';
    if (rules.min !== undefined && n < rules.min) return 'out_of_range';
    if (rules.max !== undefined && n > rules.max) return 'out_of_range';
    return null;
  }
  if (field.type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(value).getTime())) {
      return 'invalid_date';
    }
    return null;
  }
  if (rules.minLength !== undefined && value.length < rules.minLength) return 'too_short';
  if (rules.maxLength !== undefined && value.length > rules.maxLength) return 'too_long';
  if (rules.pattern) {
    let re: RegExp | null = null;
    try {
      // Same semantics as the HTML `pattern` attribute: whole-value match.
      re = new RegExp(`^(?:${rules.pattern})$`, 'u');
    } catch {
      re = null; // malformed pattern in config: let the server decide
    }
    if (re && !re.test(value)) return 'invalid_format';
  }
  return null;
}

/**
 * PRC-L019: only send answers for fields in the current published form
 * (stale keys from an older form version are dropped).
 */
export function configuredCustomFieldEntries(
  answers: Record<string, string>,
  fields: ReadonlyArray<{ id: string; type: string }>,
): Array<{ fieldId: string; value: string }> {
  const allowed = new Set(fields.filter((f) => f.type !== 'file').map((f) => f.id));
  return Object.entries(answers)
    .filter(([fieldId]) => allowed.has(fieldId))
    .map(([fieldId, value]) => ({ fieldId, value }));
}

/** UUID v4 (or any RFC-4122 variant) used as institution identifiers. */
export function isValidInstitutionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

/**
 * Maps an institution type display name to an apply-flow slug.
 * Falls back to `primary` when the type is unknown.
 */
export function institutionTypeToApplySlug(typeName: string | undefined | null): string {
  const normalized = (typeName ?? '').toLowerCase();
  if (normalized.includes('secondary') || normalized.includes('high')) return 'secondary';
  if (normalized.includes('tvet') || normalized.includes('vocational')) return 'tvet';
  if (normalized.includes('pre') || normalized.includes('nursery') || normalized.includes('kg')) {
    return 'preschool';
  }
  return 'primary';
}
