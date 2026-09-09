/**
 * G-909 report catalogue — four named exports plus insights-ui template aliases
 * so existing `/reports/templates` clients keep working.
 */
export const REPORT_KEYS = [
  'students_roster',
  'attendance_summary',
  'fee_dues',
  'enrolment_by_grade',
  'exam_results',
] as const;

export type CatalogueReportKey = (typeof REPORT_KEYS)[number];

export type CatalogueReportFormat = 'csv' | 'xlsx' | 'pdf';

export const REPORT_FORMATS: readonly CatalogueReportFormat[] = ['csv', 'xlsx', 'pdf'];

export const TEMPLATE_ALIASES: Record<string, CatalogueReportKey> = {
  'tpl-students-roster': 'students_roster',
  'tpl-enrolment-summary': 'enrolment_by_grade',
  'tpl-attendance-daily': 'attendance_summary',
  'tpl-fee-dues': 'fee_dues',
  'tpl-exam-results': 'exam_results',
};

export interface CatalogueEntry {
  id: string;
  reportKey: CatalogueReportKey;
  name: string;
  description: string;
  module: string;
  format: Array<'PDF' | 'XLSX' | 'CSV'>;
  filters: Array<{
    key: string;
    label: string;
    type: 'text' | 'date' | 'select' | 'number';
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
  }>;
}

export const REPORT_CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: 'tpl-students-roster',
    reportKey: 'students_roster',
    name: 'Students roster',
    description: 'Active students with name, gender, and date of birth.',
    module: 'students',
    format: ['PDF', 'XLSX', 'CSV'],
    filters: [],
  },
  {
    id: 'tpl-attendance-daily',
    reportKey: 'attendance_summary',
    name: 'Attendance summary',
    description: 'Present / absent / late counts by grade for the tenant.',
    module: 'attendance',
    format: ['PDF', 'XLSX', 'CSV'],
    filters: [{ key: 'date', label: 'Date', type: 'date' }],
  },
  {
    id: 'tpl-fee-dues',
    reportKey: 'fee_dues',
    name: 'Fee dues',
    description: 'Open and overdue invoices with amounts in cents.',
    module: 'fees',
    format: ['PDF', 'XLSX', 'CSV'],
    filters: [],
  },
  {
    id: 'tpl-enrolment-summary',
    reportKey: 'enrolment_by_grade',
    name: 'Enrolment by grade',
    description: 'Headcount by grade and status for the selected period.',
    module: 'students',
    format: ['PDF', 'XLSX', 'CSV'],
    filters: [
      { key: 'academicPeriodId', label: 'Academic period', type: 'text', required: true },
    ],
  },
  {
    id: 'tpl-exam-results',
    reportKey: 'exam_results',
    name: 'Exam results',
    description: 'Candidate marks and pass/fail by examination.',
    module: 'examinations',
    format: ['PDF', 'XLSX', 'CSV'],
    filters: [],
  },
];

export function isReportKey(value: string): value is CatalogueReportKey {
  return (REPORT_KEYS as readonly string[]).includes(value);
}

export function isCatalogueFormat(value: string): value is CatalogueReportFormat {
  return (REPORT_FORMATS as readonly string[]).includes(value);
}

export function resolveReportKey(input: {
  reportKey?: string;
  templateId?: string;
}): CatalogueReportKey | null {
  if (input.reportKey && isReportKey(input.reportKey)) return input.reportKey;
  if (input.templateId) {
    if (isReportKey(input.templateId)) return input.templateId;
    const aliased = TEMPLATE_ALIASES[input.templateId];
    if (aliased) return aliased;
  }
  return null;
}

export function catalogueEntryFor(key: CatalogueReportKey): CatalogueEntry {
  return REPORT_CATALOGUE.find((e) => e.reportKey === key)!;
}

export function findCatalogueEntry(idOrKey: string): CatalogueEntry | null {
  const byId = REPORT_CATALOGUE.find((e) => e.id === idOrKey);
  if (byId) return byId;
  if (isReportKey(idOrKey)) return catalogueEntryFor(idOrKey);
  const aliased = TEMPLATE_ALIASES[idOrKey];
  return aliased ? catalogueEntryFor(aliased) : null;
}

export function formatApiLabel(format: CatalogueReportFormat): 'PDF' | 'XLSX' | 'CSV' {
  if (format === 'pdf') return 'PDF';
  if (format === 'xlsx') return 'XLSX';
  return 'CSV';
}
