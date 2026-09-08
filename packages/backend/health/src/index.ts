/**
 * @proctira/backend-health - Health & Special Needs domain service
 *
 * Provides:
 * - Health measurements CRUD (height, weight, BMI, blood pressure, vision)
 * - Allergy management
 * - Health condition tracking
 * - Vaccination records
 * - Insurance management
 * - Special needs assessments, diagnoses, referrals, accommodation plans
 * - Counselling session management with case notes and follow-ups
 * - Configurable health screening programs per grade level
 * - Access control restricting records to health personnel and guardians
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

// Plugin
export { healthPlugin } from './health-plugin.js';
export type { HealthPluginOptions } from './health-plugin.js';

// Service
export { HealthService, hasHealthAccess } from './health-service.js';
export type { HealthAccessContext } from './health-service.js';

// Repository
export type {
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
  AccommodationItem,
  CounsellingSessionEntity,
  ScreeningProgramEntity,
} from './health-repository.js';

// In-memory repository (for testing)
export { InMemoryHealthRepository } from './in-memory-repository.js';

// Factory — Postgres counselling / PHI / special-needs overlay when DATABASE_URL is set
export { createHealthRepository, HybridHealthRepository } from './create-health-repository.js';
export {
  createPgCounsellingStore,
  ensureCounsellingSchema,
  isPgCounsellingEnabled,
  PgCounsellingStore,
} from './pg-counselling-store.js';
export { createPgPhiStore, ensurePhiSchema, isPgPhiEnabled, PgPhiStore } from './pg-phi-store.js';
export {
  createPgSpecialNeedsStore,
  ensureSpecialNeedsSchema,
  isPgSpecialNeedsEnabled,
  PgSpecialNeedsStore,
} from './pg-special-needs-store.js';
export type { PhiAccessLogInput } from './pg-special-needs-store.js';
export {
  decryptPhi,
  encryptPhi,
  isPhiEncryptionEnabled,
} from './phi-crypto.js';

// Routes
export { registerHealthRoutes } from './routes.js';
export type { HealthRoutesOptions } from './routes.js';

// Schemas
export {
  CreateMeasurementSchema,
  UpdateMeasurementSchema,
  CreateAllergySchema,
  UpdateAllergySchema,
  CreateConditionSchema,
  UpdateConditionSchema,
  CreateVaccinationSchema,
  UpdateVaccinationSchema,
  CreateInsuranceSchema,
  UpdateInsuranceSchema,
  CreateSpecialNeedsAssessmentSchema,
  CreateDiagnosisSchema,
  CreateReferralSchema,
  UpdateReferralSchema,
  CreateAccommodationPlanSchema,
  UpdateAccommodationPlanSchema,
  CreateCounsellingSessionSchema,
  UpdateCounsellingSessionSchema,
  CreateScreeningProgramSchema,
  UpdateScreeningProgramSchema,
  UuidParamsSchema,
  StudentParamsSchema,
} from './schemas.js';

export type {
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
