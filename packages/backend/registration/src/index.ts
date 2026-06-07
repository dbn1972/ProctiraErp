/**
 * @proctira/backend-registration - Public Registration Portal Service
 *
 * Provides public-facing registration functionality:
 * - Registration form submission with configurable fields per institution type
 * - Document upload with file type and size validation
 * - Tracking number assignment and status checking (no auth required)
 * - Institution location data for map display with area/type/grade filtering
 * - Multi-language interface with session-persisted language selection
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6
 */

// Plugin
export { registrationPlugin } from './registration-plugin.js';
export type { RegistrationPluginOptions } from './registration-plugin.js';

// Service
export { RegistrationService, generateTrackingNumber, validateDocuments, validateCustomFields } from './registration-service.js';

// Repository
export type {
  RegistrationEntity,
  RegistrationRepository,
  RegistrationStatus,
  InstitutionLocationFilter,
  SchoolFinderFilter,
  SchoolFinderResultRow,
} from './registration-repository.js';

// In-memory repository (for testing)
export { InMemoryRegistrationRepository, haversineKm } from './in-memory-repository.js';
export type { InMemoryInstitution } from './in-memory-repository.js';

// Schemas
export {
  SubmitRegistrationSchema,
  TrackingNumberParamsSchema,
  InstitutionMapQuerySchema,
  LanguageSelectionSchema,
  SchoolFinderQuerySchema,
  SchoolFinderResultSchema,
  SchoolFinderResponseSchema,
  FormFieldDefinitionSchema,
  FormConfigurationSchema,
  DocumentUploadSchema,
  RegistrationFieldValueSchema,
  RegistrationSubmissionResponseSchema,
  RegistrationStatusResponseSchema,
  InstitutionLocationSchema,
  InstitutionMapResponseSchema,
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE_BYTES,
  TRACKING_NUMBER_PREFIX,
} from './schemas.js';
export type {
  SubmitRegistrationInput,
  TrackingNumberParams,
  InstitutionMapQuery,
  LanguageSelection,
  SchoolFinderQuery,
  SchoolFinderResult,
  SchoolFinderResponse,
  FormFieldDefinition,
  FormConfiguration,
  DocumentUpload,
  RegistrationFieldValue,
  RegistrationSubmissionResponse,
  RegistrationStatusResponse,
  InstitutionLocation,
  InstitutionMapResponse,
} from './schemas.js';

// Routes
export { registerRegistrationRoutes, InMemorySessionStore } from './routes.js';
export type { RegistrationRoutesOptions, SessionStore } from './routes.js';
