/**
 * Shared shapes for Insights UI aggregates (in-memory + Postgres stores).
 */

export interface ReportTemplate {
  id: string;
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

export interface ReportRun {
  id: string;
  templateId: string;
  templateName: string;
  generatedAt: string;
  generatedBy: string;
  format: 'PDF' | 'XLSX' | 'CSV';
  fileSizeKb: number;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED';
  downloadUrl: string | null;
}

export interface DwIndicator {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  latestValue: number | null;
  trend: 'UP' | 'DOWN' | 'FLAT' | null;
  lastUpdated: string | null;
}

export interface DwImportJob {
  id: string;
  source: 'EXCEL' | 'CSV' | 'DATABASE';
  filename: string;
  submittedAt: string;
  rows: number;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  errorMessage?: string | null;
}

export interface DwGeoFeature {
  institutionId: string;
  name: string;
  latitude: number;
  longitude: number;
  type: string;
  enrolment: number;
}

export function seedTemplates(): ReportTemplate[] {
  return [
    {
      id: 'tpl-enrolment-summary',
      name: 'Enrolment summary',
      description: 'Headcount by grade and gender for the selected period.',
      module: 'students',
      format: ['PDF', 'XLSX', 'CSV'],
      filters: [
        { key: 'academicPeriodId', label: 'Academic period', type: 'text', required: true },
        {
          key: 'gender',
          label: 'Gender',
          type: 'select',
          options: [
            { value: 'all', label: 'All' },
            { value: 'F', label: 'Female' },
            { value: 'M', label: 'Male' },
          ],
        },
      ],
    },
    {
      id: 'tpl-attendance-daily',
      name: 'Daily attendance',
      description: 'Present / absent counts for a single school day.',
      module: 'attendance',
      format: ['PDF', 'CSV'],
      filters: [{ key: 'date', label: 'Date', type: 'date', required: true }],
    },
  ];
}

export function seedIndicators(): DwIndicator[] {
  return [
    {
      id: 'ind-ger',
      code: 'GER',
      name: 'Gross enrolment ratio',
      category: 'Access',
      unit: '%',
      latestValue: 98.2,
      trend: 'UP',
      lastUpdated: new Date().toISOString(),
    },
    {
      id: 'ind-ptr',
      code: 'PTR',
      name: 'Pupil–teacher ratio',
      category: 'Quality',
      unit: 'ratio',
      latestValue: 28.4,
      trend: 'FLAT',
      lastUpdated: new Date().toISOString(),
    },
  ];
}

export function seedGeoFeatures(): DwGeoFeature[] {
  return [
    {
      institutionId: 'inst-demo-1',
      name: 'Demo Primary School',
      latitude: 19.076,
      longitude: 72.8777,
      type: 'primary',
      enrolment: 420,
    },
  ];
}
