/**
 * Typebox schemas for Report Engine request/response validation.
 *
 * Defines schemas for:
 * - ReportRequest (body) - configurable filters, grouping, aggregation
 * - ReportTemplate (body) - report card templates with merge fields
 * - ScheduledReport (body) - scheduled report generation
 * - ReportJob (response) - report job status tracking
 *
 * Requirements:
 * - 17.1: Configurable report generation with filters, grouping, aggregation
 * - 17.2: Multi-format export (XLSX, PDF, CSV)
 * - 17.3: Report card templates with merge fields, conditional sections, branding
 * - 17.4: Queue long-running reports for background processing
 * - 17.5: RBAC-scoped data filtering
 * - 17.6: Scheduled report generation with delivery
 */
import { Type, type Static } from '@sinclair/typebox';

const UuidPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

// ─── Report Format ───────────────────────────────────────────────────────────

export const ReportFormatSchema = Type.Union(
  [Type.Literal('xlsx'), Type.Literal('pdf'), Type.Literal('csv')],
  { description: 'Report export format' },
);

export type ReportFormat = Static<typeof ReportFormatSchema>;

// ─── Report Job Status ───────────────────────────────────────────────────────

export const ReportJobStatusSchema = Type.Union(
  [
    Type.Literal('queued'),
    Type.Literal('processing'),
    Type.Literal('completed'),
    Type.Literal('failed'),
  ],
  { description: 'Report job processing status' },
);

export type ReportJobStatus = Static<typeof ReportJobStatusSchema>;

// ─── Aggregation Type ────────────────────────────────────────────────────────

export const AggregationTypeSchema = Type.Union(
  [
    Type.Literal('count'),
    Type.Literal('sum'),
    Type.Literal('avg'),
    Type.Literal('min'),
    Type.Literal('max'),
  ],
  { description: 'Aggregation function type' },
);

export type AggregationType = Static<typeof AggregationTypeSchema>;

// ─── Aggregation Config ──────────────────────────────────────────────────────

export const AggregationConfigSchema = Type.Object({
  field: Type.String({ minLength: 1, description: 'Field to aggregate' }),
  type: AggregationTypeSchema,
  alias: Type.Optional(Type.String({ description: 'Alias for the aggregated column' })),
});

export type AggregationConfig = Static<typeof AggregationConfigSchema>;

// ─── Delivery Method ─────────────────────────────────────────────────────────

export const DeliveryMethodSchema = Type.Union([Type.Literal('email'), Type.Literal('in_app')], {
  description: 'Report delivery method',
});

export type DeliveryMethod = Static<typeof DeliveryMethodSchema>;

// ─── Report Request ──────────────────────────────────────────────────────────

export const GenerateReportSchema = Type.Object({
  reportType: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Report type identifier (e.g., student_enrollment, attendance_summary)',
  }),
  format: ReportFormatSchema,
  filters: Type.Record(Type.String(), Type.Unknown(), {
    description: 'Key-value filter criteria for the report data',
  }),
  groupBy: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description: 'Fields to group results by',
    }),
  ),
  aggregations: Type.Optional(
    Type.Array(AggregationConfigSchema, {
      description: 'Aggregation configurations',
    }),
  ),
  templateId: Type.Optional(
    Type.String({
      pattern: UuidPattern,
      description: 'Report card template ID (for report card generation)',
    }),
  ),
  title: Type.Optional(
    Type.String({
      maxLength: 255,
      description: 'Custom report title',
    }),
  ),
});

export type GenerateReportInput = Static<typeof GenerateReportSchema>;

// ─── Report Template ─────────────────────────────────────────────────────────

export const MergeFieldSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100, description: 'Merge field name' }),
  source: Type.String({ minLength: 1, description: 'Data source path for the field' }),
  defaultValue: Type.Optional(Type.String({ description: 'Default value if source is empty' })),
});

export type MergeField = Static<typeof MergeFieldSchema>;

export const ConditionalSectionSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100, description: 'Section name' }),
  condition: Type.String({
    minLength: 1,
    description: 'Condition expression (e.g., "score >= 50")',
  }),
  content: Type.String({ description: 'Section content template' }),
});

export type ConditionalSection = Static<typeof ConditionalSectionSchema>;

export const BrandingConfigSchema = Type.Object({
  logoUrl: Type.Optional(Type.String({ description: 'Institution logo URL' })),
  institutionName: Type.Optional(Type.String({ description: 'Institution name' })),
  headerColor: Type.Optional(Type.String({ description: 'Header color (hex)' })),
  footerText: Type.Optional(Type.String({ description: 'Footer text' })),
});

export type BrandingConfig = Static<typeof BrandingConfigSchema>;

export const CreateReportTemplateSchema = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: 255,
    description: 'Template name',
  }),
  type: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Template type (e.g., report_card, transcript, certificate)',
  }),
  format: ReportFormatSchema,
  layout: Type.String({
    minLength: 1,
    description: 'Template layout content (HTML/markup with merge field placeholders)',
  }),
  mergeFields: Type.Array(MergeFieldSchema, {
    description: 'Merge fields available in this template',
  }),
  conditionalSections: Type.Optional(
    Type.Array(ConditionalSectionSchema, {
      description: 'Conditional sections that render based on data conditions',
    }),
  ),
  branding: Type.Optional(BrandingConfigSchema),
});

export type CreateReportTemplateInput = Static<typeof CreateReportTemplateSchema>;

export const UpdateReportTemplateSchema = Type.Partial(CreateReportTemplateSchema);

export type UpdateReportTemplateInput = Static<typeof UpdateReportTemplateSchema>;

// ─── Scheduled Report ────────────────────────────────────────────────────────

export const CreateScheduledReportSchema = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: 255,
    description: 'Schedule name',
  }),
  reportType: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Report type to generate',
  }),
  format: ReportFormatSchema,
  filters: Type.Record(Type.String(), Type.Unknown(), {
    description: 'Report filter criteria',
  }),
  groupBy: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  aggregations: Type.Optional(Type.Array(AggregationConfigSchema)),
  templateId: Type.Optional(Type.String({ pattern: UuidPattern })),
  cronExpression: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Cron expression for schedule (e.g., "0 8 * * 1" for every Monday at 8am)',
  }),
  deliveryMethod: DeliveryMethodSchema,
  recipientUserIds: Type.Optional(
    Type.Array(
      Type.String({
        pattern: UuidPattern,
        description: 'User IDs to deliver the report to',
      }),
    ),
  ),
  recipientEmails: Type.Optional(
    Type.Array(
      Type.String({
        description: 'Email addresses for delivery',
      }),
    ),
  ),
  isActive: Type.Optional(Type.Boolean({ description: 'Whether the schedule is active' })),
});

export type CreateScheduledReportInput = Static<typeof CreateScheduledReportSchema>;

export const UpdateScheduledReportSchema = Type.Partial(CreateScheduledReportSchema);

export type UpdateScheduledReportInput = Static<typeof UpdateScheduledReportSchema>;

// ─── Params & Query Schemas ──────────────────────────────────────────────────

export const ReportJobIdParamsSchema = Type.Object({
  jobId: Type.String({
    pattern: UuidPattern,
    description: 'Report job UUID',
  }),
});

export type ReportJobIdParams = Static<typeof ReportJobIdParamsSchema>;

export const TemplateIdParamsSchema = Type.Object({
  templateId: Type.String({
    pattern: UuidPattern,
    description: 'Report template UUID',
  }),
});

export type TemplateIdParams = Static<typeof TemplateIdParamsSchema>;

export const ScheduleIdParamsSchema = Type.Object({
  scheduleId: Type.String({
    pattern: UuidPattern,
    description: 'Scheduled report UUID',
  }),
});

export type ScheduleIdParams = Static<typeof ScheduleIdParamsSchema>;

export const ListReportJobsQuerySchema = Type.Object(
  {
    page: Type.Optional(Type.Number({ minimum: 1, description: 'Page number' })),
    pageSize: Type.Optional(
      Type.Number({ minimum: 1, maximum: 100, description: 'Items per page' }),
    ),
    status: Type.Optional(ReportJobStatusSchema),
    reportType: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type ListReportJobsQuery = Static<typeof ListReportJobsQuerySchema>;

// ─── Response Schemas ────────────────────────────────────────────────────────

export const ReportJobResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  reportType: Type.String(),
  format: ReportFormatSchema,
  status: ReportJobStatusSchema,
  filters: Type.Record(Type.String(), Type.Unknown()),
  groupBy: Type.Optional(Type.Array(Type.String())),
  aggregations: Type.Optional(Type.Array(AggregationConfigSchema)),
  templateId: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  requestedBy: Type.String(),
  requestedByArea: Type.Optional(Type.String()),
  requestedByRole: Type.Optional(Type.String()),
  fileUrl: Type.Optional(Type.String()),
  fileSize: Type.Optional(Type.Number()),
  rowCount: Type.Optional(Type.Number()),
  errorMessage: Type.Optional(Type.String()),
  startedAt: Type.Optional(Type.String()),
  completedAt: Type.Optional(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type ReportJobResponse = Static<typeof ReportJobResponseSchema>;

export const ReportTemplateResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  name: Type.String(),
  type: Type.String(),
  format: ReportFormatSchema,
  layout: Type.String(),
  mergeFields: Type.Array(MergeFieldSchema),
  conditionalSections: Type.Optional(Type.Array(ConditionalSectionSchema)),
  branding: Type.Optional(BrandingConfigSchema),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type ReportTemplateResponse = Static<typeof ReportTemplateResponseSchema>;

export const ScheduledReportResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  name: Type.String(),
  reportType: Type.String(),
  format: ReportFormatSchema,
  filters: Type.Record(Type.String(), Type.Unknown()),
  groupBy: Type.Optional(Type.Array(Type.String())),
  aggregations: Type.Optional(Type.Array(AggregationConfigSchema)),
  templateId: Type.Optional(Type.String()),
  cronExpression: Type.String(),
  deliveryMethod: DeliveryMethodSchema,
  recipientUserIds: Type.Optional(Type.Array(Type.String())),
  recipientEmails: Type.Optional(Type.Array(Type.String())),
  isActive: Type.Boolean(),
  lastRunAt: Type.Optional(Type.String()),
  nextRunAt: Type.Optional(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type ScheduledReportResponse = Static<typeof ScheduledReportResponseSchema>;
