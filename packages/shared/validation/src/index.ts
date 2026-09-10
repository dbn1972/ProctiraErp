/**
 * @proctira/validation - JSON Schema validation utilities with Typebox
 */

// Schema builders
export {
  UuidSchema,
  EmailSchema,
  DateSchema,
  PaginationSchema,
  PhoneSchema,
  NameSchema,
} from './schemas';

// Validator
export { validate, validateQuery, type ValidateOptions, type ValidationResult } from './validator';

// Re-export Typebox Type for convenience
export { Type, type Static, type TSchema } from '@sinclair/typebox';
