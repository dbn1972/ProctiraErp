/**
 * @proctira/backend-custom-field - Custom Field Engine Service
 *
 * Provides:
 * - Custom field definition CRUD (text, number, date, dropdown, checkbox, textarea, file)
 * - Value validation against defined rules
 * - JSONB storage with GIN indexes for efficient queries
 * - Support for entity types: student, staff, institution
 * - Tenant-scoped custom field data
 *
 * Requirements:
 * - 6.5: Support Custom_Fields to extend student profiles without database schema changes
 * - 7.6: Support Custom_Fields to extend staff profiles without database schema changes
 */

// Plugin
export { customFieldPlugin } from './custom-field-plugin.js';
export type { CustomFieldPluginOptions } from './custom-field-plugin.js';

// Service
export { CustomFieldService } from './custom-field-service.js';

// Validator
export { validateCustomFieldValue } from './custom-field-validator.js';
export type { CustomFieldValidationResult } from './custom-field-validator.js';

// Repository interfaces
export type {
  CustomFieldType,
  CustomFieldEntityType,
  CustomFieldValidationRules,
  CustomFieldDefinition,
  CustomFieldValue,
  CustomFieldDefinitionFilter,
  CustomFieldDefinitionRepository,
  CustomFieldValueRepository,
} from './custom-field-repository.js';

// In-memory implementations (for testing)
export {
  InMemoryCustomFieldDefinitionRepository,
  InMemoryCustomFieldValueRepository,
} from './in-memory-repository.js';

// Schemas
export {
  CustomFieldTypeSchema,
  CustomFieldEntityTypeSchema,
  ValidationRulesSchema,
  CreateCustomFieldDefinitionSchema,
  UpdateCustomFieldDefinitionSchema,
  SetCustomFieldValueSchema,
  BulkSetCustomFieldValuesSchema,
  CustomFieldDefinitionListQuerySchema,
  CustomFieldDefinitionParamsSchema,
  EntityValuesParamsSchema,
} from './schemas.js';

export type {
  CreateCustomFieldDefinitionInput,
  UpdateCustomFieldDefinitionInput,
  SetCustomFieldValueInput,
  BulkSetCustomFieldValuesInput,
  CustomFieldDefinitionListQuery,
  CustomFieldDefinitionParams,
  EntityValuesParams,
} from './schemas.js';

// Routes
export { registerCustomFieldRoutes } from './routes.js';
export type { CustomFieldRoutesOptions } from './routes.js';
