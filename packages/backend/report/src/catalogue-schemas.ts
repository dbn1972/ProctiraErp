import { Type, type Static } from '@sinclair/typebox';

const UuidPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';

export const ReportFormatInputSchema = Type.String({ minLength: 3, maxLength: 8 });

export const GenerateCatalogueReportSchema = Type.Object({
  reportKey: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  templateId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  format: ReportFormatInputSchema,
  filters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type GenerateCatalogueReportInput = Static<typeof GenerateCatalogueReportSchema>;

export const CreateCatalogueScheduleSchema = Type.Object({
  reportKey: Type.String({ minLength: 1, maxLength: 100 }),
  format: ReportFormatInputSchema,
  cadence: Type.Union([
    Type.Literal('daily'),
    Type.Literal('weekly'),
    Type.Literal('monthly'),
  ]),
  recipients: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 320 }))),
  enabled: Type.Optional(Type.Boolean()),
});
export type CreateCatalogueScheduleInput = Static<typeof CreateCatalogueScheduleSchema>;

export const PatchCatalogueScheduleSchema = Type.Object({
  enabled: Type.Optional(Type.Boolean()),
});
export type PatchCatalogueScheduleInput = Static<typeof PatchCatalogueScheduleSchema>;

export const ArtifactIdParamsSchema = Type.Object({
  id: Type.String({ pattern: UuidPattern }),
});

export const ScheduleIdParamsSchema = Type.Object({
  scheduleId: Type.String({ pattern: UuidPattern }),
});

export const DashboardQuerySchema = Type.Object({
  role: Type.Optional(
    Type.Union([
      Type.Literal('board'),
      Type.Literal('principal'),
      Type.Literal('teacher'),
      Type.Literal('parent'),
    ]),
  ),
});

export const ListRunsQuerySchema = Type.Object({
  templateId: Type.Optional(Type.String()),
  reportKey: Type.Optional(Type.String()),
  scheduleId: Type.Optional(Type.String({ pattern: UuidPattern })),
});
