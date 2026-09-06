/**
 * Health repository factory.
 *
 * Prefer Postgres-backed counselling sessions when DATABASE_URL is set
 * (raw `pg`, no Prisma). Other health entities stay in-memory until their
 * SQL schemas land.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type { HealthRepository, CounsellingSessionEntity } from './health-repository.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';
import {
  createPgCounsellingStore,
  isPgCounsellingEnabled,
  type PgCounsellingStore,
} from './pg-counselling-store.js';

function paginate<T>(items: T[], pagination: PaginationOptions): PaginatedResult<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pagination.pageSize));
  const start = (pagination.page - 1) * pagination.pageSize;
  const data = items.slice(start, start + pagination.pageSize);
  return {
    data,
    meta: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalItems,
      totalPages,
    },
  };
}

/**
 * Overlay that delegates most methods to in-memory, but persists counselling
 * sessions through the Postgres store when available.
 *
 * Bound delegates are assigned in the constructor body (not class fields)
 * because TypeScript parameter properties are not yet initialized when field
 * initializers run — `this.memory` would otherwise be undefined.
 */
export class HybridHealthRepository implements HealthRepository {
  readonly createMeasurement: HealthRepository['createMeasurement'];
  readonly updateMeasurement: HealthRepository['updateMeasurement'];
  readonly findMeasurementById: HealthRepository['findMeasurementById'];
  readonly listMeasurementsByStudent: HealthRepository['listMeasurementsByStudent'];
  readonly deleteMeasurement: HealthRepository['deleteMeasurement'];

  readonly createAllergy: HealthRepository['createAllergy'];
  readonly updateAllergy: HealthRepository['updateAllergy'];
  readonly findAllergyById: HealthRepository['findAllergyById'];
  readonly listAllergiesByStudent: HealthRepository['listAllergiesByStudent'];
  readonly deleteAllergy: HealthRepository['deleteAllergy'];

  readonly createCondition: HealthRepository['createCondition'];
  readonly updateCondition: HealthRepository['updateCondition'];
  readonly findConditionById: HealthRepository['findConditionById'];
  readonly listConditionsByStudent: HealthRepository['listConditionsByStudent'];
  readonly deleteCondition: HealthRepository['deleteCondition'];

  readonly createVaccination: HealthRepository['createVaccination'];
  readonly updateVaccination: HealthRepository['updateVaccination'];
  readonly findVaccinationById: HealthRepository['findVaccinationById'];
  readonly listVaccinationsByStudent: HealthRepository['listVaccinationsByStudent'];
  readonly deleteVaccination: HealthRepository['deleteVaccination'];

  readonly createInsurance: HealthRepository['createInsurance'];
  readonly updateInsurance: HealthRepository['updateInsurance'];
  readonly findInsuranceById: HealthRepository['findInsuranceById'];
  readonly listInsuranceByStudent: HealthRepository['listInsuranceByStudent'];
  readonly deleteInsurance: HealthRepository['deleteInsurance'];

  readonly createAssessment: HealthRepository['createAssessment'];
  readonly findAssessmentById: HealthRepository['findAssessmentById'];
  readonly listAssessmentsByStudent: HealthRepository['listAssessmentsByStudent'];
  readonly createDiagnosis: HealthRepository['createDiagnosis'];
  readonly findDiagnosisById: HealthRepository['findDiagnosisById'];
  readonly listDiagnosesByStudent: HealthRepository['listDiagnosesByStudent'];
  readonly createReferral: HealthRepository['createReferral'];
  readonly updateReferral: HealthRepository['updateReferral'];
  readonly findReferralById: HealthRepository['findReferralById'];
  readonly listReferralsByStudent: HealthRepository['listReferralsByStudent'];
  readonly createAccommodationPlan: HealthRepository['createAccommodationPlan'];
  readonly updateAccommodationPlan: HealthRepository['updateAccommodationPlan'];
  readonly findAccommodationPlanById: HealthRepository['findAccommodationPlanById'];
  readonly listAccommodationPlansByStudent: HealthRepository['listAccommodationPlansByStudent'];

  readonly createScreeningProgram: HealthRepository['createScreeningProgram'];
  readonly updateScreeningProgram: HealthRepository['updateScreeningProgram'];
  readonly findScreeningProgramById: HealthRepository['findScreeningProgramById'];
  readonly listScreeningPrograms: HealthRepository['listScreeningPrograms'];
  readonly listScreeningProgramsByGrade: HealthRepository['listScreeningProgramsByGrade'];

  constructor(
    private readonly memory: InMemoryHealthRepository,
    private readonly counselling: PgCounsellingStore | null,
  ) {
    this.createMeasurement = this.memory.createMeasurement.bind(this.memory);
    this.updateMeasurement = this.memory.updateMeasurement.bind(this.memory);
    this.findMeasurementById = this.memory.findMeasurementById.bind(this.memory);
    this.listMeasurementsByStudent = this.memory.listMeasurementsByStudent.bind(this.memory);
    this.deleteMeasurement = this.memory.deleteMeasurement.bind(this.memory);

    this.createAllergy = this.memory.createAllergy.bind(this.memory);
    this.updateAllergy = this.memory.updateAllergy.bind(this.memory);
    this.findAllergyById = this.memory.findAllergyById.bind(this.memory);
    this.listAllergiesByStudent = this.memory.listAllergiesByStudent.bind(this.memory);
    this.deleteAllergy = this.memory.deleteAllergy.bind(this.memory);

    this.createCondition = this.memory.createCondition.bind(this.memory);
    this.updateCondition = this.memory.updateCondition.bind(this.memory);
    this.findConditionById = this.memory.findConditionById.bind(this.memory);
    this.listConditionsByStudent = this.memory.listConditionsByStudent.bind(this.memory);
    this.deleteCondition = this.memory.deleteCondition.bind(this.memory);

    this.createVaccination = this.memory.createVaccination.bind(this.memory);
    this.updateVaccination = this.memory.updateVaccination.bind(this.memory);
    this.findVaccinationById = this.memory.findVaccinationById.bind(this.memory);
    this.listVaccinationsByStudent = this.memory.listVaccinationsByStudent.bind(this.memory);
    this.deleteVaccination = this.memory.deleteVaccination.bind(this.memory);

    this.createInsurance = this.memory.createInsurance.bind(this.memory);
    this.updateInsurance = this.memory.updateInsurance.bind(this.memory);
    this.findInsuranceById = this.memory.findInsuranceById.bind(this.memory);
    this.listInsuranceByStudent = this.memory.listInsuranceByStudent.bind(this.memory);
    this.deleteInsurance = this.memory.deleteInsurance.bind(this.memory);

    this.createAssessment = this.memory.createAssessment.bind(this.memory);
    this.findAssessmentById = this.memory.findAssessmentById.bind(this.memory);
    this.listAssessmentsByStudent = this.memory.listAssessmentsByStudent.bind(this.memory);
    this.createDiagnosis = this.memory.createDiagnosis.bind(this.memory);
    this.findDiagnosisById = this.memory.findDiagnosisById.bind(this.memory);
    this.listDiagnosesByStudent = this.memory.listDiagnosesByStudent.bind(this.memory);
    this.createReferral = this.memory.createReferral.bind(this.memory);
    this.updateReferral = this.memory.updateReferral.bind(this.memory);
    this.findReferralById = this.memory.findReferralById.bind(this.memory);
    this.listReferralsByStudent = this.memory.listReferralsByStudent.bind(this.memory);
    this.createAccommodationPlan = this.memory.createAccommodationPlan.bind(this.memory);
    this.updateAccommodationPlan = this.memory.updateAccommodationPlan.bind(this.memory);
    this.findAccommodationPlanById = this.memory.findAccommodationPlanById.bind(this.memory);
    this.listAccommodationPlansByStudent =
      this.memory.listAccommodationPlansByStudent.bind(this.memory);

    this.createScreeningProgram = this.memory.createScreeningProgram.bind(this.memory);
    this.updateScreeningProgram = this.memory.updateScreeningProgram.bind(this.memory);
    this.findScreeningProgramById = this.memory.findScreeningProgramById.bind(this.memory);
    this.listScreeningPrograms = this.memory.listScreeningPrograms.bind(this.memory);
    this.listScreeningProgramsByGrade = this.memory.listScreeningProgramsByGrade.bind(this.memory);
  }

  get persistence(): 'postgres-counselling' | 'memory' {
    return this.counselling ? 'postgres-counselling' : 'memory';
  }

  // Counselling — PG when available
  async createCounsellingSession(
    data: Omit<CounsellingSessionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CounsellingSessionEntity> {
    if (this.counselling) {
      return this.counselling.create(data);
    }
    return this.memory.createCounsellingSession(data);
  }

  async updateCounsellingSession(
    id: string,
    tenantId: string,
    data: Partial<CounsellingSessionEntity>,
  ): Promise<CounsellingSessionEntity | null> {
    if (this.counselling) {
      return this.counselling.update(id, tenantId, data);
    }
    return this.memory.updateCounsellingSession(id, tenantId, data);
  }

  async findCounsellingSessionById(
    id: string,
    tenantId: string,
  ): Promise<CounsellingSessionEntity | null> {
    if (this.counselling) {
      return this.counselling.findById(id, tenantId);
    }
    return this.memory.findCounsellingSessionById(id, tenantId);
  }

  async listCounsellingSessionsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<CounsellingSessionEntity>> {
    if (this.counselling) {
      const items = await this.counselling.listByStudent(tenantId, studentId);
      return paginate(items, pagination);
    }
    return this.memory.listCounsellingSessionsByStudent(tenantId, studentId, pagination);
  }

  async listAllCounsellingSessions(tenantId: string): Promise<CounsellingSessionEntity[]> {
    if (this.counselling) {
      return this.counselling.listByTenant(tenantId);
    }
    return this.memory.listAllCounsellingSessions(tenantId);
  }
}

export function createHealthRepository(): HybridHealthRepository {
  const memory = new InMemoryHealthRepository();
  const counselling = isPgCounsellingEnabled() ? createPgCounsellingStore() : null;
  return new HybridHealthRepository(memory, counselling);
}

export type { PgCounsellingStore };
