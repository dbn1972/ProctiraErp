/**
 * Health Service
 *
 * Business logic for health-related operations including measurements,
 * allergies, conditions, vaccinations, insurance, special needs,
 * counselling, and screening programs.
 *
 * Requirements:
 * - 12.1: Record student health data
 * - 12.2: Track special needs assessments, diagnoses, referrals, accommodation plans
 * - 12.3: Manage counselling sessions with case notes, follow-ups, outcome tracking
 * - 12.4: Restrict access to authorized health personnel and student's guardian
 * - 12.5: Support configurable health screening programs per grade level
 */
import { NotFoundError, BusinessRuleError, ForbiddenError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

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
import type { PhiAccessLogInput } from './pg-special-needs-store.js';
import type {
  CreateMeasurementInput,
  UpdateMeasurementInput,
  CreateAllergyInput,
  UpdateAllergyInput,
  CreateConditionInput,
  UpdateConditionInput,
  CreateVaccinationInput,
  UpdateVaccinationInput,
  CreateInsuranceInput,
  UpdateInsuranceInput,
  CreateSpecialNeedsAssessmentInput,
  CreateDiagnosisInput,
  CreateReferralInput,
  UpdateReferralInput,
  CreateAccommodationPlanInput,
  UpdateAccommodationPlanInput,
  CreateCounsellingSessionInput,
  UpdateCounsellingSessionInput,
  CreateScreeningProgramInput,
  UpdateScreeningProgramInput,
} from './schemas.js';

type PhiAccessCapableRepository = HealthRepository & {
  logPhiAccess?: (input: PhiAccessLogInput) => Promise<void>;
};

/**
 * User context for access control checks.
 * Requirement 12.4: Restrict access to authorized health personnel and student's guardian.
 */
export interface HealthAccessContext {
  userId: string;
  roles: string[];
  /** Guardian student IDs — students this user is a guardian of */
  guardianOfStudentIds: string[];
}

/** Roles that are authorized to access health records */
const HEALTH_AUTHORIZED_ROLES = [
  'health_officer',
  'school_nurse',
  'health_admin',
  'system_admin',
  'counsellor',
];

/**
 * Checks if the user has access to a student's health records.
 * Access is granted if:
 * - User has an authorized health personnel role, OR
 * - User is the student's guardian
 */
export function hasHealthAccess(context: HealthAccessContext, studentId: string): boolean {
  const hasAuthorizedRole = context.roles.some((role) => HEALTH_AUTHORIZED_ROLES.includes(role));
  if (hasAuthorizedRole) return true;
  return context.guardianOfStudentIds.includes(studentId);
}

/**
 * Health Service class providing business logic for all health operations.
 */
export class HealthService {
  constructor(private readonly repository: HealthRepository) {}

  /**
   * PHI read audit — metadata only (never payloads). No-ops when the
   * repository does not expose logPhiAccess (plain in-memory).
   */
  private async auditPhiRead(
    accessContext: HealthAccessContext,
    input: Omit<PhiAccessLogInput, 'actorUserId'>,
  ): Promise<void> {
    const repo = this.repository as PhiAccessCapableRepository;
    if (typeof repo.logPhiAccess !== 'function') return;
    await repo.logPhiAccess({
      ...input,
      actorUserId: accessContext.userId,
    });
  }

  // ─── Measurements ───────────────────────────────────────────────────────

  async createMeasurement(
    tenantId: string,
    input: CreateMeasurementInput,
    accessContext: HealthAccessContext,
  ): Promise<HealthMeasurementEntity> {
    if (!hasHealthAccess(accessContext, input.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      date: input.date,
      height: input.height ?? null,
      weight: input.weight ?? null,
      bmi: input.bmi ?? null,
      bloodPressureSystolic: input.bloodPressureSystolic ?? null,
      bloodPressureDiastolic: input.bloodPressureDiastolic ?? null,
      heartRate: input.heartRate ?? null,
      visionLeft: input.visionLeft ?? null,
      visionRight: input.visionRight ?? null,
      notes: input.notes ?? null,
    };
    return this.repository.createMeasurement(entity);
  }

  async updateMeasurement(
    tenantId: string,
    id: string,
    input: UpdateMeasurementInput,
    accessContext: HealthAccessContext,
  ): Promise<HealthMeasurementEntity> {
    const existing = await this.repository.findMeasurementById(id, tenantId);
    if (!existing) throw new NotFoundError(`Measurement with id '${id}' not found`);
    if (!hasHealthAccess(accessContext, existing.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const updated = await this.repository.updateMeasurement(id, tenantId, input);
    if (!updated) throw new NotFoundError(`Measurement with id '${id}' not found`);
    return updated;
  }

  async getMeasurement(
    tenantId: string,
    id: string,
    accessContext: HealthAccessContext,
  ): Promise<HealthMeasurementEntity> {
    const entity = await this.repository.findMeasurementById(id, tenantId);
    if (!entity) throw new NotFoundError(`Measurement with id '${id}' not found`);
    if (!hasHealthAccess(accessContext, entity.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId: entity.studentId,
      resourceType: 'measurement',
      resourceId: entity.id,
    });
    return entity;
  }

  async listMeasurements(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<HealthMeasurementEntity>> {
    if (!hasHealthAccess(accessContext, studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const result = await this.repository.listMeasurementsByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'measurement',
      resourceId: null,
    });
    return result;
  }

  async deleteMeasurement(
    tenantId: string,
    id: string,
    accessContext: HealthAccessContext,
  ): Promise<void> {
    const existing = await this.repository.findMeasurementById(id, tenantId);
    if (!existing) throw new NotFoundError(`Measurement with id '${id}' not found`);
    if (!hasHealthAccess(accessContext, existing.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    await this.repository.deleteMeasurement(id, tenantId);
  }

  // ─── Allergies ──────────────────────────────────────────────────────────

  async createAllergy(
    tenantId: string,
    input: CreateAllergyInput,
    accessContext: HealthAccessContext,
  ): Promise<AllergyEntity> {
    if (!hasHealthAccess(accessContext, input.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      allergyType: input.allergyType,
      description: input.description,
      severity: input.severity,
      reaction: input.reaction ?? null,
      treatment: input.treatment ?? null,
      diagnosedDate: input.diagnosedDate ?? null,
    };
    return this.repository.createAllergy(entity);
  }

  async updateAllergy(
    tenantId: string,
    id: string,
    input: UpdateAllergyInput,
    accessContext: HealthAccessContext,
  ): Promise<AllergyEntity> {
    const existing = await this.repository.findAllergyById(id, tenantId);
    if (!existing) throw new NotFoundError(`Allergy with id '${id}' not found`);
    if (!hasHealthAccess(accessContext, existing.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const updated = await this.repository.updateAllergy(id, tenantId, input);
    if (!updated) throw new NotFoundError(`Allergy with id '${id}' not found`);
    return updated;
  }

  async listAllergies(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<AllergyEntity>> {
    if (!hasHealthAccess(accessContext, studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const result = await this.repository.listAllergiesByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'allergy',
      resourceId: null,
    });
    return result;
  }

  // ─── Conditions ─────────────────────────────────────────────────────────

  async createCondition(
    tenantId: string,
    input: CreateConditionInput,
    accessContext: HealthAccessContext,
  ): Promise<HealthConditionEntity> {
    if (!hasHealthAccess(accessContext, input.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      conditionName: input.conditionName,
      conditionType: input.conditionType,
      diagnosedDate: input.diagnosedDate ?? null,
      status: input.status,
      treatment: input.treatment ?? null,
      medication: input.medication ?? null,
      notes: input.notes ?? null,
    };
    return this.repository.createCondition(entity);
  }

  async updateCondition(
    tenantId: string,
    id: string,
    input: UpdateConditionInput,
    accessContext: HealthAccessContext,
  ): Promise<HealthConditionEntity> {
    const existing = await this.repository.findConditionById(id, tenantId);
    if (!existing) throw new NotFoundError(`Condition with id '${id}' not found`);
    if (!hasHealthAccess(accessContext, existing.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const updated = await this.repository.updateCondition(id, tenantId, input);
    if (!updated) throw new NotFoundError(`Condition with id '${id}' not found`);
    return updated;
  }

  async listConditions(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<HealthConditionEntity>> {
    if (!hasHealthAccess(accessContext, studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const result = await this.repository.listConditionsByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'condition',
      resourceId: null,
    });
    return result;
  }

  // ─── Vaccinations ───────────────────────────────────────────────────────

  async createVaccination(
    tenantId: string,
    input: CreateVaccinationInput,
    accessContext: HealthAccessContext,
  ): Promise<VaccinationEntity> {
    if (!hasHealthAccess(accessContext, input.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      vaccineName: input.vaccineName,
      doseNumber: input.doseNumber,
      dateAdministered: input.dateAdministered,
      administeredBy: input.administeredBy ?? null,
      batchNumber: input.batchNumber ?? null,
      nextDueDate: input.nextDueDate ?? null,
      notes: input.notes ?? null,
    };
    return this.repository.createVaccination(entity);
  }

  async updateVaccination(
    tenantId: string,
    id: string,
    input: UpdateVaccinationInput,
    accessContext: HealthAccessContext,
  ): Promise<VaccinationEntity> {
    const existing = await this.repository.findVaccinationById(id, tenantId);
    if (!existing) throw new NotFoundError(`Vaccination with id '${id}' not found`);
    if (!hasHealthAccess(accessContext, existing.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const updated = await this.repository.updateVaccination(id, tenantId, input);
    if (!updated) throw new NotFoundError(`Vaccination with id '${id}' not found`);
    return updated;
  }

  async listVaccinations(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<VaccinationEntity>> {
    if (!hasHealthAccess(accessContext, studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const result = await this.repository.listVaccinationsByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'vaccination',
      resourceId: null,
    });
    return result;
  }

  /** Tenant-wide immunisation register (Wave 10 Option B). */
  async listAllVaccinations(
    tenantId: string,
    accessContext: HealthAccessContext,
  ): Promise<VaccinationEntity[]> {
    if (!hasHealthAccess(accessContext, '')) {
      throw new ForbiddenError('Access denied: not authorized to access health records');
    }
    const list = this.repository.listAllVaccinations?.bind(this.repository);
    if (!list) return [];
    return list(tenantId);
  }

  // ─── Insurance ──────────────────────────────────────────────────────────

  async createInsurance(
    tenantId: string,
    input: CreateInsuranceInput,
    accessContext: HealthAccessContext,
  ): Promise<InsuranceEntity> {
    if (!hasHealthAccess(accessContext, input.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      provider: input.provider,
      policyNumber: input.policyNumber,
      coverageType: input.coverageType,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      notes: input.notes ?? null,
    };
    return this.repository.createInsurance(entity);
  }

  async updateInsurance(
    tenantId: string,
    id: string,
    input: UpdateInsuranceInput,
    accessContext: HealthAccessContext,
  ): Promise<InsuranceEntity> {
    const existing = await this.repository.findInsuranceById(id, tenantId);
    if (!existing) throw new NotFoundError(`Insurance with id '${id}' not found`);
    if (!hasHealthAccess(accessContext, existing.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const updated = await this.repository.updateInsurance(id, tenantId, input);
    if (!updated) throw new NotFoundError(`Insurance with id '${id}' not found`);
    return updated;
  }

  async listInsurance(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<InsuranceEntity>> {
    if (!hasHealthAccess(accessContext, studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const result = await this.repository.listInsuranceByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'insurance',
      resourceId: null,
    });
    return result;
  }

  // ─── Special Needs Assessments ──────────────────────────────────────────

  async createAssessment(
    tenantId: string,
    input: CreateSpecialNeedsAssessmentInput,
    accessContext: HealthAccessContext,
  ): Promise<SpecialNeedsAssessmentEntity> {
    if (!hasHealthAccess(accessContext, input.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      assessmentDate: input.assessmentDate,
      assessorName: input.assessorName,
      assessorRole: input.assessorRole,
      assessmentType: input.assessmentType,
      findings: input.findings,
      recommendations: input.recommendations ?? null,
    };
    return this.repository.createAssessment(entity);
  }

  async listAssessments(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<SpecialNeedsAssessmentEntity>> {
    if (!hasHealthAccess(accessContext, studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const result = await this.repository.listAssessmentsByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'special_needs_assessment',
      resourceId: null,
    });
    return result;
  }

  // ─── Diagnoses ──────────────────────────────────────────────────────────

  async createDiagnosis(
    tenantId: string,
    input: CreateDiagnosisInput,
    accessContext: HealthAccessContext,
  ): Promise<DiagnosisEntity> {
    if (!hasHealthAccess(accessContext, input.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      assessmentId: input.assessmentId ?? null,
      diagnosisDate: input.diagnosisDate,
      diagnosedBy: input.diagnosedBy,
      condition: input.condition,
      category: input.category,
      severity: input.severity,
      notes: input.notes ?? null,
    };
    return this.repository.createDiagnosis(entity);
  }

  async listDiagnoses(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<DiagnosisEntity>> {
    if (!hasHealthAccess(accessContext, studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const result = await this.repository.listDiagnosesByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'diagnosis',
      resourceId: null,
    });
    return result;
  }

  // ─── Referrals ──────────────────────────────────────────────────────────

  async createReferral(
    tenantId: string,
    input: CreateReferralInput,
    accessContext: HealthAccessContext,
  ): Promise<ReferralEntity> {
    if (!hasHealthAccess(accessContext, input.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      diagnosisId: input.diagnosisId ?? null,
      referralDate: input.referralDate,
      referredBy: input.referredBy,
      referredTo: input.referredTo,
      reason: input.reason,
      status: input.status,
      appointmentDate: input.appointmentDate ?? null,
      outcome: input.outcome ?? null,
    };
    return this.repository.createReferral(entity);
  }

  async updateReferral(
    tenantId: string,
    id: string,
    input: UpdateReferralInput,
    accessContext: HealthAccessContext,
  ): Promise<ReferralEntity> {
    const existing = await this.repository.findReferralById(id, tenantId);
    if (!existing) throw new NotFoundError(`Referral with id '${id}' not found`);
    if (!hasHealthAccess(accessContext, existing.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const updated = await this.repository.updateReferral(id, tenantId, input);
    if (!updated) throw new NotFoundError(`Referral with id '${id}' not found`);
    return updated;
  }

  async listReferrals(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<ReferralEntity>> {
    if (!hasHealthAccess(accessContext, studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const result = await this.repository.listReferralsByStudent(tenantId, studentId, pagination);
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'referral',
      resourceId: null,
    });
    return result;
  }

  // ─── Accommodation Plans ────────────────────────────────────────────────

  async createAccommodationPlan(
    tenantId: string,
    input: CreateAccommodationPlanInput,
    accessContext: HealthAccessContext,
  ): Promise<AccommodationPlanEntity> {
    if (!hasHealthAccess(accessContext, input.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      diagnosisId: input.diagnosisId ?? null,
      planName: input.planName,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      accommodations: input.accommodations,
      reviewDate: input.reviewDate ?? null,
      status: input.status,
      notes: input.notes ?? null,
    };
    return this.repository.createAccommodationPlan(entity);
  }

  async updateAccommodationPlan(
    tenantId: string,
    id: string,
    input: UpdateAccommodationPlanInput,
    accessContext: HealthAccessContext,
  ): Promise<AccommodationPlanEntity> {
    const existing = await this.repository.findAccommodationPlanById(id, tenantId);
    if (!existing) throw new NotFoundError(`Accommodation plan with id '${id}' not found`);
    if (!hasHealthAccess(accessContext, existing.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const updated = await this.repository.updateAccommodationPlan(id, tenantId, input);
    if (!updated) throw new NotFoundError(`Accommodation plan with id '${id}' not found`);
    return updated;
  }

  async listAccommodationPlans(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<AccommodationPlanEntity>> {
    if (!hasHealthAccess(accessContext, studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const result = await this.repository.listAccommodationPlansByStudent(
      tenantId,
      studentId,
      pagination,
    );
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'accommodation_plan',
      resourceId: null,
    });
    return result;
  }

  // ─── Counselling Sessions ───────────────────────────────────────────────

  async createCounsellingSession(
    tenantId: string,
    input: CreateCounsellingSessionInput,
    accessContext: HealthAccessContext,
  ): Promise<CounsellingSessionEntity> {
    if (!hasHealthAccess(accessContext, input.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    if (input.followUpRequired && !input.followUpDate) {
      throw new BusinessRuleError(
        'Follow-up date is required when follow-up is marked as required',
      );
    }
    const entity = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      counsellorId: input.counsellorId,
      sessionDate: input.sessionDate,
      sessionType: input.sessionType,
      reason: input.reason,
      caseNotes: input.caseNotes,
      outcome: input.outcome ?? null,
      followUpRequired: input.followUpRequired,
      followUpDate: input.followUpDate ?? null,
      status: input.status,
    };
    return this.repository.createCounsellingSession(entity);
  }

  async updateCounsellingSession(
    tenantId: string,
    id: string,
    input: UpdateCounsellingSessionInput,
    accessContext: HealthAccessContext,
  ): Promise<CounsellingSessionEntity> {
    const existing = await this.repository.findCounsellingSessionById(id, tenantId);
    if (!existing) throw new NotFoundError(`Counselling session with id '${id}' not found`);
    if (!hasHealthAccess(accessContext, existing.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    // Validate follow-up consistency
    const followUpRequired = input.followUpRequired ?? existing.followUpRequired;
    const followUpDate = input.followUpDate ?? existing.followUpDate;
    if (followUpRequired && !followUpDate) {
      throw new BusinessRuleError(
        'Follow-up date is required when follow-up is marked as required',
      );
    }
    const updated = await this.repository.updateCounsellingSession(id, tenantId, input);
    if (!updated) throw new NotFoundError(`Counselling session with id '${id}' not found`);
    return updated;
  }

  async listCounsellingSessions(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    accessContext: HealthAccessContext,
  ): Promise<PaginatedResult<CounsellingSessionEntity>> {
    if (!hasHealthAccess(accessContext, studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const result = await this.repository.listCounsellingSessionsByStudent(
      tenantId,
      studentId,
      pagination,
    );
    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'counselling_session',
      resourceId: null,
    });
    return result;
  }

  // ─── Screening Programs ─────────────────────────────────────────────────

  async createScreeningProgram(
    tenantId: string,
    input: CreateScreeningProgramInput,
  ): Promise<ScreeningProgramEntity> {
    const entity = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      description: input.description ?? null,
      gradeLevel: input.gradeLevel,
      academicPeriodId: input.academicPeriodId,
      assessmentTypes: input.assessmentTypes,
      scheduledDate: input.scheduledDate ?? null,
      status: input.status,
    };
    return this.repository.createScreeningProgram(entity);
  }

  async updateScreeningProgram(
    tenantId: string,
    id: string,
    input: UpdateScreeningProgramInput,
  ): Promise<ScreeningProgramEntity> {
    const existing = await this.repository.findScreeningProgramById(id, tenantId);
    if (!existing) throw new NotFoundError(`Screening program with id '${id}' not found`);
    const updated = await this.repository.updateScreeningProgram(id, tenantId, input);
    if (!updated) throw new NotFoundError(`Screening program with id '${id}' not found`);
    return updated;
  }

  async getScreeningProgram(tenantId: string, id: string): Promise<ScreeningProgramEntity> {
    const entity = await this.repository.findScreeningProgramById(id, tenantId);
    if (!entity) throw new NotFoundError(`Screening program with id '${id}' not found`);
    return entity;
  }

  async listScreeningPrograms(
    tenantId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScreeningProgramEntity>> {
    return this.repository.listScreeningPrograms(tenantId, pagination);
  }

  async listScreeningProgramsByGrade(
    tenantId: string,
    gradeLevel: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScreeningProgramEntity>> {
    return this.repository.listScreeningProgramsByGrade(tenantId, gradeLevel, pagination);
  }
  /**
   * G-734 — DSAR export of PHI held for a student (measurements, allergies,
   * conditions, vaccinations, insurance, special needs, counselling).
   * Access control mirrors other student PHI reads.
   */
  async exportStudentDsarPackage(
    tenantId: string,
    studentId: string,
    accessContext: HealthAccessContext,
  ): Promise<{
    subjectId: string;
    tenantId: string;
    exportedAt: string;
    sections: Record<string, unknown>;
  }> {
    if (!hasHealthAccess(accessContext, studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const page = { page: 1, pageSize: 100 };
    const [
      measurements,
      allergies,
      conditions,
      vaccinations,
      insurance,
      assessments,
      diagnoses,
      referrals,
      accommodationPlans,
      counsellingSessions,
    ] = await Promise.all([
      this.repository.listMeasurementsByStudent(tenantId, studentId, page),
      this.repository.listAllergiesByStudent(tenantId, studentId, page),
      this.repository.listConditionsByStudent(tenantId, studentId, page),
      this.repository.listVaccinationsByStudent(tenantId, studentId, page),
      this.repository.listInsuranceByStudent(tenantId, studentId, page),
      this.repository.listAssessmentsByStudent(tenantId, studentId, page),
      this.repository.listDiagnosesByStudent(tenantId, studentId, page),
      this.repository.listReferralsByStudent(tenantId, studentId, page),
      this.repository.listAccommodationPlansByStudent(tenantId, studentId, page),
      this.repository.listCounsellingSessionsByStudent(tenantId, studentId, page),
    ]);

    await this.auditPhiRead(accessContext, {
      tenantId,
      studentId,
      resourceType: 'dsar_export',
      resourceId: null,
    });

    return {
      subjectId: studentId,
      tenantId,
      exportedAt: new Date().toISOString(),
      sections: {
        measurements: measurements.data,
        allergies: allergies.data,
        conditions: conditions.data,
        vaccinations: vaccinations.data,
        insurance: insurance.data,
        specialNeedsAssessments: assessments.data,
        diagnoses: diagnoses.data,
        referrals: referrals.data,
        accommodationPlans: accommodationPlans.data,
        counsellingSessions: counsellingSessions.data,
      },
    };
  }

  async listPhiAccessLogs(
    tenantId: string,
    access: HealthAccessContext,
    options: { studentId?: string; limit?: number } = {},
  ) {
    const privileged = access.roles.some((r) => {
      const n = r.toLowerCase();
      return (
        n.includes('health_admin') ||
        n.includes('system_admin') ||
        n.includes('administrator') ||
        n.includes('health_officer')
      );
    });
    if (!privileged) {
      throw new ForbiddenError('Access denied: PHI access log requires a health admin role');
    }
    const repo = this.repository as {
      listPhiAccessLogs?: (
        tenantId: string,
        options?: { studentId?: string; limit?: number },
      ) => Promise<
        Array<{
          id: string;
          tenantId: string;
          actorUserId: string;
          studentId: string;
          resourceType: string;
          resourceId: string | null;
          action: string;
          createdAt: string;
        }>
      >;
    };
    if (typeof repo.listPhiAccessLogs !== 'function') return [];
    return repo.listPhiAccessLogs(tenantId, options);
  }

  async createNurseIncident(
    tenantId: string,
    input: {
      studentId: string;
      institutionId?: string;
      incidentAt: string;
      category: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      notes?: string;
      reportedBy: string;
    },
    access: HealthAccessContext,
  ) {
    if (!hasHealthAccess(access, input.studentId)) {
      throw new ForbiddenError(
        "Access denied: not authorized to access this student's health records",
      );
    }
    const create = this.repository.createNurseIncident?.bind(this.repository);
    if (!create) {
      throw new BusinessRuleError('Nurse incidents are not available on this repository');
    }
    return create({
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      institutionId: input.institutionId ?? null,
      incidentAt: new Date(input.incidentAt),
      category: input.category,
      severity: input.severity,
      notes: input.notes ?? '',
      reportedBy: input.reportedBy,
    });
  }

  async listNurseIncidents(tenantId: string, access: HealthAccessContext) {
    if (!hasHealthAccess(access, '')) {
      // Empty studentId → role-only check inside hasHealthAccess for personnel
      throw new ForbiddenError('Access denied: not authorized to access health records');
    }
    const list = this.repository.listNurseIncidents?.bind(this.repository);
    return list ? list(tenantId) : [];
  }
}
