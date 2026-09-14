/**
 * Health Repository Interface
 *
 * Defines the data access contract for health-related operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 *
 * Requirements:
 * - 12.1: Record student health data (measurements, allergies, conditions, vaccinations, insurance)
 * - 12.2: Track special needs assessments, diagnoses, referrals, accommodation plans
 * - 12.3: Manage counselling sessions with case notes, follow-ups, outcome tracking
 * - 12.5: Support configurable health screening programs per grade level
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

// ─── Entity Types ─────────────────────────────────────────────────────────────

export interface HealthMeasurementEntity {
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
}

export interface AllergyEntity {
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
}

export interface HealthConditionEntity {
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
}

export interface VaccinationEntity {
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
}

/** Nurse / clinic visit incident (Wave 10 Option B). */
export interface NurseIncidentEntity {
  id: string;
  tenantId: string;
  studentId: string;
  institutionId: string | null;
  incidentAt: Date;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  notes: string;
  reportedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InsuranceEntity {
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
}

export interface SpecialNeedsAssessmentEntity {
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
}

export interface DiagnosisEntity {
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
}

export interface ReferralEntity {
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
}

export interface AccommodationItem {
  type: string;
  description: string;
}

export interface AccommodationPlanEntity {
  id: string;
  tenantId: string;
  studentId: string;
  diagnosisId: string | null;
  planName: string;
  startDate: string;
  endDate: string | null;
  accommodations: AccommodationItem[];
  reviewDate: string | null;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CounsellingSessionEntity {
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
}

export interface ScreeningProgramEntity {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  gradeLevel: string;
  academicPeriodId: string;
  assessmentTypes: string[];
  scheduledDate: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Repository Interface ─────────────────────────────────────────────────────

export interface HealthRepository {
  // Measurements
  createMeasurement(
    data: Omit<HealthMeasurementEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HealthMeasurementEntity>;
  updateMeasurement(
    id: string,
    tenantId: string,
    data: Partial<HealthMeasurementEntity>,
  ): Promise<HealthMeasurementEntity | null>;
  findMeasurementById(id: string, tenantId: string): Promise<HealthMeasurementEntity | null>;
  listMeasurementsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<HealthMeasurementEntity>>;
  deleteMeasurement(id: string, tenantId: string): Promise<boolean>;

  // Allergies
  createAllergy(data: Omit<AllergyEntity, 'createdAt' | 'updatedAt'>): Promise<AllergyEntity>;
  updateAllergy(
    id: string,
    tenantId: string,
    data: Partial<AllergyEntity>,
  ): Promise<AllergyEntity | null>;
  findAllergyById(id: string, tenantId: string): Promise<AllergyEntity | null>;
  listAllergiesByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AllergyEntity>>;
  deleteAllergy(id: string, tenantId: string): Promise<boolean>;

  // Conditions
  createCondition(
    data: Omit<HealthConditionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HealthConditionEntity>;
  updateCondition(
    id: string,
    tenantId: string,
    data: Partial<HealthConditionEntity>,
  ): Promise<HealthConditionEntity | null>;
  findConditionById(id: string, tenantId: string): Promise<HealthConditionEntity | null>;
  listConditionsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<HealthConditionEntity>>;
  deleteCondition(id: string, tenantId: string): Promise<boolean>;

  // Vaccinations
  createVaccination(
    data: Omit<VaccinationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<VaccinationEntity>;
  updateVaccination(
    id: string,
    tenantId: string,
    data: Partial<VaccinationEntity>,
  ): Promise<VaccinationEntity | null>;
  findVaccinationById(id: string, tenantId: string): Promise<VaccinationEntity | null>;
  listVaccinationsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<VaccinationEntity>>;
  deleteVaccination(id: string, tenantId: string): Promise<boolean>;

  // Insurance
  createInsurance(data: Omit<InsuranceEntity, 'createdAt' | 'updatedAt'>): Promise<InsuranceEntity>;
  updateInsurance(
    id: string,
    tenantId: string,
    data: Partial<InsuranceEntity>,
  ): Promise<InsuranceEntity | null>;
  findInsuranceById(id: string, tenantId: string): Promise<InsuranceEntity | null>;
  listInsuranceByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InsuranceEntity>>;
  deleteInsurance(id: string, tenantId: string): Promise<boolean>;

  // Special Needs Assessments
  createAssessment(
    data: Omit<SpecialNeedsAssessmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<SpecialNeedsAssessmentEntity>;
  findAssessmentById(id: string, tenantId: string): Promise<SpecialNeedsAssessmentEntity | null>;
  listAssessmentsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SpecialNeedsAssessmentEntity>>;

  // Diagnoses
  createDiagnosis(data: Omit<DiagnosisEntity, 'createdAt' | 'updatedAt'>): Promise<DiagnosisEntity>;
  findDiagnosisById(id: string, tenantId: string): Promise<DiagnosisEntity | null>;
  listDiagnosesByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DiagnosisEntity>>;

  // Referrals
  createReferral(data: Omit<ReferralEntity, 'createdAt' | 'updatedAt'>): Promise<ReferralEntity>;
  updateReferral(
    id: string,
    tenantId: string,
    data: Partial<ReferralEntity>,
  ): Promise<ReferralEntity | null>;
  findReferralById(id: string, tenantId: string): Promise<ReferralEntity | null>;
  listReferralsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ReferralEntity>>;

  // Accommodation Plans
  createAccommodationPlan(
    data: Omit<AccommodationPlanEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AccommodationPlanEntity>;
  updateAccommodationPlan(
    id: string,
    tenantId: string,
    data: Partial<AccommodationPlanEntity>,
  ): Promise<AccommodationPlanEntity | null>;
  findAccommodationPlanById(id: string, tenantId: string): Promise<AccommodationPlanEntity | null>;
  listAccommodationPlansByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AccommodationPlanEntity>>;

  // Counselling Sessions
  createCounsellingSession(
    data: Omit<CounsellingSessionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CounsellingSessionEntity>;
  updateCounsellingSession(
    id: string,
    tenantId: string,
    data: Partial<CounsellingSessionEntity>,
  ): Promise<CounsellingSessionEntity | null>;
  findCounsellingSessionById(
    id: string,
    tenantId: string,
  ): Promise<CounsellingSessionEntity | null>;
  listCounsellingSessionsByStudent(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<CounsellingSessionEntity>>;
  /** Tenant-wide list for redesign UI aggregates (optional on older impls). */
  listAllCounsellingSessions?(tenantId: string): Promise<CounsellingSessionEntity[]>;

  // G-912 — tenant-wide reads that back the redesign list pages from domain
  // rows instead of the demo seed. Optional so older implementations still
  // satisfy the contract; the UI aggregate treats "absent" as "no live rows".
  listAllAllergies?(tenantId: string): Promise<AllergyEntity[]>;
  listAllVaccinations?(tenantId: string): Promise<VaccinationEntity[]>;
  listAllConditions?(tenantId: string): Promise<HealthConditionEntity[]>;
  listAllDiagnoses?(tenantId: string): Promise<DiagnosisEntity[]>;
  listAllAccommodationPlans?(tenantId: string): Promise<AccommodationPlanEntity[]>;

  // Nurse incidents (Wave 10 Option B) — optional for older impls
  createNurseIncident?(
    data: Omit<NurseIncidentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<NurseIncidentEntity>;
  listNurseIncidents?(tenantId: string): Promise<NurseIncidentEntity[]>;
  listNurseIncidentsByStudent?(tenantId: string, studentId: string): Promise<NurseIncidentEntity[]>;

  // Screening Programs
  createScreeningProgram(
    data: Omit<ScreeningProgramEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ScreeningProgramEntity>;
  updateScreeningProgram(
    id: string,
    tenantId: string,
    data: Partial<ScreeningProgramEntity>,
  ): Promise<ScreeningProgramEntity | null>;
  findScreeningProgramById(id: string, tenantId: string): Promise<ScreeningProgramEntity | null>;
  listScreeningPrograms(
    tenantId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScreeningProgramEntity>>;
  listScreeningProgramsByGrade(
    tenantId: string,
    gradeLevel: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScreeningProgramEntity>>;

  /** Active enrollment institution for institution-scoped PHI authZ (W1-SEC-04). */
  findStudentInstitutionId?(tenantId: string, studentId: string): Promise<string | null>;
}
