/**
 * Health repository factory.
 *
 * Prefer Postgres-backed counselling + profile/screening PHI when DATABASE_URL
 * is set (raw `pg`, no Prisma). Special-needs entities stay in-memory until
 * their SQL schemas land.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  AllergyEntity,
  CounsellingSessionEntity,
  HealthConditionEntity,
  HealthMeasurementEntity,
  HealthRepository,
  InsuranceEntity,
  ScreeningProgramEntity,
  VaccinationEntity,
} from './health-repository.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';
import {
  createPgCounsellingStore,
  isPgCounsellingEnabled,
  type PgCounsellingStore,
} from './pg-counselling-store.js';
import { createPgPhiStore, isPgPhiEnabled, type PgPhiStore } from './pg-phi-store.js';

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
 * Overlay that persists counselling + profile/screening PHI through Postgres
 * when available; special-needs stays on the in-memory maps.
 */
export class HybridHealthRepository implements HealthRepository {
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

  constructor(
    private readonly memory: InMemoryHealthRepository,
    private readonly counselling: PgCounsellingStore | null,
    private readonly phi: PgPhiStore | null,
  ) {
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
    this.listAccommodationPlansByStudent = this.memory.listAccommodationPlansByStudent.bind(
      this.memory,
    );
  }

  get persistence(): 'postgres-phi' | 'postgres-counselling' | 'memory' {
    if (this.phi && this.counselling) return 'postgres-phi';
    if (this.counselling) return 'postgres-counselling';
    return 'memory';
  }

  // ─── Profile PHI ──────────────────────────────────────────────────────────

  async createMeasurement(
    data: Omit<HealthMeasurementEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HealthMeasurementEntity> {
    if (this.phi) return this.phi.createMeasurement(data);
    return this.memory.createMeasurement(data);
  }

  async updateMeasurement(
    id: string,
    tenantId: string,
    data: Partial<HealthMeasurementEntity>,
  ): Promise<HealthMeasurementEntity | null> {
    if (this.phi) return this.phi.updateMeasurement(id, tenantId, data);
    return this.memory.updateMeasurement(id, tenantId, data);
  }

  async findMeasurementById(id: string, tenantId: string): Promise<HealthMeasurementEntity | null> {
    if (this.phi) return this.phi.findMeasurementById(id, tenantId);
    return this.memory.findMeasurementById(id, tenantId);
  }

  async listMeasurementsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<HealthMeasurementEntity>> {
    if (this.phi) return this.phi.listMeasurementsByStudent(tenantId, studentId, pagination);
    return this.memory.listMeasurementsByStudent(tenantId, studentId, pagination);
  }

  async deleteMeasurement(id: string, tenantId: string): Promise<boolean> {
    if (this.phi) return this.phi.deleteMeasurement(id, tenantId);
    return this.memory.deleteMeasurement(id, tenantId);
  }

  async createAllergy(
    data: Omit<AllergyEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AllergyEntity> {
    if (this.phi) return this.phi.createAllergy(data);
    return this.memory.createAllergy(data);
  }

  async updateAllergy(
    id: string,
    tenantId: string,
    data: Partial<AllergyEntity>,
  ): Promise<AllergyEntity | null> {
    if (this.phi) return this.phi.updateAllergy(id, tenantId, data);
    return this.memory.updateAllergy(id, tenantId, data);
  }

  async findAllergyById(id: string, tenantId: string): Promise<AllergyEntity | null> {
    if (this.phi) return this.phi.findAllergyById(id, tenantId);
    return this.memory.findAllergyById(id, tenantId);
  }

  async listAllergiesByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AllergyEntity>> {
    if (this.phi) return this.phi.listAllergiesByStudent(tenantId, studentId, pagination);
    return this.memory.listAllergiesByStudent(tenantId, studentId, pagination);
  }

  async deleteAllergy(id: string, tenantId: string): Promise<boolean> {
    if (this.phi) return this.phi.deleteAllergy(id, tenantId);
    return this.memory.deleteAllergy(id, tenantId);
  }

  async createCondition(
    data: Omit<HealthConditionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HealthConditionEntity> {
    if (this.phi) return this.phi.createCondition(data);
    return this.memory.createCondition(data);
  }

  async updateCondition(
    id: string,
    tenantId: string,
    data: Partial<HealthConditionEntity>,
  ): Promise<HealthConditionEntity | null> {
    if (this.phi) return this.phi.updateCondition(id, tenantId, data);
    return this.memory.updateCondition(id, tenantId, data);
  }

  async findConditionById(id: string, tenantId: string): Promise<HealthConditionEntity | null> {
    if (this.phi) return this.phi.findConditionById(id, tenantId);
    return this.memory.findConditionById(id, tenantId);
  }

  async listConditionsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<HealthConditionEntity>> {
    if (this.phi) return this.phi.listConditionsByStudent(tenantId, studentId, pagination);
    return this.memory.listConditionsByStudent(tenantId, studentId, pagination);
  }

  async deleteCondition(id: string, tenantId: string): Promise<boolean> {
    if (this.phi) return this.phi.deleteCondition(id, tenantId);
    return this.memory.deleteCondition(id, tenantId);
  }

  async createVaccination(
    data: Omit<VaccinationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<VaccinationEntity> {
    if (this.phi) return this.phi.createVaccination(data);
    return this.memory.createVaccination(data);
  }

  async updateVaccination(
    id: string,
    tenantId: string,
    data: Partial<VaccinationEntity>,
  ): Promise<VaccinationEntity | null> {
    if (this.phi) return this.phi.updateVaccination(id, tenantId, data);
    return this.memory.updateVaccination(id, tenantId, data);
  }

  async findVaccinationById(id: string, tenantId: string): Promise<VaccinationEntity | null> {
    if (this.phi) return this.phi.findVaccinationById(id, tenantId);
    return this.memory.findVaccinationById(id, tenantId);
  }

  async listVaccinationsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<VaccinationEntity>> {
    if (this.phi) return this.phi.listVaccinationsByStudent(tenantId, studentId, pagination);
    return this.memory.listVaccinationsByStudent(tenantId, studentId, pagination);
  }

  async deleteVaccination(id: string, tenantId: string): Promise<boolean> {
    if (this.phi) return this.phi.deleteVaccination(id, tenantId);
    return this.memory.deleteVaccination(id, tenantId);
  }

  async createInsurance(
    data: Omit<InsuranceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<InsuranceEntity> {
    if (this.phi) return this.phi.createInsurance(data);
    return this.memory.createInsurance(data);
  }

  async updateInsurance(
    id: string,
    tenantId: string,
    data: Partial<InsuranceEntity>,
  ): Promise<InsuranceEntity | null> {
    if (this.phi) return this.phi.updateInsurance(id, tenantId, data);
    return this.memory.updateInsurance(id, tenantId, data);
  }

  async findInsuranceById(id: string, tenantId: string): Promise<InsuranceEntity | null> {
    if (this.phi) return this.phi.findInsuranceById(id, tenantId);
    return this.memory.findInsuranceById(id, tenantId);
  }

  async listInsuranceByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InsuranceEntity>> {
    if (this.phi) return this.phi.listInsuranceByStudent(tenantId, studentId, pagination);
    return this.memory.listInsuranceByStudent(tenantId, studentId, pagination);
  }

  async deleteInsurance(id: string, tenantId: string): Promise<boolean> {
    if (this.phi) return this.phi.deleteInsurance(id, tenantId);
    return this.memory.deleteInsurance(id, tenantId);
  }

  // ─── Screenings ───────────────────────────────────────────────────────────

  async createScreeningProgram(
    data: Omit<ScreeningProgramEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ScreeningProgramEntity> {
    if (this.phi) return this.phi.createScreeningProgram(data);
    return this.memory.createScreeningProgram(data);
  }

  async updateScreeningProgram(
    id: string,
    tenantId: string,
    data: Partial<ScreeningProgramEntity>,
  ): Promise<ScreeningProgramEntity | null> {
    if (this.phi) return this.phi.updateScreeningProgram(id, tenantId, data);
    return this.memory.updateScreeningProgram(id, tenantId, data);
  }

  async findScreeningProgramById(
    id: string,
    tenantId: string,
  ): Promise<ScreeningProgramEntity | null> {
    if (this.phi) return this.phi.findScreeningProgramById(id, tenantId);
    return this.memory.findScreeningProgramById(id, tenantId);
  }

  async listScreeningPrograms(
    tenantId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScreeningProgramEntity>> {
    if (this.phi) return this.phi.listScreeningPrograms(tenantId, pagination);
    return this.memory.listScreeningPrograms(tenantId, pagination);
  }

  async listScreeningProgramsByGrade(
    tenantId: string,
    gradeLevel: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScreeningProgramEntity>> {
    if (this.phi) return this.phi.listScreeningProgramsByGrade(tenantId, gradeLevel, pagination);
    return this.memory.listScreeningProgramsByGrade(tenantId, gradeLevel, pagination);
  }

  // ─── Counselling ──────────────────────────────────────────────────────────

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
  const enabled = isPgCounsellingEnabled() || isPgPhiEnabled();
  const counselling = enabled ? createPgCounsellingStore() : null;
  const phi = enabled ? createPgPhiStore() : null;
  return new HybridHealthRepository(memory, counselling, phi);
}

export type { PgCounsellingStore, PgPhiStore };
