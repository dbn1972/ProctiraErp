/** Client-side checks for scholarship supporting documents. The API re-checks magic bytes. */

export const SCHOLARSHIP_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const SCHOLARSHIP_DOCUMENT_ACCEPT =
  'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';

const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  income_certificate: 'Income certificate',
  marksheet: 'Marksheet',
  caste_certificate: 'Caste certificate',
  category_certificate: 'Category certificate',
  id_proof: 'ID proof',
  transcript: 'Transcript',
  national_id: 'National ID',
  recommendation_letter: 'Recommendation letter',
  other: 'Other supporting document',
};

export function documentTypeLabel(type: string): string {
  return DOCUMENT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
}

export function clientFileError(file: { type: string; size: number }): string | null {
  if (!ALLOWED.has(file.type)) {
    return 'Use a PDF, JPEG, or PNG.';
  }
  if (file.size <= 0) return 'That file is empty.';
  if (file.size > SCHOLARSHIP_DOCUMENT_MAX_BYTES) return 'File must be 10 MB or smaller.';
  return null;
}

/** Required scheme types that have no uploaded (non-rejected) file yet. */
export function missingRequiredDocuments(required: string[], uploadedTypes: string[]): string[] {
  const have = new Set(uploadedTypes);
  return required.filter((type) => !have.has(type));
}
