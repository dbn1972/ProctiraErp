/**
 * Seat / placement category (reservation) keys already modelled as `quota` TEXT
 * on seat_matrix, enquiries, placements, and offers. Not a separate rules engine.
 */
export const ADMISSION_QUOTA_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'sc', label: 'SC' },
  { value: 'st', label: 'ST' },
  { value: 'obc', label: 'OBC' },
  { value: 'ews', label: 'EWS' },
  { value: 'management', label: 'Management' },
  { value: 'nri', label: 'NRI' },
  { value: 'staff_ward', label: 'Staff ward' },
  { value: 'minority', label: 'Minority' },
  { value: 'sports', label: 'Sports' },
  { value: 'custom', label: 'Custom key…' },
] as const;

export type AdmissionQuotaPreset = (typeof ADMISSION_QUOTA_CATEGORIES)[number]['value'];

export function formatQuotaLabel(quota: string): string {
  const known = ADMISSION_QUOTA_CATEGORIES.find(
    (row) => row.value === quota && row.value !== 'custom',
  );
  if (known) return known.label;
  return quota;
}

export function resolveQuotaFromForm(preset: string, custom: string): string {
  if (preset === 'custom') {
    const trimmed = custom.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 50) : 'general';
  }
  return preset.trim() || 'general';
}
