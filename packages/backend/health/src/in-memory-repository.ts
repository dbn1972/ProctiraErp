/**
 * In-Memory Health Repository
 *
 * Used for unit testing without database dependencies.
 * Implements the HealthRepository interface with Map-based stores.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  HealthRepository,
  HealthMeasurementEntity,
  AllergyEntity,
  HealthConditionEntity,
  VaccinationEntity,
  InsuranceEntity,
  SpecialNeedsAssessmentEntity,
  DiagnosisEntity,
  ReferralEntity,
  AccommodationPlanEntity,
  CounsellingSessionEntity,
  ScreeningProgramEntity,
} from './health-repository.js';

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

export class InMemoryHealthRepository implements HealthRepository {
  private measurements = new Map<string, HealthMeasurementEntity>();
  private allergies = new Map<string, AllergyEntity>();
  private conditions = new Map<string, HealthConditionEntity>();
  private vaccinations = new Map<string, VaccinationEntity>();
  private insurances = new Map<string, InsuranceEntity>();
  private assessments = new Map<string, SpecialNeedsAssessmentEntity>();
  private diagnoses = new Map<string, DiagnosisEntity>();
  private referrals = new Map<string, ReferralEntity>();
  private accommodationPlans = new Map<string, AccommodationPlanEntity>();
  private counsellingSessions = new Map<string, CounsellingSessionEntity>();
  private screeningPrograms = new Map<string, ScreeningProgramEntity>();

  // ─── Measurements ─────────────────────────────────────────────────────────

  async createMeasurement(
    data: Omit<HealthMeasurementEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HealthMeasurementEntity> {
    const now = new Date();
    const entity: HealthMeasurementEntity = { ...data, createdAt: now, updatedAt: now };
    this.measurements.set(entity.id, entity);
    return entity;
  }

  async updateMeasurement(
    id: string,
    tenantId: string,
    data: Partial<HealthMeasurementEntity>,
  ): Promise<HealthMeasurementEntity | null> {
    const existing = this.measurements.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: HealthMeasurementEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.measurements.set(id, updated);
    return updated;
  }

  async findMeasurementById(id: string, tenantId: string): Promise<HealthMeasurementEntity | null> {
    const entity = this.measurements.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listMeasurementsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<HealthMeasurementEntity>> {
    const items = Array.from(this.measurements.values())
      .filter((e) => e.tenantId === tenantId && e.studentId === studentId)
      .sort((a, b) => b.date.localeCompare(a.date));
    return paginate(items, pagination);
  }

  async deleteMeasurement(id: string, tenantId: string): Promise<boolean> {
    const entity = this.measurements.get(id);
    if (!entity || entity.tenantId !== tenantId) return false;
    this.measurements.delete(id);
    return true;
  }

  // ─── Allergies ────────────────────────────────────────────────────────────

  async createAllergy(
    data: Omit<AllergyEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AllergyEntity> {
    const now = new Date();
    const entity: AllergyEntity = { ...data, createdAt: now, updatedAt: now };
    this.allergies.set(entity.id, entity);
    return entity;
  }

  async updateAllergy(
    id: string,
    tenantId: string,
    data: Partial<AllergyEntity>,
  ): Promise<AllergyEntity | null> {
    const existing = this.allergies.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: AllergyEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.allergies.set(id, updated);
    return updated;
  }

  async findAllergyById(id: string, tenantId: string): Promise<AllergyEntity | null> {
    const entity = this.allergies.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listAllergiesByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AllergyEntity>> {
    const items = Array.from(this.allergies.values()).filter(
      (e) => e.tenantId === tenantId && e.studentId === studentId,
    );
    return paginate(items, pagination);
  }

  async deleteAllergy(id: string, tenantId: string): Promise<boolean> {
    const entity = this.allergies.get(id);
    if (!entity || entity.tenantId !== tenantId) return false;
    this.allergies.delete(id);
    return true;
  }

  // ─── Conditions ───────────────────────────────────────────────────────────

  async createCondition(
    data: Omit<HealthConditionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HealthConditionEntity> {
    const now = new Date();
    const entity: HealthConditionEntity = { ...data, createdAt: now, updatedAt: now };
    this.conditions.set(entity.id, entity);
    return entity;
  }

  async updateCondition(
    id: string,
    tenantId: string,
    data: Partial<HealthConditionEntity>,
  ): Promise<HealthConditionEntity | null> {
    const existing = this.conditions.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: HealthConditionEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.conditions.set(id, updated);
    return updated;
  }

  async findConditionById(id: string, tenantId: string): Promise<HealthConditionEntity | null> {
    const entity = this.conditions.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listConditionsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<HealthConditionEntity>> {
    const items = Array.from(this.conditions.values()).filter(
      (e) => e.tenantId === tenantId && e.studentId === studentId,
    );
    return paginate(items, pagination);
  }

  async deleteCondition(id: string, tenantId: string): Promise<boolean> {
    const entity = this.conditions.get(id);
    if (!entity || entity.tenantId !== tenantId) return false;
    this.conditions.delete(id);
    return true;
  }

  // ─── Vaccinations ─────────────────────────────────────────────────────────

  async createVaccination(
    data: Omit<VaccinationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<VaccinationEntity> {
    const now = new Date();
    const entity: VaccinationEntity = { ...data, createdAt: now, updatedAt: now };
    this.vaccinations.set(entity.id, entity);
    return entity;
  }

  async updateVaccination(
    id: string,
    tenantId: string,
    data: Partial<VaccinationEntity>,
  ): Promise<VaccinationEntity | null> {
    const existing = this.vaccinations.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: VaccinationEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.vaccinations.set(id, updated);
    return updated;
  }

  async findVaccinationById(id: string, tenantId: string): Promise<VaccinationEntity | null> {
    const entity = this.vaccinations.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listVaccinationsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<VaccinationEntity>> {
    const items = Array.from(this.vaccinations.values())
      .filter((e) => e.tenantId === tenantId && e.studentId === studentId)
      .sort((a, b) => b.dateAdministered.localeCompare(a.dateAdministered));
    return paginate(items, pagination);
  }

  async deleteVaccination(id: string, tenantId: string): Promise<boolean> {
    const entity = this.vaccinations.get(id);
    if (!entity || entity.tenantId !== tenantId) return false;
    this.vaccinations.delete(id);
    return true;
  }

  // ─── Insurance ────────────────────────────────────────────────────────────

  async createInsurance(
    data: Omit<InsuranceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<InsuranceEntity> {
    const now = new Date();
    const entity: InsuranceEntity = { ...data, createdAt: now, updatedAt: now };
    this.insurances.set(entity.id, entity);
    return entity;
  }

  async updateInsurance(
    id: string,
    tenantId: string,
    data: Partial<InsuranceEntity>,
  ): Promise<InsuranceEntity | null> {
    const existing = this.insurances.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: InsuranceEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.insurances.set(id, updated);
    return updated;
  }

  async findInsuranceById(id: string, tenantId: string): Promise<InsuranceEntity | null> {
    const entity = this.insurances.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listInsuranceByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InsuranceEntity>> {
    const items = Array.from(this.insurances.values()).filter(
      (e) => e.tenantId === tenantId && e.studentId === studentId,
    );
    return paginate(items, pagination);
  }

  async deleteInsurance(id: string, tenantId: string): Promise<boolean> {
    const entity = this.insurances.get(id);
    if (!entity || entity.tenantId !== tenantId) return false;
    this.insurances.delete(id);
    return true;
  }

  // ─── Special Needs Assessments ────────────────────────────────────────────

  async createAssessment(
    data: Omit<SpecialNeedsAssessmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<SpecialNeedsAssessmentEntity> {
    const now = new Date();
    const entity: SpecialNeedsAssessmentEntity = { ...data, createdAt: now, updatedAt: now };
    this.assessments.set(entity.id, entity);
    return entity;
  }

  async findAssessmentById(
    id: string,
    tenantId: string,
  ): Promise<SpecialNeedsAssessmentEntity | null> {
    const entity = this.assessments.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listAssessmentsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SpecialNeedsAssessmentEntity>> {
    const items = Array.from(this.assessments.values())
      .filter((e) => e.tenantId === tenantId && e.studentId === studentId)
      .sort((a, b) => b.assessmentDate.localeCompare(a.assessmentDate));
    return paginate(items, pagination);
  }

  // ─── Diagnoses ────────────────────────────────────────────────────────────

  async createDiagnosis(
    data: Omit<DiagnosisEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<DiagnosisEntity> {
    const now = new Date();
    const entity: DiagnosisEntity = { ...data, createdAt: now, updatedAt: now };
    this.diagnoses.set(entity.id, entity);
    return entity;
  }

  async findDiagnosisById(id: string, tenantId: string): Promise<DiagnosisEntity | null> {
    const entity = this.diagnoses.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listDiagnosesByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DiagnosisEntity>> {
    const items = Array.from(this.diagnoses.values())
      .filter((e) => e.tenantId === tenantId && e.studentId === studentId)
      .sort((a, b) => b.diagnosisDate.localeCompare(a.diagnosisDate));
    return paginate(items, pagination);
  }

  // ─── Referrals ────────────────────────────────────────────────────────────

  async createReferral(
    data: Omit<ReferralEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ReferralEntity> {
    const now = new Date();
    const entity: ReferralEntity = { ...data, createdAt: now, updatedAt: now };
    this.referrals.set(entity.id, entity);
    return entity;
  }

  async updateReferral(
    id: string,
    tenantId: string,
    data: Partial<ReferralEntity>,
  ): Promise<ReferralEntity | null> {
    const existing = this.referrals.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: ReferralEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.referrals.set(id, updated);
    return updated;
  }

  async findReferralById(id: string, tenantId: string): Promise<ReferralEntity | null> {
    const entity = this.referrals.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listReferralsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ReferralEntity>> {
    const items = Array.from(this.referrals.values())
      .filter((e) => e.tenantId === tenantId && e.studentId === studentId)
      .sort((a, b) => b.referralDate.localeCompare(a.referralDate));
    return paginate(items, pagination);
  }

  // ─── Accommodation Plans ──────────────────────────────────────────────────

  async createAccommodationPlan(
    data: Omit<AccommodationPlanEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AccommodationPlanEntity> {
    const now = new Date();
    const entity: AccommodationPlanEntity = { ...data, createdAt: now, updatedAt: now };
    this.accommodationPlans.set(entity.id, entity);
    return entity;
  }

  async updateAccommodationPlan(
    id: string,
    tenantId: string,
    data: Partial<AccommodationPlanEntity>,
  ): Promise<AccommodationPlanEntity | null> {
    const existing = this.accommodationPlans.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: AccommodationPlanEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.accommodationPlans.set(id, updated);
    return updated;
  }

  async findAccommodationPlanById(
    id: string,
    tenantId: string,
  ): Promise<AccommodationPlanEntity | null> {
    const entity = this.accommodationPlans.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listAccommodationPlansByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AccommodationPlanEntity>> {
    const items = Array.from(this.accommodationPlans.values()).filter(
      (e) => e.tenantId === tenantId && e.studentId === studentId,
    );
    return paginate(items, pagination);
  }

  // ─── Counselling Sessions ─────────────────────────────────────────────────

  async createCounsellingSession(
    data: Omit<CounsellingSessionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CounsellingSessionEntity> {
    const now = new Date();
    const entity: CounsellingSessionEntity = { ...data, createdAt: now, updatedAt: now };
    this.counsellingSessions.set(entity.id, entity);
    return entity;
  }

  async updateCounsellingSession(
    id: string,
    tenantId: string,
    data: Partial<CounsellingSessionEntity>,
  ): Promise<CounsellingSessionEntity | null> {
    const existing = this.counsellingSessions.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: CounsellingSessionEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.counsellingSessions.set(id, updated);
    return updated;
  }

  async findCounsellingSessionById(
    id: string,
    tenantId: string,
  ): Promise<CounsellingSessionEntity | null> {
    const entity = this.counsellingSessions.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listCounsellingSessionsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<CounsellingSessionEntity>> {
    const items = Array.from(this.counsellingSessions.values())
      .filter((e) => e.tenantId === tenantId && e.studentId === studentId)
      .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
    return paginate(items, pagination);
  }

  async listAllCounsellingSessions(tenantId: string): Promise<CounsellingSessionEntity[]> {
    return Array.from(this.counsellingSessions.values())
      .filter((e) => e.tenantId === tenantId)
      .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
  }

  // ─── Screening Programs ───────────────────────────────────────────────────

  async createScreeningProgram(
    data: Omit<ScreeningProgramEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ScreeningProgramEntity> {
    const now = new Date();
    const entity: ScreeningProgramEntity = { ...data, createdAt: now, updatedAt: now };
    this.screeningPrograms.set(entity.id, entity);
    return entity;
  }

  async updateScreeningProgram(
    id: string,
    tenantId: string,
    data: Partial<ScreeningProgramEntity>,
  ): Promise<ScreeningProgramEntity | null> {
    const existing = this.screeningPrograms.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated: ScreeningProgramEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.screeningPrograms.set(id, updated);
    return updated;
  }

  async findScreeningProgramById(
    id: string,
    tenantId: string,
  ): Promise<ScreeningProgramEntity | null> {
    const entity = this.screeningPrograms.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listScreeningPrograms(
    tenantId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScreeningProgramEntity>> {
    const items = Array.from(this.screeningPrograms.values()).filter(
      (e) => e.tenantId === tenantId,
    );
    return paginate(items, pagination);
  }

  async listScreeningProgramsByGrade(
    tenantId: string,
    gradeLevel: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScreeningProgramEntity>> {
    const items = Array.from(this.screeningPrograms.values()).filter(
      (e) => e.tenantId === tenantId && e.gradeLevel === gradeLevel,
    );
    return paginate(items, pagination);
  }

  // ─── Test Helpers ─────────────────────────────────────────────────────────

  clear(): void {
    this.measurements.clear();
    this.allergies.clear();
    this.conditions.clear();
    this.vaccinations.clear();
    this.insurances.clear();
    this.assessments.clear();
    this.diagnoses.clear();
    this.referrals.clear();
    this.accommodationPlans.clear();
    this.counsellingSessions.clear();
    this.screeningPrograms.clear();
  }
}
