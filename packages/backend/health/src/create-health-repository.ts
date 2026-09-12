/**
 * Health repository factory.
 *
 * Prefer Postgres-backed counselling + profile/screening PHI + special-needs
 * when DATABASE_URL is set (raw `pg`, no Prisma).
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
} from '@proctira/database';

import type {
  AccommodationPlanEntity,
  AllergyEntity,
  CounsellingSessionEntity,
  DiagnosisEntity,
  HealthConditionEntity,
  HealthMeasurementEntity,
  HealthRepository,
  InsuranceEntity,
  NurseIncidentEntity,
  ScreeningProgramEntity,
  VaccinationEntity,
} from './health-repository.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';
import { createPgBreakGlassStore, type PgBreakGlassStore } from './pg-break-glass-store.js';
import {
  createPgCounsellingStore,
  isPgCounsellingEnabled,
  type PgCounsellingStore,
} from './pg-counselling-store.js';
import {
  createPgNurseIncidentStore,
  type PgNurseIncidentStore,
} from './pg-nurse-incident-store.js';
import { createPgPhiStore, isPgPhiEnabled, type PgPhiStore } from './pg-phi-store.js';
import {
  createPgSpecialNeedsStore,
  type PgSpecialNeedsStore,
  type PhiAccessLogInput,
} from './pg-special-needs-store.js';
import type {
  CreateHealthBreakGlassInput,
  HealthBreakGlassGrant,
  HealthPhiFieldPath,
} from './phi-field-acl.js';

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
 * Overlay that persists counselling + profile/screening PHI + special-needs
 * through Postgres when available.
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
    private readonly specialNeeds: PgSpecialNeedsStore | null = null,
    private readonly nurseIncidents: PgNurseIncidentStore | null = null,
    private readonly breakGlass: PgBreakGlassStore | null = null,
  ) {
    const sn = this.specialNeeds;
    this.createAssessment = (sn?.createAssessment ?? this.memory.createAssessment).bind(
      sn ?? this.memory,
    );
    this.findAssessmentById = (sn?.findAssessmentById ?? this.memory.findAssessmentById).bind(
      sn ?? this.memory,
    );
    this.listAssessmentsByStudent = (
      sn?.listAssessmentsByStudent ?? this.memory.listAssessmentsByStudent
    ).bind(sn ?? this.memory);
    this.createDiagnosis = (sn?.createDiagnosis ?? this.memory.createDiagnosis).bind(
      sn ?? this.memory,
    );
    this.findDiagnosisById = (sn?.findDiagnosisById ?? this.memory.findDiagnosisById).bind(
      sn ?? this.memory,
    );
    this.listDiagnosesByStudent = (
      sn?.listDiagnosesByStudent ?? this.memory.listDiagnosesByStudent
    ).bind(sn ?? this.memory);
    this.createReferral = (sn?.createReferral ?? this.memory.createReferral).bind(
      sn ?? this.memory,
    );
    this.updateReferral = (sn?.updateReferral ?? this.memory.updateReferral).bind(
      sn ?? this.memory,
    );
    this.findReferralById = (sn?.findReferralById ?? this.memory.findReferralById).bind(
      sn ?? this.memory,
    );
    this.listReferralsByStudent = (
      sn?.listReferralsByStudent ?? this.memory.listReferralsByStudent
    ).bind(sn ?? this.memory);
    this.createAccommodationPlan = (
      sn?.createAccommodationPlan ?? this.memory.createAccommodationPlan
    ).bind(sn ?? this.memory);
    this.updateAccommodationPlan = (
      sn?.updateAccommodationPlan ?? this.memory.updateAccommodationPlan
    ).bind(sn ?? this.memory);
    this.findAccommodationPlanById = (
      sn?.findAccommodationPlanById ?? this.memory.findAccommodationPlanById
    ).bind(sn ?? this.memory);
    this.listAccommodationPlansByStudent = (
      sn?.listAccommodationPlansByStudent ?? this.memory.listAccommodationPlansByStudent
    ).bind(sn ?? this.memory);
  }

  get persistence(): 'postgres-phi' | 'postgres-counselling' | 'memory' {
    if (this.specialNeeds && this.phi && this.counselling) return 'postgres-phi';
    if (this.counselling) return 'postgres-counselling';
    return 'memory';
  }

  async logPhiAccess(input: PhiAccessLogInput): Promise<void> {
    if (this.specialNeeds) {
      await this.specialNeeds.logPhiAccess(input);
      return;
    }
    await this.memory.logPhiAccess(input);
  }

  async listPhiAccessLogs(
    tenantId: string,
    options: { studentId?: string; limit?: number } = {},
  ): Promise<
    Array<{
      id: string;
      tenantId: string;
      actorUserId: string;
      studentId: string;
      resourceType: string;
      resourceId: string | null;
      action: string;
      breakGlassId: string | null;
      createdAt: string;
    }>
  > {
    if (this.specialNeeds && typeof this.specialNeeds.listPhiAccessLogs === 'function') {
      return this.specialNeeds.listPhiAccessLogs(tenantId, options);
    }
    return this.memory.listPhiAccessLogs(tenantId, options);
  }

  async createBreakGlassGrant(input: CreateHealthBreakGlassInput): Promise<HealthBreakGlassGrant> {
    if (this.breakGlass) return this.breakGlass.create(input);
    return this.memory.createBreakGlassGrant(input);
  }

  async findBreakGlassGrantById(
    id: string,
    tenantId: string,
  ): Promise<HealthBreakGlassGrant | null> {
    if (this.breakGlass) return this.breakGlass.findById(id, tenantId);
    return this.memory.findBreakGlassGrantById(id, tenantId);
  }

  async findActiveBreakGlassGrant(
    tenantId: string,
    requesterUserId: string,
    studentId: string,
    fieldPath: HealthPhiFieldPath,
    now?: Date,
  ): Promise<HealthBreakGlassGrant | null> {
    if (this.breakGlass) {
      return this.breakGlass.findActiveGrant(tenantId, requesterUserId, studentId, fieldPath, now);
    }
    return this.memory.findActiveBreakGlassGrant(
      tenantId,
      requesterUserId,
      studentId,
      fieldPath,
      now,
    );
  }

  async approveBreakGlassGrant(
    id: string,
    tenantId: string,
    approverUserId: string,
  ): Promise<HealthBreakGlassGrant | null> {
    if (this.breakGlass) return this.breakGlass.approve(id, tenantId, approverUserId);
    return this.memory.approveBreakGlassGrant(id, tenantId, approverUserId);
  }

  async denyBreakGlassGrant(
    id: string,
    tenantId: string,
    approverUserId: string,
  ): Promise<HealthBreakGlassGrant | null> {
    if (this.breakGlass) return this.breakGlass.deny(id, tenantId, approverUserId);
    return this.memory.denyBreakGlassGrant(id, tenantId, approverUserId);
  }

  async listBreakGlassGrants(
    tenantId: string,
    options: { studentId?: string; limit?: number } = {},
  ): Promise<HealthBreakGlassGrant[]> {
    if (this.breakGlass) return this.breakGlass.list(tenantId, options);
    return this.memory.listBreakGlassGrants(tenantId, options);
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

  // ─── Tenant-wide reads (G-912) ────────────────────────────────────────────

  async listAllAllergies(tenantId: string): Promise<AllergyEntity[]> {
    if (this.phi) return this.phi.listAllAllergies(tenantId);
    return this.memory.listAllAllergies(tenantId);
  }

  async listAllVaccinations(tenantId: string): Promise<VaccinationEntity[]> {
    if (this.phi) return this.phi.listAllVaccinations(tenantId);
    return this.memory.listAllVaccinations(tenantId);
  }

  async listAllConditions(tenantId: string): Promise<HealthConditionEntity[]> {
    if (this.phi) return this.phi.listAllConditions(tenantId);
    return this.memory.listAllConditions(tenantId);
  }

  async listAllDiagnoses(tenantId: string): Promise<DiagnosisEntity[]> {
    if (this.specialNeeds) return this.specialNeeds.listAllDiagnoses(tenantId);
    return this.memory.listAllDiagnoses(tenantId);
  }

  async listAllAccommodationPlans(tenantId: string): Promise<AccommodationPlanEntity[]> {
    if (this.specialNeeds) return this.specialNeeds.listAllAccommodationPlans(tenantId);
    return this.memory.listAllAccommodationPlans(tenantId);
  }

  async createNurseIncident(
    data: Omit<NurseIncidentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<NurseIncidentEntity> {
    if (this.nurseIncidents) return this.nurseIncidents.create(data);
    return this.memory.createNurseIncident(data);
  }

  async listNurseIncidents(tenantId: string): Promise<NurseIncidentEntity[]> {
    if (this.nurseIncidents) return this.nurseIncidents.listByTenant(tenantId);
    return this.memory.listNurseIncidents(tenantId);
  }

  async listNurseIncidentsByStudent(
    tenantId: string,
    studentId: string,
  ): Promise<NurseIncidentEntity[]> {
    if (this.nurseIncidents) return this.nurseIncidents.listByStudent(tenantId, studentId);
    return this.memory.listNurseIncidentsByStudent(tenantId, studentId);
  }
}

export function createHealthRepository(): HybridHealthRepository {
  const memory = new InMemoryHealthRepository();
  const enabled = isPgCounsellingEnabled() || isPgPhiEnabled();
  if (!enabled) {
    assertInMemoryFallbackAllowed('health');
    return new HybridHealthRepository(memory, null, null, null, null, null);
  }
  // P0-05: DATABASE_URL set ⇒ PG overlays required (no silent all-memory hybrid).
  const counselling = createPgCounsellingStore();
  const phi = createPgPhiStore();
  const specialNeeds = createPgSpecialNeedsStore();
  const nurseIncidents = createPgNurseIncidentStore();
  const breakGlass = createPgBreakGlassStore();
  assertPostgresRepositoryAvailable('health.counselling', counselling);
  assertPostgresRepositoryAvailable('health.phi', phi);
  assertPostgresRepositoryAvailable('health.special-needs', specialNeeds);
  assertPostgresRepositoryAvailable('health.nurse-incidents', nurseIncidents);
  assertPostgresRepositoryAvailable('health.break-glass', breakGlass);
  return new HybridHealthRepository(
    memory,
    counselling,
    phi,
    specialNeeds,
    nurseIncidents,
    breakGlass,
  );
}

export type {
  PgCounsellingStore,
  PgPhiStore,
  PgSpecialNeedsStore,
  PgNurseIncidentStore,
  PgBreakGlassStore,
};
