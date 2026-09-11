/**
 * Institution domain types used by the web frontend.
 *
 * These mirror the backend `@proctira/institution` Typebox response shapes
 * (see packages/backend/institution/src/schemas.ts and submodules).
 */

export type InstitutionStatus = 'ACTIVE' | 'INACTIVE';

export interface Institution {
  id: string;
  name: string;
  code: string;
  areaId: string;
  typeId: string;
  sectorId: string;
  ownershipId: string;
  status: InstitutionStatus;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  deactivationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface InstitutionListFilters {
  page?: number;
  pageSize?: number;
  areaId?: string;
  status?: InstitutionStatus;
  search?: string;
  sortBy?: 'name' | 'code' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface CreateInstitutionInput {
  name: string;
  code: string;
  areaId: string;
  typeId: string;
  sectorId: string;
  ownershipId: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  contactPhone?: string;
  contactEmail?: string;
}

export type UpdateInstitutionInput = Partial<CreateInstitutionInput>;

export interface AreaNode {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  level: number;
  parentId: string | null;
  path: string;
  children?: AreaNode[];
}

export type AcademicPeriodStatus = 'active' | 'inactive' | 'archived';
/** G-905: `year` is top-level; the rest nest under a year. */
export type AcademicPeriodKind = 'year' | 'semester' | 'term' | 'quarter';

export interface AcademicPeriod {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  status: AcademicPeriodStatus;
  kind: AcademicPeriodKind;
  /** Owning academic year for sub-periods; null for years. */
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAcademicPeriodInput {
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  status?: AcademicPeriodStatus;
  kind?: AcademicPeriodKind;
  parentId?: string | null;
}

export type UpdateAcademicPeriodInput = Partial<CreateAcademicPeriodInput>;

// G-905 — academic calendar events + year-end rollover
export type CalendarEventKind = 'holiday' | 'break' | 'grading_window' | 'exam_window' | 'event';

export interface CalendarEvent {
  id: string;
  tenantId: string;
  academicPeriodId: string;
  /** null = tenant-wide (every institution). */
  institutionId: string | null;
  kind: CalendarEventKind;
  name: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  createdAt: string;
}

export interface CreateCalendarEventInput {
  kind: CalendarEventKind;
  name: string;
  startDate: string;
  endDate: string;
  institutionId?: string;
  notes?: string;
}

export interface RolloverInput {
  targetPeriodId: string;
  institutionId?: string;
  promoteEnrollments?: boolean;
  dryRun?: boolean;
  copyFeeStructures?: boolean;
  copyTimetable?: boolean;
  copyLmsAssignments?: boolean;
  idempotencyKey?: string;
}

export interface RolloverSummary {
  dryRun: boolean;
  sourcePeriodId: string;
  targetPeriodId: string;
  classes: { toCreate: number; existing: number; created: number };
  enrollments: {
    considered: number;
    toPromote: number;
    promoted: number;
    graduating: number;
    alreadyInTarget: number;
  };
  feeStructures?: { cloned: number; source: number };
  timetable?: { sectionsCloned: number; meetingsCloned: number };
  lmsAssignments?: { cloned: number; source: number };
  runId?: string;
}

export interface Grade {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClassSection {
  id: string;
  tenantId: string;
  institutionId: string;
  gradeId: string;
  academicPeriodId: string;
  name: string;
  capacity: number | null;
  createdAt: string;
  updatedAt: string;
}

export type InfrastructureType = 'LAND' | 'BUILDING' | 'FLOOR' | 'ROOM';

export interface InfrastructureItem {
  id: string;
  name: string;
  type: InfrastructureType;
  institutionId: string;
  parentId: string | null;
  capacity: number;
  condition: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InfrastructureHierarchy {
  lands: Array<{
    id: string;
    name: string;
    capacity: number;
    condition: string;
    description: string | null;
    buildings: Array<{
      id: string;
      name: string;
      capacity: number;
      condition: string;
      description: string | null;
      floors: Array<{
        id: string;
        name: string;
        capacity: number;
        condition: string;
        description: string | null;
        rooms: Array<{
          id: string;
          name: string;
          capacity: number;
          condition: string;
          description: string | null;
        }>;
      }>;
    }>;
  }>;
}

/** Standard API error envelope returned by Fastify backend. */
export interface ApiErrorResponse {
  code: string;
  message: string;
  statusCode: number;
  errors?: Array<{ field: string; rule: string; message: string }>;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly fieldErrors?: Array<{ field: string; rule: string; message: string }>;

  constructor(payload: ApiErrorResponse) {
    super(payload.message);
    this.name = 'ApiClientError';
    this.code = payload.code;
    this.statusCode = payload.statusCode;
    this.fieldErrors = payload.errors;
  }
}
