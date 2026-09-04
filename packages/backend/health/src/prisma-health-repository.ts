/**
 * Prisma Health Repository
 *
 * Production implementation of {@link HealthRepository} backed by PostgreSQL
 * via Prisma. Tenant-scoped reads/writes run inside {@link withTenantTransaction}
 * so the `app.current_tenant_id` RLS variable is bound on the same connection
 * that executes the query; `tenantId` is also kept in every `where` clause as
 * defense-in-depth.
 *
 * Schema notes:
 *  - Date-like fields are stored as `VarChar` (ISO date strings) — no Date
 *    conversion is required on the way in or out.
 *  - Insurance maps to the `InsurancePolicy` Prisma model (`insurancePolicy`).
 *  - `accommodations` and `assessmentTypes` are JSONB arrays.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import type {
  AccommodationItem,
  AccommodationPlanEntity,
  AllergyEntity,
  CounsellingSessionEntity,
  DiagnosisEntity,
  HealthConditionEntity,
  HealthMeasurementEntity,
  HealthRepository,
  InsuranceEntity,
  ReferralEntity,
  ScreeningProgramEntity,
  SpecialNeedsAssessmentEntity,
  VaccinationEntity,
} from './health-repository.js';

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function paginateMeta(
  totalItems: number,
  pagination: PaginationOptions,
): PaginatedResult<never>['meta'] {
  const page = Math.max(1, pagination.page);
  const pageSize = Math.max(1, pagination.pageSize);
  return {
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}

function pageArgs(pagination: PaginationOptions): { skip: number; take: number; page: number; pageSize: number } {
  const page = Math.max(1, pagination.page);
  const pageSize = Math.max(1, pagination.pageSize);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

type MeasurementRow = {
  id: string;
  tenantId: string;
  studentId: string;
  date: string;
  height: number | null;
  weight: number | null;
  bmi: number | null;
  bloodPressureSystolic: number | null;
  bloodPressureDiastolic: number | null;
  heartRate: number | null;
  visionLeft: string | null;
  visionRight: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AllergyRow = {
  id: string;
  tenantId: string;
  studentId: string;
  allergyType: string;
  description: string;
  severity: string;
  reaction: string | null;
  treatment: string | null;
  diagnosedDate: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ConditionRow = {
  id: string;
  tenantId: string;
  studentId: string;
  conditionName: string;
  conditionType: string;
  diagnosedDate: string | null;
  status: string;
  treatment: string | null;
  medication: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type VaccinationRow = {
  id: string;
  tenantId: string;
  studentId: string;
  vaccineName: string;
  doseNumber: number;
  dateAdministered: string;
  administeredBy: string | null;
  batchNumber: string | null;
  nextDueDate: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type InsuranceRow = {
  id: string;
  tenantId: string;
  studentId: string;
  provider: string;
  policyNumber: string;
  coverageType: string;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AssessmentRow = {
  id: string;
  tenantId: string;
  studentId: string;
  assessmentDate: string;
  assessorName: string;
  assessorRole: string;
  assessmentType: string;
  findings: string;
  recommendations: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type DiagnosisRow = {
  id: string;
  tenantId: string;
  studentId: string;
  assessmentId: string | null;
  diagnosisDate: string;
  diagnosedBy: string;
  condition: string;
  category: string;
  severity: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ReferralRow = {
  id: string;
  tenantId: string;
  studentId: string;
  diagnosisId: string | null;
  referralDate: string;
  referredBy: string;
  referredTo: string;
  reason: string;
  status: string;
  appointmentDate: string | null;
  outcome: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AccommodationPlanRow = {
  id: string;
  tenantId: string;
  studentId: string;
  diagnosisId: string | null;
  planName: string;
  startDate: string;
  endDate: string | null;
  accommodations: unknown;
  reviewDate: string | null;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type CounsellingSessionRow = {
  id: string;
  tenantId: string;
  studentId: string;
  counsellorId: string;
  sessionDate: string;
  sessionType: string;
  reason: string;
  caseNotes: string;
  outcome: string | null;
  followUpRequired: boolean;
  followUpDate: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type ScreeningProgramRow = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  gradeLevel: string;
  academicPeriodId: string;
  assessmentTypes: unknown;
  scheduledDate: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

function toMeasurement(row: MeasurementRow): HealthMeasurementEntity {
  return { ...row };
}

function toAllergy(row: AllergyRow): AllergyEntity {
  return { ...row };
}

function toCondition(row: ConditionRow): HealthConditionEntity {
  return { ...row };
}

function toVaccination(row: VaccinationRow): VaccinationEntity {
  return { ...row };
}

function toInsurance(row: InsuranceRow): InsuranceEntity {
  return { ...row };
}

function toAssessment(row: AssessmentRow): SpecialNeedsAssessmentEntity {
  return { ...row };
}

function toDiagnosis(row: DiagnosisRow): DiagnosisEntity {
  return { ...row };
}

function toReferral(row: ReferralRow): ReferralEntity {
  return { ...row };
}

function toAccommodationPlan(row: AccommodationPlanRow): AccommodationPlanEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    diagnosisId: row.diagnosisId,
    planName: row.planName,
    startDate: row.startDate,
    endDate: row.endDate,
    accommodations: jsonArray<AccommodationItem>(row.accommodations),
    reviewDate: row.reviewDate,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCounsellingSession(row: CounsellingSessionRow): CounsellingSessionEntity {
  return { ...row };
}

function toScreeningProgram(row: ScreeningProgramRow): ScreeningProgramEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    gradeLevel: row.gradeLevel,
    academicPeriodId: row.academicPeriodId,
    assessmentTypes: jsonArray<string>(row.assessmentTypes),
    scheduledDate: row.scheduledDate,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaHealthRepository implements HealthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── Measurements ─────────────────────────────────────────────────────────

  async createMeasurement(
    data: Omit<HealthMeasurementEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HealthMeasurementEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.healthMeasurement.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          date: data.date,
          height: data.height,
          weight: data.weight,
          bmi: data.bmi,
          bloodPressureSystolic: data.bloodPressureSystolic,
          bloodPressureDiastolic: data.bloodPressureDiastolic,
          heartRate: data.heartRate,
          visionLeft: data.visionLeft,
          visionRight: data.visionRight,
          notes: data.notes,
        },
      })) as MeasurementRow;
      return toMeasurement(row);
    });
  }

  async updateMeasurement(
    id: string,
    tenantId: string,
    data: Partial<HealthMeasurementEntity>,
  ): Promise<HealthMeasurementEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.healthMeasurement.findFirst({
        where: { id, tenantId },
      })) as MeasurementRow | null;
      if (!existing) return null;

      const updateData: Prisma.HealthMeasurementUpdateInput = {};
      if (data.date !== undefined) updateData.date = data.date;
      if (data.height !== undefined) updateData.height = data.height;
      if (data.weight !== undefined) updateData.weight = data.weight;
      if (data.bmi !== undefined) updateData.bmi = data.bmi;
      if (data.bloodPressureSystolic !== undefined) {
        updateData.bloodPressureSystolic = data.bloodPressureSystolic;
      }
      if (data.bloodPressureDiastolic !== undefined) {
        updateData.bloodPressureDiastolic = data.bloodPressureDiastolic;
      }
      if (data.heartRate !== undefined) updateData.heartRate = data.heartRate;
      if (data.visionLeft !== undefined) updateData.visionLeft = data.visionLeft;
      if (data.visionRight !== undefined) updateData.visionRight = data.visionRight;
      if (data.notes !== undefined) updateData.notes = data.notes;

      const row = (await tx.healthMeasurement.update({
        where: { id },
        data: updateData,
      })) as MeasurementRow;
      return toMeasurement(row);
    });
  }

  async findMeasurementById(
    id: string,
    tenantId: string,
  ): Promise<HealthMeasurementEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.healthMeasurement.findFirst({
        where: { id, tenantId },
      })) as MeasurementRow | null;
      return row ? toMeasurement(row) : null;
    });
  }

  async listMeasurementsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<HealthMeasurementEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId, studentId };
      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.healthMeasurement.count({ where }),
        tx.healthMeasurement.findMany({
          where,
          orderBy: { date: 'desc' },
          skip,
          take,
        }) as Promise<MeasurementRow[]>,
      ]);
      return {
        data: rows.map(toMeasurement),
        meta: paginateMeta(totalItems, { page, pageSize }),
      };
    });
  }

  async deleteMeasurement(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.healthMeasurement.deleteMany({ where: { id, tenantId } });
      return result.count > 0;
    });
  }

  // ─── Allergies ────────────────────────────────────────────────────────────

  async createAllergy(
    data: Omit<AllergyEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AllergyEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.allergy.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          allergyType: data.allergyType,
          description: data.description,
          severity: data.severity,
          reaction: data.reaction,
          treatment: data.treatment,
          diagnosedDate: data.diagnosedDate,
        },
      })) as AllergyRow;
      return toAllergy(row);
    });
  }

  async updateAllergy(
    id: string,
    tenantId: string,
    data: Partial<AllergyEntity>,
  ): Promise<AllergyEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.allergy.findFirst({
        where: { id, tenantId },
      })) as AllergyRow | null;
      if (!existing) return null;

      const updateData: Prisma.AllergyUpdateInput = {};
      if (data.allergyType !== undefined) updateData.allergyType = data.allergyType;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.severity !== undefined) updateData.severity = data.severity;
      if (data.reaction !== undefined) updateData.reaction = data.reaction;
      if (data.treatment !== undefined) updateData.treatment = data.treatment;
      if (data.diagnosedDate !== undefined) updateData.diagnosedDate = data.diagnosedDate;

      const row = (await tx.allergy.update({
        where: { id },
        data: updateData,
      })) as AllergyRow;
      return toAllergy(row);
    });
  }

  async findAllergyById(id: string, tenantId: string): Promise<AllergyEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.allergy.findFirst({
        where: { id, tenantId },
      })) as AllergyRow | null;
      return row ? toAllergy(row) : null;
    });
  }

  async listAllergiesByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AllergyEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId, studentId };
      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.allergy.count({ where }),
        tx.allergy.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }) as Promise<AllergyRow[]>,
      ]);
      return {
        data: rows.map(toAllergy),
        meta: paginateMeta(totalItems, { page, pageSize }),
      };
    });
  }

  async deleteAllergy(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.allergy.deleteMany({ where: { id, tenantId } });
      return result.count > 0;
    });
  }

  // ─── Conditions ───────────────────────────────────────────────────────────

  async createCondition(
    data: Omit<HealthConditionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HealthConditionEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.healthCondition.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          conditionName: data.conditionName,
          conditionType: data.conditionType,
          diagnosedDate: data.diagnosedDate,
          status: data.status,
          treatment: data.treatment,
          medication: data.medication,
          notes: data.notes,
        },
      })) as ConditionRow;
      return toCondition(row);
    });
  }

  async updateCondition(
    id: string,
    tenantId: string,
    data: Partial<HealthConditionEntity>,
  ): Promise<HealthConditionEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.healthCondition.findFirst({
        where: { id, tenantId },
      })) as ConditionRow | null;
      if (!existing) return null;

      const updateData: Prisma.HealthConditionUpdateInput = {};
      if (data.conditionName !== undefined) updateData.conditionName = data.conditionName;
      if (data.conditionType !== undefined) updateData.conditionType = data.conditionType;
      if (data.diagnosedDate !== undefined) updateData.diagnosedDate = data.diagnosedDate;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.treatment !== undefined) updateData.treatment = data.treatment;
      if (data.medication !== undefined) updateData.medication = data.medication;
      if (data.notes !== undefined) updateData.notes = data.notes;

      const row = (await tx.healthCondition.update({
        where: { id },
        data: updateData,
      })) as ConditionRow;
      return toCondition(row);
    });
  }

  async findConditionById(
    id: string,
    tenantId: string,
  ): Promise<HealthConditionEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.healthCondition.findFirst({
        where: { id, tenantId },
      })) as ConditionRow | null;
      return row ? toCondition(row) : null;
    });
  }

  async listConditionsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<HealthConditionEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId, studentId };
      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.healthCondition.count({ where }),
        tx.healthCondition.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }) as Promise<ConditionRow[]>,
      ]);
      return {
        data: rows.map(toCondition),
        meta: paginateMeta(totalItems, { page, pageSize }),
      };
    });
  }

  async deleteCondition(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.healthCondition.deleteMany({ where: { id, tenantId } });
      return result.count > 0;
    });
  }

  // ─── Vaccinations ─────────────────────────────────────────────────────────

  async createVaccination(
    data: Omit<VaccinationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<VaccinationEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.vaccination.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          vaccineName: data.vaccineName,
          doseNumber: data.doseNumber,
          dateAdministered: data.dateAdministered,
          administeredBy: data.administeredBy,
          batchNumber: data.batchNumber,
          nextDueDate: data.nextDueDate,
          notes: data.notes,
        },
      })) as VaccinationRow;
      return toVaccination(row);
    });
  }

  async updateVaccination(
    id: string,
    tenantId: string,
    data: Partial<VaccinationEntity>,
  ): Promise<VaccinationEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.vaccination.findFirst({
        where: { id, tenantId },
      })) as VaccinationRow | null;
      if (!existing) return null;

      const updateData: Prisma.VaccinationUpdateInput = {};
      if (data.vaccineName !== undefined) updateData.vaccineName = data.vaccineName;
      if (data.doseNumber !== undefined) updateData.doseNumber = data.doseNumber;
      if (data.dateAdministered !== undefined) {
        updateData.dateAdministered = data.dateAdministered;
      }
      if (data.administeredBy !== undefined) updateData.administeredBy = data.administeredBy;
      if (data.batchNumber !== undefined) updateData.batchNumber = data.batchNumber;
      if (data.nextDueDate !== undefined) updateData.nextDueDate = data.nextDueDate;
      if (data.notes !== undefined) updateData.notes = data.notes;

      const row = (await tx.vaccination.update({
        where: { id },
        data: updateData,
      })) as VaccinationRow;
      return toVaccination(row);
    });
  }

  async findVaccinationById(
    id: string,
    tenantId: string,
  ): Promise<VaccinationEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.vaccination.findFirst({
        where: { id, tenantId },
      })) as VaccinationRow | null;
      return row ? toVaccination(row) : null;
    });
  }

  async listVaccinationsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<VaccinationEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId, studentId };
      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.vaccination.count({ where }),
        tx.vaccination.findMany({
          where,
          orderBy: { dateAdministered: 'desc' },
          skip,
          take,
        }) as Promise<VaccinationRow[]>,
      ]);
      return {
        data: rows.map(toVaccination),
        meta: paginateMeta(totalItems, { page, pageSize }),
      };
    });
  }

  async deleteVaccination(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.vaccination.deleteMany({ where: { id, tenantId } });
      return result.count > 0;
    });
  }

  // ─── Insurance (InsurancePolicy model) ────────────────────────────────────

  async createInsurance(
    data: Omit<InsuranceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<InsuranceEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.insurancePolicy.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          provider: data.provider,
          policyNumber: data.policyNumber,
          coverageType: data.coverageType,
          startDate: data.startDate,
          endDate: data.endDate,
          notes: data.notes,
        },
      })) as InsuranceRow;
      return toInsurance(row);
    });
  }

  async updateInsurance(
    id: string,
    tenantId: string,
    data: Partial<InsuranceEntity>,
  ): Promise<InsuranceEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.insurancePolicy.findFirst({
        where: { id, tenantId },
      })) as InsuranceRow | null;
      if (!existing) return null;

      const updateData: Prisma.InsurancePolicyUpdateInput = {};
      if (data.provider !== undefined) updateData.provider = data.provider;
      if (data.policyNumber !== undefined) updateData.policyNumber = data.policyNumber;
      if (data.coverageType !== undefined) updateData.coverageType = data.coverageType;
      if (data.startDate !== undefined) updateData.startDate = data.startDate;
      if (data.endDate !== undefined) updateData.endDate = data.endDate;
      if (data.notes !== undefined) updateData.notes = data.notes;

      const row = (await tx.insurancePolicy.update({
        where: { id },
        data: updateData,
      })) as InsuranceRow;
      return toInsurance(row);
    });
  }

  async findInsuranceById(id: string, tenantId: string): Promise<InsuranceEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.insurancePolicy.findFirst({
        where: { id, tenantId },
      })) as InsuranceRow | null;
      return row ? toInsurance(row) : null;
    });
  }

  async listInsuranceByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InsuranceEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId, studentId };
      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.insurancePolicy.count({ where }),
        tx.insurancePolicy.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }) as Promise<InsuranceRow[]>,
      ]);
      return {
        data: rows.map(toInsurance),
        meta: paginateMeta(totalItems, { page, pageSize }),
      };
    });
  }

  async deleteInsurance(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.insurancePolicy.deleteMany({ where: { id, tenantId } });
      return result.count > 0;
    });
  }

  // ─── Special Needs Assessments ────────────────────────────────────────────

  async createAssessment(
    data: Omit<SpecialNeedsAssessmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<SpecialNeedsAssessmentEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.specialNeedsAssessment.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          assessmentDate: data.assessmentDate,
          assessorName: data.assessorName,
          assessorRole: data.assessorRole,
          assessmentType: data.assessmentType,
          findings: data.findings,
          recommendations: data.recommendations,
        },
      })) as AssessmentRow;
      return toAssessment(row);
    });
  }

  async findAssessmentById(
    id: string,
    tenantId: string,
  ): Promise<SpecialNeedsAssessmentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.specialNeedsAssessment.findFirst({
        where: { id, tenantId },
      })) as AssessmentRow | null;
      return row ? toAssessment(row) : null;
    });
  }

  async listAssessmentsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SpecialNeedsAssessmentEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId, studentId };
      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.specialNeedsAssessment.count({ where }),
        tx.specialNeedsAssessment.findMany({
          where,
          orderBy: { assessmentDate: 'desc' },
          skip,
          take,
        }) as Promise<AssessmentRow[]>,
      ]);
      return {
        data: rows.map(toAssessment),
        meta: paginateMeta(totalItems, { page, pageSize }),
      };
    });
  }

  // ─── Diagnoses ────────────────────────────────────────────────────────────

  async createDiagnosis(
    data: Omit<DiagnosisEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<DiagnosisEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.diagnosis.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          assessmentId: data.assessmentId,
          diagnosisDate: data.diagnosisDate,
          diagnosedBy: data.diagnosedBy,
          condition: data.condition,
          category: data.category,
          severity: data.severity,
          notes: data.notes,
        },
      })) as DiagnosisRow;
      return toDiagnosis(row);
    });
  }

  async findDiagnosisById(id: string, tenantId: string): Promise<DiagnosisEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.diagnosis.findFirst({
        where: { id, tenantId },
      })) as DiagnosisRow | null;
      return row ? toDiagnosis(row) : null;
    });
  }

  async listDiagnosesByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DiagnosisEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId, studentId };
      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.diagnosis.count({ where }),
        tx.diagnosis.findMany({
          where,
          orderBy: { diagnosisDate: 'desc' },
          skip,
          take,
        }) as Promise<DiagnosisRow[]>,
      ]);
      return {
        data: rows.map(toDiagnosis),
        meta: paginateMeta(totalItems, { page, pageSize }),
      };
    });
  }

  // ─── Referrals ────────────────────────────────────────────────────────────

  async createReferral(
    data: Omit<ReferralEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ReferralEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.referral.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          diagnosisId: data.diagnosisId,
          referralDate: data.referralDate,
          referredBy: data.referredBy,
          referredTo: data.referredTo,
          reason: data.reason,
          status: data.status,
          appointmentDate: data.appointmentDate,
          outcome: data.outcome,
        },
      })) as ReferralRow;
      return toReferral(row);
    });
  }

  async updateReferral(
    id: string,
    tenantId: string,
    data: Partial<ReferralEntity>,
  ): Promise<ReferralEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.referral.findFirst({
        where: { id, tenantId },
      })) as ReferralRow | null;
      if (!existing) return null;

      const updateData: Prisma.ReferralUpdateInput = {};
      if (data.diagnosisId !== undefined) updateData.diagnosisId = data.diagnosisId;
      if (data.referralDate !== undefined) updateData.referralDate = data.referralDate;
      if (data.referredBy !== undefined) updateData.referredBy = data.referredBy;
      if (data.referredTo !== undefined) updateData.referredTo = data.referredTo;
      if (data.reason !== undefined) updateData.reason = data.reason;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.appointmentDate !== undefined) updateData.appointmentDate = data.appointmentDate;
      if (data.outcome !== undefined) updateData.outcome = data.outcome;

      const row = (await tx.referral.update({
        where: { id },
        data: updateData,
      })) as ReferralRow;
      return toReferral(row);
    });
  }

  async findReferralById(id: string, tenantId: string): Promise<ReferralEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.referral.findFirst({
        where: { id, tenantId },
      })) as ReferralRow | null;
      return row ? toReferral(row) : null;
    });
  }

  async listReferralsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ReferralEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId, studentId };
      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.referral.count({ where }),
        tx.referral.findMany({
          where,
          orderBy: { referralDate: 'desc' },
          skip,
          take,
        }) as Promise<ReferralRow[]>,
      ]);
      return {
        data: rows.map(toReferral),
        meta: paginateMeta(totalItems, { page, pageSize }),
      };
    });
  }

  // ─── Accommodation Plans ──────────────────────────────────────────────────

  async createAccommodationPlan(
    data: Omit<AccommodationPlanEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AccommodationPlanEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.accommodationPlan.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          diagnosisId: data.diagnosisId,
          planName: data.planName,
          startDate: data.startDate,
          endDate: data.endDate,
          accommodations: data.accommodations as unknown as Prisma.InputJsonValue,
          reviewDate: data.reviewDate,
          status: data.status,
          notes: data.notes,
        },
      })) as AccommodationPlanRow;
      return toAccommodationPlan(row);
    });
  }

  async updateAccommodationPlan(
    id: string,
    tenantId: string,
    data: Partial<AccommodationPlanEntity>,
  ): Promise<AccommodationPlanEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.accommodationPlan.findFirst({
        where: { id, tenantId },
      })) as AccommodationPlanRow | null;
      if (!existing) return null;

      const updateData: Prisma.AccommodationPlanUpdateInput = {};
      if (data.diagnosisId !== undefined) updateData.diagnosisId = data.diagnosisId;
      if (data.planName !== undefined) updateData.planName = data.planName;
      if (data.startDate !== undefined) updateData.startDate = data.startDate;
      if (data.endDate !== undefined) updateData.endDate = data.endDate;
      if (data.accommodations !== undefined) {
        updateData.accommodations = data.accommodations as unknown as Prisma.InputJsonValue;
      }
      if (data.reviewDate !== undefined) updateData.reviewDate = data.reviewDate;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.notes !== undefined) updateData.notes = data.notes;

      const row = (await tx.accommodationPlan.update({
        where: { id },
        data: updateData,
      })) as AccommodationPlanRow;
      return toAccommodationPlan(row);
    });
  }

  async findAccommodationPlanById(
    id: string,
    tenantId: string,
  ): Promise<AccommodationPlanEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.accommodationPlan.findFirst({
        where: { id, tenantId },
      })) as AccommodationPlanRow | null;
      return row ? toAccommodationPlan(row) : null;
    });
  }

  async listAccommodationPlansByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AccommodationPlanEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId, studentId };
      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.accommodationPlan.count({ where }),
        tx.accommodationPlan.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }) as Promise<AccommodationPlanRow[]>,
      ]);
      return {
        data: rows.map(toAccommodationPlan),
        meta: paginateMeta(totalItems, { page, pageSize }),
      };
    });
  }

  // ─── Counselling Sessions ─────────────────────────────────────────────────

  async createCounsellingSession(
    data: Omit<CounsellingSessionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CounsellingSessionEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.counsellingSession.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          counsellorId: data.counsellorId,
          sessionDate: data.sessionDate,
          sessionType: data.sessionType,
          reason: data.reason,
          caseNotes: data.caseNotes,
          outcome: data.outcome,
          followUpRequired: data.followUpRequired,
          followUpDate: data.followUpDate,
          status: data.status,
        },
      })) as CounsellingSessionRow;
      return toCounsellingSession(row);
    });
  }

  async updateCounsellingSession(
    id: string,
    tenantId: string,
    data: Partial<CounsellingSessionEntity>,
  ): Promise<CounsellingSessionEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.counsellingSession.findFirst({
        where: { id, tenantId },
      })) as CounsellingSessionRow | null;
      if (!existing) return null;

      const updateData: Prisma.CounsellingSessionUpdateInput = {};
      if (data.counsellorId !== undefined) updateData.counsellorId = data.counsellorId;
      if (data.sessionDate !== undefined) updateData.sessionDate = data.sessionDate;
      if (data.sessionType !== undefined) updateData.sessionType = data.sessionType;
      if (data.reason !== undefined) updateData.reason = data.reason;
      if (data.caseNotes !== undefined) updateData.caseNotes = data.caseNotes;
      if (data.outcome !== undefined) updateData.outcome = data.outcome;
      if (data.followUpRequired !== undefined) {
        updateData.followUpRequired = data.followUpRequired;
      }
      if (data.followUpDate !== undefined) updateData.followUpDate = data.followUpDate;
      if (data.status !== undefined) updateData.status = data.status;

      const row = (await tx.counsellingSession.update({
        where: { id },
        data: updateData,
      })) as CounsellingSessionRow;
      return toCounsellingSession(row);
    });
  }

  async findCounsellingSessionById(
    id: string,
    tenantId: string,
  ): Promise<CounsellingSessionEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.counsellingSession.findFirst({
        where: { id, tenantId },
      })) as CounsellingSessionRow | null;
      return row ? toCounsellingSession(row) : null;
    });
  }

  async listCounsellingSessionsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<CounsellingSessionEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId, studentId };
      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.counsellingSession.count({ where }),
        tx.counsellingSession.findMany({
          where,
          orderBy: { sessionDate: 'desc' },
          skip,
          take,
        }) as Promise<CounsellingSessionRow[]>,
      ]);
      return {
        data: rows.map(toCounsellingSession),
        meta: paginateMeta(totalItems, { page, pageSize }),
      };
    });
  }

  // ─── Screening Programs ───────────────────────────────────────────────────

  async createScreeningProgram(
    data: Omit<ScreeningProgramEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ScreeningProgramEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.screeningProgram.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          name: data.name,
          description: data.description,
          gradeLevel: data.gradeLevel,
          academicPeriodId: data.academicPeriodId,
          assessmentTypes: data.assessmentTypes as unknown as Prisma.InputJsonValue,
          scheduledDate: data.scheduledDate,
          status: data.status,
        },
      })) as ScreeningProgramRow;
      return toScreeningProgram(row);
    });
  }

  async updateScreeningProgram(
    id: string,
    tenantId: string,
    data: Partial<ScreeningProgramEntity>,
  ): Promise<ScreeningProgramEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.screeningProgram.findFirst({
        where: { id, tenantId },
      })) as ScreeningProgramRow | null;
      if (!existing) return null;

      const updateData: Prisma.ScreeningProgramUpdateInput = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.gradeLevel !== undefined) updateData.gradeLevel = data.gradeLevel;
      if (data.academicPeriodId !== undefined) {
        updateData.academicPeriodId = data.academicPeriodId;
      }
      if (data.assessmentTypes !== undefined) {
        updateData.assessmentTypes = data.assessmentTypes as unknown as Prisma.InputJsonValue;
      }
      if (data.scheduledDate !== undefined) updateData.scheduledDate = data.scheduledDate;
      if (data.status !== undefined) updateData.status = data.status;

      const row = (await tx.screeningProgram.update({
        where: { id },
        data: updateData,
      })) as ScreeningProgramRow;
      return toScreeningProgram(row);
    });
  }

  async findScreeningProgramById(
    id: string,
    tenantId: string,
  ): Promise<ScreeningProgramEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.screeningProgram.findFirst({
        where: { id, tenantId },
      })) as ScreeningProgramRow | null;
      return row ? toScreeningProgram(row) : null;
    });
  }

  async listScreeningPrograms(
    tenantId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScreeningProgramEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId };
      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.screeningProgram.count({ where }),
        tx.screeningProgram.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }) as Promise<ScreeningProgramRow[]>,
      ]);
      return {
        data: rows.map(toScreeningProgram),
        meta: paginateMeta(totalItems, { page, pageSize }),
      };
    });
  }

  async listScreeningProgramsByGrade(
    tenantId: string,
    gradeLevel: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScreeningProgramEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId, gradeLevel };
      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.screeningProgram.count({ where }),
        tx.screeningProgram.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }) as Promise<ScreeningProgramRow[]>,
      ]);
      return {
        data: rows.map(toScreeningProgram),
        meta: paginateMeta(totalItems, { page, pageSize }),
      };
    });
  }
}
