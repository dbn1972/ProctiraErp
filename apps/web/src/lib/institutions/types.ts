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

export interface AcademicPeriod {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  status: AcademicPeriodStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAcademicPeriodInput {
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  status?: AcademicPeriodStatus;
}

export type UpdateAcademicPeriodInput = Partial<CreateAcademicPeriodInput>;

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

export interface CreateClassInput {
  institutionId: string;
  gradeId: string;
  academicPeriodId: string;
  name: string;
  capacity?: number;
}

export interface CreateGradeInput {
  name: string;
  code: string;
  order: number;
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
