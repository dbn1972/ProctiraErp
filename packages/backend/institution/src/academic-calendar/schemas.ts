/**
 * G-905 — academic calendar: per-period events (holidays, breaks, grading /
 * exam windows) and year-end rollover input/output shapes.
 */
import { Type, type Static } from '@sinclair/typebox';

export const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export const CALENDAR_EVENT_KINDS = [
  'holiday',
  'break',
  'grading_window',
  'exam_window',
  'event',
] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];

export const CalendarEventKindSchema = Type.Union(
  CALENDAR_EVENT_KINDS.map((k) => Type.Literal(k)),
  { description: 'Calendar event kind' },
);

export const CreateCalendarEventSchema = Type.Object({
  kind: CalendarEventKindSchema,
  name: Type.String({ minLength: 1, maxLength: 200 }),
  startDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' }),
  endDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' }),
  /** Omit for a tenant-wide event; set to scope to one school. */
  institutionId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  notes: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type CreateCalendarEventDto = Static<typeof CreateCalendarEventSchema>;

export const CalendarEventResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  academicPeriodId: Type.String(),
  institutionId: Type.Union([Type.String(), Type.Null()]),
  kind: CalendarEventKindSchema,
  name: Type.String(),
  startDate: Type.String(),
  endDate: Type.String(),
  notes: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});
export type CalendarEventResponse = Static<typeof CalendarEventResponseSchema>;

export const RolloverRequestSchema = Type.Object({
  targetPeriodId: Type.String({ pattern: UUID_PATTERN }),
  /** Restrict to one school; omit for every institution in the tenant. */
  institutionId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  /** Also promote ENROLLED students to the next grade in the target period. */
  promoteEnrollments: Type.Optional(Type.Boolean()),
  /** Compute the plan without writing anything (default true). */
  dryRun: Type.Optional(Type.Boolean()),
});
export type RolloverRequestDto = Static<typeof RolloverRequestSchema>;

export interface RolloverSummary {
  dryRun: boolean;
  sourcePeriodId: string;
  targetPeriodId: string;
  classes: { toCreate: number; existing: number; created: number };
  enrollments: {
    considered: number;
    toPromote: number;
    promoted: number;
    /** Students whose grade has no successor — left for graduation handling. */
    graduating: number;
    /** Students who already hold an enrollment in the target period. */
    alreadyInTarget: number;
  };
}
