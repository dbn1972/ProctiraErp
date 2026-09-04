/**
 * Prisma Scholarship Repository
 *
 * Production implementation of {@link ScholarshipRepository} backed by
 * PostgreSQL via Prisma. Tenant-scoped reads/writes run inside
 * {@link withTenantTransaction} so the `app.current_tenant_id` RLS variable is
 * bound on the same connection that executes the query; `tenantId` is also kept
 * in every `where` clause as defense-in-depth.
 *
 * JSONB round-trips: program `eligibility`, application `academicRecords` /
 * `financialInfo` / `documents` are cast with {@link Prisma.InputJsonValue} on
 * write and parsed back to typed structures on read.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import type {
  AcademicRecord,
  ApplicationDocument,
  EligibilityCriteria,
  FinancialInfo,
} from './schemas.js';
import type {
  ApplicationFilter,
  ApplicationStatus,
  ComplianceRecordEntity,
  ComplianceStatus,
  ComplianceType,
  DisbursementEntity,
  DisbursementFilter,
  DisbursementFrequency,
  PaymentMethod,
  PaymentStatus,
  ProgramFilter,
  ProgramStatus,
  ScholarshipApplicationEntity,
  ScholarshipProgramEntity,
  ScholarshipRepository,
  UtilizationReportData,
  UtilizationReportFilter,
} from './scholarship-repository.js';

// ─── Row shapes ──────────────────────────────────────────────────────────────

interface ProgramRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  applicationStartDate: string;
  applicationEndDate: string;
  totalSlots: number;
  usedSlots: number;
  amountPerRecipient: number;
  currency: string;
  disbursementFrequency: string;
  eligibility: unknown;
  status: string;
  academicPeriodId: string | null;
  fundingSourceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ApplicationRow {
  id: string;
  tenantId: string;
  programId: string;
  applicantId: string;
  institutionId: string;
  status: string;
  academicRecords: unknown;
  financialInfo: unknown;
  documents: unknown;
  personalStatement: string | null;
  areaId: string | null;
  gender: string | null;
  workflowInstanceId: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DisbursementRow {
  id: string;
  tenantId: string;
  applicationId: string;
  amount: number;
  scheduledDate: string;
  paidDate: string | null;
  paymentStatus: string;
  paymentMethod: string | null;
  transactionReference: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ComplianceRow {
  id: string;
  tenantId: string;
  applicationId: string;
  complianceType: string;
  status: string;
  evaluationDate: string;
  details: string | null;
  evaluatorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── JSON helpers ────────────────────────────────────────────────────────────

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function parseEligibility(value: unknown): EligibilityCriteria {
  return (value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}) as EligibilityCriteria;
}

function parseAcademicRecords(value: unknown): AcademicRecord[] {
  return (Array.isArray(value) ? value : []) as AcademicRecord[];
}

function parseFinancialInfo(value: unknown): FinancialInfo {
  return (value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}) as FinancialInfo;
}

function parseDocuments(value: unknown): ApplicationDocument[] {
  return (Array.isArray(value) ? value : []) as ApplicationDocument[];
}

// ─── Entity mappers ──────────────────────────────────────────────────────────

function toProgramEntity(row: ProgramRow): ScholarshipProgramEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    applicationStartDate: row.applicationStartDate,
    applicationEndDate: row.applicationEndDate,
    totalSlots: row.totalSlots,
    usedSlots: row.usedSlots,
    amountPerRecipient: row.amountPerRecipient,
    currency: row.currency,
    disbursementFrequency: row.disbursementFrequency as DisbursementFrequency,
    eligibility: parseEligibility(row.eligibility),
    status: row.status as ProgramStatus,
    academicPeriodId: row.academicPeriodId,
    fundingSourceId: row.fundingSourceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toApplicationEntity(row: ApplicationRow): ScholarshipApplicationEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    programId: row.programId,
    applicantId: row.applicantId,
    institutionId: row.institutionId,
    status: row.status as ApplicationStatus,
    academicRecords: parseAcademicRecords(row.academicRecords),
    financialInfo: parseFinancialInfo(row.financialInfo),
    documents: parseDocuments(row.documents),
    personalStatement: row.personalStatement,
    areaId: row.areaId,
    gender: row.gender,
    workflowInstanceId: row.workflowInstanceId,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDisbursementEntity(row: DisbursementRow): DisbursementEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    applicationId: row.applicationId,
    amount: row.amount,
    scheduledDate: row.scheduledDate,
    paidDate: row.paidDate,
    paymentStatus: row.paymentStatus as PaymentStatus,
    paymentMethod: (row.paymentMethod as PaymentMethod | null) ?? null,
    transactionReference: row.transactionReference,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toComplianceEntity(row: ComplianceRow): ComplianceRecordEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    applicationId: row.applicationId,
    complianceType: row.complianceType as ComplianceType,
    status: row.status as ComplianceStatus,
    evaluationDate: row.evaluationDate,
    details: row.details,
    evaluatorId: row.evaluatorId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Pagination helpers ──────────────────────────────────────────────────────

const PROGRAM_SORTABLE = new Set([
  'createdAt',
  'updatedAt',
  'name',
  'status',
  'applicationStartDate',
  'applicationEndDate',
  'totalSlots',
  'usedSlots',
]);

const APPLICATION_SORTABLE = new Set([
  'createdAt',
  'updatedAt',
  'submittedAt',
  'reviewedAt',
  'status',
]);

const DISBURSEMENT_SORTABLE = new Set([
  'scheduledDate',
  'paidDate',
  'createdAt',
  'updatedAt',
  'amount',
  'paymentStatus',
]);

function pageWindow(pagination: PaginationOptions): {
  page: number;
  pageSize: number;
  skip: number;
} {
  const page = Math.max(1, pagination.page ?? 1);
  const pageSize = Math.max(1, pagination.pageSize ?? 20);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function orderBy(
  pagination: PaginationOptions,
  sortable: Set<string>,
  defaultField: string,
  defaultOrder: 'asc' | 'desc' = 'desc',
): Record<string, 'asc' | 'desc'> {
  const sortBy =
    pagination.sortBy && sortable.has(pagination.sortBy)
      ? pagination.sortBy
      : defaultField;
  const sortOrder = pagination.sortOrder ?? defaultOrder;
  return { [sortBy]: sortOrder };
}

function groupKeyForApp(
  app: ScholarshipApplicationEntity,
  groupBy: UtilizationReportFilter['groupBy'],
): string {
  switch (groupBy) {
    case 'area':
      return app.areaId ?? 'unknown';
    case 'gender':
      return app.gender ?? 'unknown';
    case 'institution':
      return app.institutionId;
    case 'program':
    default:
      return app.programId;
  }
}

export class PrismaScholarshipRepository implements ScholarshipRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── Program Operations ──────────────────────────────────────────────────

  async createProgram(
    data: Omit<ScholarshipProgramEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ScholarshipProgramEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.scholarshipProgram.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          name: data.name,
          description: data.description,
          applicationStartDate: data.applicationStartDate,
          applicationEndDate: data.applicationEndDate,
          totalSlots: data.totalSlots,
          usedSlots: data.usedSlots,
          amountPerRecipient: data.amountPerRecipient,
          currency: data.currency,
          disbursementFrequency: data.disbursementFrequency,
          eligibility: toJsonValue(data.eligibility),
          status: data.status,
          academicPeriodId: data.academicPeriodId,
          fundingSourceId: data.fundingSourceId,
        },
      })) as ProgramRow;
      return toProgramEntity(row);
    });
  }

  async updateProgram(
    id: string,
    tenantId: string,
    data: Partial<ScholarshipProgramEntity>,
  ): Promise<ScholarshipProgramEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.scholarshipProgram.findFirst({
        where: { id, tenantId },
      })) as ProgramRow | null;
      if (!existing) return null;

      const updateData: Prisma.ScholarshipProgramUpdateInput = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.applicationStartDate !== undefined) {
        updateData.applicationStartDate = data.applicationStartDate;
      }
      if (data.applicationEndDate !== undefined) {
        updateData.applicationEndDate = data.applicationEndDate;
      }
      if (data.totalSlots !== undefined) updateData.totalSlots = data.totalSlots;
      if (data.usedSlots !== undefined) updateData.usedSlots = data.usedSlots;
      if (data.amountPerRecipient !== undefined) {
        updateData.amountPerRecipient = data.amountPerRecipient;
      }
      if (data.currency !== undefined) updateData.currency = data.currency;
      if (data.disbursementFrequency !== undefined) {
        updateData.disbursementFrequency = data.disbursementFrequency;
      }
      if (data.eligibility !== undefined) {
        updateData.eligibility = toJsonValue(data.eligibility);
      }
      if (data.status !== undefined) updateData.status = data.status;
      if (data.academicPeriodId !== undefined) {
        updateData.academicPeriodId = data.academicPeriodId;
      }
      if (data.fundingSourceId !== undefined) {
        updateData.fundingSourceId = data.fundingSourceId;
      }

      const row = (await tx.scholarshipProgram.update({
        where: { id },
        data: updateData,
      })) as ProgramRow;
      return toProgramEntity(row);
    });
  }

  async findProgramById(
    id: string,
    tenantId: string,
  ): Promise<ScholarshipProgramEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.scholarshipProgram.findFirst({
        where: { id, tenantId },
      })) as ProgramRow | null;
      return row ? toProgramEntity(row) : null;
    });
  }

  async listPrograms(
    tenantId: string,
    filter: ProgramFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScholarshipProgramEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.ScholarshipProgramWhereInput = { tenantId };
      if (filter.status) where.status = filter.status;
      if (filter.search) {
        where.name = { contains: filter.search, mode: 'insensitive' };
      }

      const { page, pageSize, skip } = pageWindow(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.scholarshipProgram.count({ where }),
        tx.scholarshipProgram.findMany({
          where,
          orderBy: orderBy(pagination, PROGRAM_SORTABLE, 'createdAt', 'desc'),
          skip,
          take: pageSize,
        }) as Promise<ProgramRow[]>,
      ]);

      return {
        data: rows.map(toProgramEntity),
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize) || 1,
        },
      };
    });
  }

  async deleteProgram(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = await tx.scholarshipProgram.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!existing) return false;
      await tx.scholarshipProgram.delete({ where: { id } });
      return true;
    });
  }

  // ─── Application Operations ──────────────────────────────────────────────

  async createApplication(
    data: Omit<ScholarshipApplicationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ScholarshipApplicationEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.scholarshipApplication.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          programId: data.programId,
          applicantId: data.applicantId,
          institutionId: data.institutionId,
          status: data.status,
          academicRecords: toJsonValue(data.academicRecords),
          financialInfo: toJsonValue(data.financialInfo),
          documents: toJsonValue(data.documents),
          personalStatement: data.personalStatement,
          areaId: data.areaId,
          gender: data.gender,
          workflowInstanceId: data.workflowInstanceId,
          submittedAt: data.submittedAt,
          reviewedAt: data.reviewedAt,
        },
      })) as ApplicationRow;
      return toApplicationEntity(row);
    });
  }

  async updateApplication(
    id: string,
    tenantId: string,
    data: Partial<ScholarshipApplicationEntity>,
  ): Promise<ScholarshipApplicationEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.scholarshipApplication.findFirst({
        where: { id, tenantId },
      })) as ApplicationRow | null;
      if (!existing) return null;

      const updateData: Prisma.ScholarshipApplicationUpdateInput = {};
      if (data.programId !== undefined) updateData.programId = data.programId;
      if (data.applicantId !== undefined) updateData.applicantId = data.applicantId;
      if (data.institutionId !== undefined) {
        updateData.institutionId = data.institutionId;
      }
      if (data.status !== undefined) updateData.status = data.status;
      if (data.academicRecords !== undefined) {
        updateData.academicRecords = toJsonValue(data.academicRecords);
      }
      if (data.financialInfo !== undefined) {
        updateData.financialInfo = toJsonValue(data.financialInfo);
      }
      if (data.documents !== undefined) {
        updateData.documents = toJsonValue(data.documents);
      }
      if (data.personalStatement !== undefined) {
        updateData.personalStatement = data.personalStatement;
      }
      if (data.areaId !== undefined) updateData.areaId = data.areaId;
      if (data.gender !== undefined) updateData.gender = data.gender;
      if (data.workflowInstanceId !== undefined) {
        updateData.workflowInstanceId = data.workflowInstanceId;
      }
      if (data.submittedAt !== undefined) updateData.submittedAt = data.submittedAt;
      if (data.reviewedAt !== undefined) updateData.reviewedAt = data.reviewedAt;

      const row = (await tx.scholarshipApplication.update({
        where: { id },
        data: updateData,
      })) as ApplicationRow;
      return toApplicationEntity(row);
    });
  }

  async findApplicationById(
    id: string,
    tenantId: string,
  ): Promise<ScholarshipApplicationEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.scholarshipApplication.findFirst({
        where: { id, tenantId },
      })) as ApplicationRow | null;
      return row ? toApplicationEntity(row) : null;
    });
  }

  async listApplications(
    tenantId: string,
    filter: ApplicationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScholarshipApplicationEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.ScholarshipApplicationWhereInput = { tenantId };
      if (filter.programId) where.programId = filter.programId;
      if (filter.applicantId) where.applicantId = filter.applicantId;
      if (filter.institutionId) where.institutionId = filter.institutionId;
      if (filter.status) where.status = filter.status;
      if (filter.areaId) where.areaId = filter.areaId;
      if (filter.gender) where.gender = filter.gender;

      const { page, pageSize, skip } = pageWindow(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.scholarshipApplication.count({ where }),
        tx.scholarshipApplication.findMany({
          where,
          orderBy: orderBy(pagination, APPLICATION_SORTABLE, 'createdAt', 'desc'),
          skip,
          take: pageSize,
        }) as Promise<ApplicationRow[]>,
      ]);

      return {
        data: rows.map(toApplicationEntity),
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize) || 1,
        },
      };
    });
  }

  async countApplicationsByProgram(
    programId: string,
    tenantId: string,
  ): Promise<number> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      return tx.scholarshipApplication.count({
        where: {
          tenantId,
          programId,
          status: { notIn: ['withdrawn', 'rejected'] },
        },
      });
    });
  }

  async findApplicationByApplicantAndProgram(
    applicantId: string,
    programId: string,
    tenantId: string,
  ): Promise<ScholarshipApplicationEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.scholarshipApplication.findFirst({
        where: {
          tenantId,
          applicantId,
          programId,
          status: { not: 'withdrawn' },
        },
      })) as ApplicationRow | null;
      return row ? toApplicationEntity(row) : null;
    });
  }

  // ─── Disbursement Operations ─────────────────────────────────────────────

  async createDisbursement(
    data: Omit<DisbursementEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<DisbursementEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.scholarshipDisbursement.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          applicationId: data.applicationId,
          amount: data.amount,
          scheduledDate: data.scheduledDate,
          paidDate: data.paidDate,
          paymentStatus: data.paymentStatus,
          paymentMethod: data.paymentMethod,
          transactionReference: data.transactionReference,
          notes: data.notes,
        },
      })) as DisbursementRow;
      return toDisbursementEntity(row);
    });
  }

  async updateDisbursement(
    id: string,
    tenantId: string,
    data: Partial<DisbursementEntity>,
  ): Promise<DisbursementEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.scholarshipDisbursement.findFirst({
        where: { id, tenantId },
      })) as DisbursementRow | null;
      if (!existing) return null;

      const updateData: Prisma.ScholarshipDisbursementUpdateInput = {};
      if (data.applicationId !== undefined) {
        updateData.applicationId = data.applicationId;
      }
      if (data.amount !== undefined) updateData.amount = data.amount;
      if (data.scheduledDate !== undefined) {
        updateData.scheduledDate = data.scheduledDate;
      }
      if (data.paidDate !== undefined) updateData.paidDate = data.paidDate;
      if (data.paymentStatus !== undefined) {
        updateData.paymentStatus = data.paymentStatus;
      }
      if (data.paymentMethod !== undefined) {
        updateData.paymentMethod = data.paymentMethod;
      }
      if (data.transactionReference !== undefined) {
        updateData.transactionReference = data.transactionReference;
      }
      if (data.notes !== undefined) updateData.notes = data.notes;

      const row = (await tx.scholarshipDisbursement.update({
        where: { id },
        data: updateData,
      })) as DisbursementRow;
      return toDisbursementEntity(row);
    });
  }

  async findDisbursementById(
    id: string,
    tenantId: string,
  ): Promise<DisbursementEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.scholarshipDisbursement.findFirst({
        where: { id, tenantId },
      })) as DisbursementRow | null;
      return row ? toDisbursementEntity(row) : null;
    });
  }

  async listDisbursements(
    tenantId: string,
    filter: DisbursementFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DisbursementEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.ScholarshipDisbursementWhereInput = { tenantId };
      if (filter.applicationId) where.applicationId = filter.applicationId;
      if (filter.paymentStatus) where.paymentStatus = filter.paymentStatus;
      if (filter.scheduledDateFrom || filter.scheduledDateTo) {
        where.scheduledDate = {};
        if (filter.scheduledDateFrom) {
          where.scheduledDate.gte = filter.scheduledDateFrom;
        }
        if (filter.scheduledDateTo) {
          where.scheduledDate.lte = filter.scheduledDateTo;
        }
      }

      const { page, pageSize, skip } = pageWindow(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.scholarshipDisbursement.count({ where }),
        tx.scholarshipDisbursement.findMany({
          where,
          orderBy: orderBy(
            pagination,
            DISBURSEMENT_SORTABLE,
            'scheduledDate',
            'asc',
          ),
          skip,
          take: pageSize,
        }) as Promise<DisbursementRow[]>,
      ]);

      return {
        data: rows.map(toDisbursementEntity),
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize) || 1,
        },
      };
    });
  }

  async listDisbursementsByApplication(
    applicationId: string,
    tenantId: string,
  ): Promise<DisbursementEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.scholarshipDisbursement.findMany({
        where: { tenantId, applicationId },
        orderBy: { scheduledDate: 'asc' },
      })) as DisbursementRow[];
      return rows.map(toDisbursementEntity);
    });
  }

  // ─── Compliance Operations ───────────────────────────────────────────────

  async createComplianceRecord(
    data: Omit<ComplianceRecordEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ComplianceRecordEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.scholarshipComplianceRecord.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          applicationId: data.applicationId,
          complianceType: data.complianceType,
          status: data.status,
          evaluationDate: data.evaluationDate,
          details: data.details,
          evaluatorId: data.evaluatorId,
        },
      })) as ComplianceRow;
      return toComplianceEntity(row);
    });
  }

  async listComplianceRecords(
    applicationId: string,
    tenantId: string,
  ): Promise<ComplianceRecordEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.scholarshipComplianceRecord.findMany({
        where: { tenantId, applicationId },
        orderBy: { evaluationDate: 'desc' },
      })) as ComplianceRow[];
      return rows.map(toComplianceEntity);
    });
  }

  // ─── Report Operations ───────────────────────────────────────────────────

  async getUtilizationReport(
    tenantId: string,
    filter: UtilizationReportFilter,
  ): Promise<UtilizationReportData> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const programs = (await tx.scholarshipProgram.findMany({
        where: { tenantId },
      })) as ProgramRow[];

      const appWhere: Prisma.ScholarshipApplicationWhereInput = { tenantId };
      if (filter.programId) appWhere.programId = filter.programId;
      if (filter.areaId) appWhere.areaId = filter.areaId;
      if (filter.gender) appWhere.gender = filter.gender;
      if (filter.institutionId) appWhere.institutionId = filter.institutionId;
      // startDate/endDate are present on the filter type but unused by the
      // in-memory implementation; keep equivalent behaviour here.

      const apps = (
        (await tx.scholarshipApplication.findMany({
          where: appWhere,
        })) as ApplicationRow[]
      ).map(toApplicationEntity);

      const approvedApps = apps.filter((a) => a.status === 'approved');
      const approvedAppIds = approvedApps.map((a) => a.id);

      const paidDisbursements =
        approvedAppIds.length === 0
          ? []
          : (
              (await tx.scholarshipDisbursement.findMany({
                where: {
                  tenantId,
                  applicationId: { in: approvedAppIds },
                  paymentStatus: 'paid',
                },
              })) as DisbursementRow[]
            ).map(toDisbursementEntity);

      const totalAmount = paidDisbursements.reduce((sum, d) => sum + d.amount, 0);
      const currency =
        programs.length > 0 && programs[0] ? programs[0].currency : 'USD';

      const groupBy = filter.groupBy ?? 'program';
      const groupMap = new Map<
        string,
        { applicationCount: number; approvedCount: number; disbursedAmount: number }
      >();

      const appById = new Map(apps.map((a) => [a.id, a]));

      for (const app of apps) {
        const key = groupKeyForApp(app, groupBy);
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            applicationCount: 0,
            approvedCount: 0,
            disbursedAmount: 0,
          });
        }
        const group = groupMap.get(key)!;
        group.applicationCount++;
        if (app.status === 'approved') {
          group.approvedCount++;
        }
      }

      for (const d of paidDisbursements) {
        const app = appById.get(d.applicationId);
        if (!app) continue;
        const key = groupKeyForApp(app, groupBy);
        const group = groupMap.get(key);
        if (group) {
          group.disbursedAmount += d.amount;
        }
      }

      const breakdown = Array.from(groupMap.entries()).map(([key, data]) => ({
        groupKey: groupBy,
        groupValue: key,
        applicationCount: data.applicationCount,
        approvedCount: data.approvedCount,
        disbursedAmount: data.disbursedAmount,
        utilizationRate:
          data.applicationCount > 0
            ? Math.round((data.approvedCount / data.applicationCount) * 10000) /
              100
            : 0,
      }));

      return {
        totalPrograms: programs.length,
        totalApplications: apps.length,
        totalApproved: approvedApps.length,
        totalDisbursed: paidDisbursements.length,
        totalAmount,
        currency,
        breakdown,
      };
    });
  }
}
