/**
 * Prisma Staff Training Repositories
 *
 * Production implementations of training program/session/attendance and
 * certification repositories, RLS-safe through {@link withTenantTransaction}.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withTenantTransaction } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';

import type {
  TrainingProgramEntity,
  TrainingSessionEntity,
  TrainingAttendanceEntity,
  CertificationEntity,
  CertificationFilter,
  TrainingProgramRepository,
  TrainingSessionRepository,
  TrainingAttendanceRepository,
  CertificationRepository,
} from './training-repository.js';

interface TrainingProgramRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  provider: string | null;
  certificationName: string | null;
  certificationValidityDays: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TrainingSessionRow {
  id: string;
  tenantId: string;
  programId: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  instructorName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TrainingAttendanceRow {
  id: string;
  tenantId: string;
  sessionId: string;
  staffId: string;
  status: string;
  comment: string | null;
  createdAt: Date;
}

interface CertificationRow {
  id: string;
  tenantId: string;
  staffId: string;
  programId: string;
  certificationName: string;
  issuedDate: string;
  expiryDate: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function toProgramEntity(row: TrainingProgramRow): TrainingProgramEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    startDate: row.startDate,
    endDate: row.endDate,
    provider: row.provider,
    certificationName: row.certificationName,
    certificationValidityDays: row.certificationValidityDays,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSessionEntity(row: TrainingSessionRow): TrainingSessionEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    programId: row.programId,
    title: row.title,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    location: row.location,
    instructorName: row.instructorName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAttendanceEntity(row: TrainingAttendanceRow): TrainingAttendanceEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sessionId: row.sessionId,
    staffId: row.staffId,
    status: row.status as TrainingAttendanceEntity['status'],
    comment: row.comment,
    createdAt: row.createdAt,
  };
}

function toCertificationEntity(row: CertificationRow): CertificationEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    programId: row.programId,
    certificationName: row.certificationName,
    issuedDate: row.issuedDate,
    expiryDate: row.expiryDate,
    status: row.status as CertificationEntity['status'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaTrainingProgramRepository implements TrainingProgramRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<TrainingProgramEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TrainingProgramEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.staffTrainingProgram.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          name: data.name,
          description: data.description,
          startDate: data.startDate,
          endDate: data.endDate,
          provider: data.provider,
          certificationName: data.certificationName,
          certificationValidityDays: data.certificationValidityDays,
        },
      })) as TrainingProgramRow;
      return toProgramEntity(row);
    });
  }

  async findById(id: string, tenantId: string): Promise<TrainingProgramEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.staffTrainingProgram.findFirst({
        where: { id, tenantId },
      })) as TrainingProgramRow | null;
      return row ? toProgramEntity(row) : null;
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<TrainingProgramEntity>,
  ): Promise<TrainingProgramEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.staffTrainingProgram.findFirst({
        where: { id, tenantId },
      })) as TrainingProgramRow | null;
      if (!existing) return null;

      const current = toProgramEntity(existing);
      const merged: TrainingProgramEntity = { ...current };
      const mergedRecord = merged as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        if (key === 'id' || key === 'tenantId' || key === 'createdAt' || key === 'updatedAt') {
          continue;
        }
        mergedRecord[key] = value;
      }

      const row = (await tx.staffTrainingProgram.update({
        where: { id },
        data: {
          name: merged.name,
          description: merged.description,
          startDate: merged.startDate,
          endDate: merged.endDate,
          provider: merged.provider,
          certificationName: merged.certificationName,
          certificationValidityDays: merged.certificationValidityDays,
        },
      })) as TrainingProgramRow;
      return toProgramEntity(row);
    });
  }

  async list(
    tenantId: string,
    search: string | undefined,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TrainingProgramEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Record<string, unknown> = { tenantId };
      if (search) {
        where['name'] = { contains: search, mode: 'insensitive' };
      }

      const page = pagination.page;
      const pageSize = pagination.pageSize;

      const [totalItems, rows] = await Promise.all([
        tx.staffTrainingProgram.count({ where }),
        tx.staffTrainingProgram.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }) as Promise<TrainingProgramRow[]>,
      ]);

      return {
        data: rows.map(toProgramEntity),
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
        },
      };
    });
  }
}

export class PrismaTrainingSessionRepository implements TrainingSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<TrainingSessionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TrainingSessionEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.staffTrainingSession.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          programId: data.programId,
          title: data.title,
          date: data.date,
          startTime: data.startTime,
          endTime: data.endTime,
          location: data.location,
          instructorName: data.instructorName,
        },
      })) as TrainingSessionRow;
      return toSessionEntity(row);
    });
  }

  async findById(id: string, tenantId: string): Promise<TrainingSessionEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.staffTrainingSession.findFirst({
        where: { id, tenantId },
      })) as TrainingSessionRow | null;
      return row ? toSessionEntity(row) : null;
    });
  }

  async listByProgram(
    tenantId: string,
    programId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TrainingSessionEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId, programId };
      const page = pagination.page;
      const pageSize = pagination.pageSize;

      const [totalItems, rows] = await Promise.all([
        tx.staffTrainingSession.count({ where }),
        tx.staffTrainingSession.findMany({
          where,
          orderBy: { date: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }) as Promise<TrainingSessionRow[]>,
      ]);

      return {
        data: rows.map(toSessionEntity),
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
        },
      };
    });
  }
}

export class PrismaTrainingAttendanceRepository implements TrainingAttendanceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<TrainingAttendanceEntity, 'createdAt'>,
  ): Promise<TrainingAttendanceEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.staffTrainingAttendance.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          sessionId: data.sessionId,
          staffId: data.staffId,
          status: data.status,
          comment: data.comment,
        },
      })) as TrainingAttendanceRow;
      return toAttendanceEntity(row);
    });
  }

  async findBySessionAndStaff(
    sessionId: string,
    staffId: string,
    tenantId: string,
  ): Promise<TrainingAttendanceEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.staffTrainingAttendance.findFirst({
        where: { tenantId, sessionId, staffId },
      })) as TrainingAttendanceRow | null;
      return row ? toAttendanceEntity(row) : null;
    });
  }

  async listBySession(tenantId: string, sessionId: string): Promise<TrainingAttendanceEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.staffTrainingAttendance.findMany({
        where: { tenantId, sessionId },
        orderBy: { createdAt: 'asc' },
      })) as TrainingAttendanceRow[];
      return rows.map(toAttendanceEntity);
    });
  }

  async listByStaff(tenantId: string, staffId: string): Promise<TrainingAttendanceEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.staffTrainingAttendance.findMany({
        where: { tenantId, staffId },
        orderBy: { createdAt: 'asc' },
      })) as TrainingAttendanceRow[];
      return rows.map(toAttendanceEntity);
    });
  }
}

export class PrismaCertificationRepository implements CertificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<CertificationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CertificationEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.staffCertification.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          staffId: data.staffId,
          programId: data.programId,
          certificationName: data.certificationName,
          issuedDate: data.issuedDate,
          expiryDate: data.expiryDate,
          status: data.status,
        },
      })) as CertificationRow;
      return toCertificationEntity(row);
    });
  }

  async findById(id: string, tenantId: string): Promise<CertificationEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.staffCertification.findFirst({
        where: { id, tenantId },
      })) as CertificationRow | null;
      return row ? toCertificationEntity(row) : null;
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<CertificationEntity>,
  ): Promise<CertificationEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.staffCertification.findFirst({
        where: { id, tenantId },
      })) as CertificationRow | null;
      if (!existing) return null;

      const current = toCertificationEntity(existing);
      const merged: CertificationEntity = { ...current };
      const mergedRecord = merged as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        if (key === 'id' || key === 'tenantId' || key === 'createdAt' || key === 'updatedAt') {
          continue;
        }
        mergedRecord[key] = value;
      }

      const row = (await tx.staffCertification.update({
        where: { id },
        data: {
          staffId: merged.staffId,
          programId: merged.programId,
          certificationName: merged.certificationName,
          issuedDate: merged.issuedDate,
          expiryDate: merged.expiryDate,
          status: merged.status,
        },
      })) as CertificationRow;
      return toCertificationEntity(row);
    });
  }

  async list(
    tenantId: string,
    filter: CertificationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<CertificationEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Record<string, unknown> = { tenantId };
      if (filter.staffId) where['staffId'] = filter.staffId;
      if (filter.status) where['status'] = filter.status;
      if (filter.programId) where['programId'] = filter.programId;

      const page = pagination.page;
      const pageSize = pagination.pageSize;

      const [totalItems, rows] = await Promise.all([
        tx.staffCertification.count({ where }),
        tx.staffCertification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }) as Promise<CertificationRow[]>,
      ]);

      return {
        data: rows.map(toCertificationEntity),
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
        },
      };
    });
  }

  async findExpiredCertifications(
    tenantId: string,
    asOfDate: string,
  ): Promise<CertificationEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.staffCertification.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
          expiryDate: { not: null, lte: asOfDate },
        },
      })) as CertificationRow[];
      return rows.map(toCertificationEntity);
    });
  }
}
