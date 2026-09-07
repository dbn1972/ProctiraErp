/**
 * Type definitions matching Prisma model shapes for test factories.
 * These mirror the expected database schema for core entities.
 */

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain: string;
  status: string;
  config: TenantConfig;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface TenantConfig {
  locale: string;
  timezone: string;
  dateFormat: string;
  academicYearStart: number;
  features: Record<string, boolean>;
}

export interface Area {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  level: number;
  parentId: string | null;
  isLeaf: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Education board under a tenant (NATIONAL / STATE / PRIVATE). */
export type BoardType = 'NATIONAL' | 'STATE' | 'PRIVATE';

export interface Board {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  type: BoardType;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface Institution {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  /** Owning education board (optional for legacy factories). */
  boardId: string | null;
  areaId: string;
  typeId: string;
  sectorId: string;
  ownershipId: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  customData: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface Student {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  gender: string;
  nationalId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  nationality: string | null;
  photoUrl: string | null;
  customData: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface Staff {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  gender: string;
  identityNumber: string;
  email: string;
  phone: string;
  position: string;
  address: string | null;
  customData: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface Enrollment {
  id: string;
  tenantId: string;
  studentId: string;
  institutionId: string;
  academicPeriodId: string;
  status: string;
  startDate: Date;
  endDate: Date | null;
  gradeId: string | null;
  classId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AcademicPeriod {
  id: string;
  tenantId: string;
  institutionId: string;
  name: string;
  code: string;
  startDate: Date;
  endDate: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}
