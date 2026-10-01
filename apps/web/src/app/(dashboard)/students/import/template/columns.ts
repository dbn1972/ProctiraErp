/**
 * Single source of truth for the student import template columns (PRC-L061).
 * The route handler writes these headers and the import page renders its
 * column guidance from the same list, so copy and template cannot drift.
 * Keys must match `EXPECTED_HEADERS` in packages/backend/student/src/import/excel-parser.ts.
 */
export interface ImportTemplateColumn {
  key: string;
  label: string;
  required: boolean;
  /** Illustrative value for the separate "Example" sheet (never the data sheet). */
  example: string;
  hint?: string;
}

/** Accepted values for the gender column (mirrors the backend row validator). */
export const IMPORT_GENDER_VALUES = ['male', 'female', 'other'] as const;

export const IMPORT_TEMPLATE_COLUMNS: readonly ImportTemplateColumn[] = [
  { key: 'first_name', label: 'First name', required: true, example: 'Asha' },
  { key: 'last_name', label: 'Last name', required: true, example: 'Rao' },
  {
    key: 'date_of_birth',
    label: 'Date of birth',
    required: true,
    example: '2014-06-01',
    hint: 'YYYY-MM-DD',
  },
  {
    key: 'gender',
    label: 'Gender',
    required: false,
    example: 'female',
    hint: IMPORT_GENDER_VALUES.join(' / '),
  },
  { key: 'national_id', label: 'National ID', required: false, example: '' },
  { key: 'nationality', label: 'Nationality', required: false, example: 'IN' },
  { key: 'contact_phone', label: 'Contact phone', required: false, example: '+91 90000 00000' },
  {
    key: 'contact_email',
    label: 'Contact email',
    required: false,
    example: 'guardian@example.com',
  },
  { key: 'guardian_name', label: 'Guardian name', required: false, example: 'Ravi Rao' },
  { key: 'guardian_phone', label: 'Guardian phone', required: false, example: '+91 90000 00001' },
  { key: 'institution_code', label: 'Institution code', required: false, example: 'SCH001' },
];

export const IMPORT_TEMPLATE_HEADERS: readonly string[] = IMPORT_TEMPLATE_COLUMNS.map((c) => c.key);
