/**
 * Typebox schemas for Custom Field Service request/response validation.
 *
 * Requirements:
 * - 6.5: Support Custom_Fields to extend student profiles without database schema changes
 * - 7.6: Support Custom_Fields to extend staff profiles without database schema changes
 */
import { Type, type Static } from '@sinclair/typebox';

/**
 * Supported custom field types.
 */
export const CustomFieldTypeSchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('number'),
  Type.Literal('date'),
  Type.Literal('dropdown'),
  Type.Literal('checkbox'),
  Type.Literal('textarea'),
  Type.Literal('file'),
]);

/**
 * Entity types that support custom fields.
 */
export const CustomFieldEntityTypeSchema = Type.Union([
  Type.Literal('student'),
  Type.Literal('staff'),
  Type.Literal('institution'),
]);

/**
 * Validation rules schema.
 */
export const ValidationRulesSchema = Type.Object({
  required: Type.Optional(Type.Boolean({ description: 'Whether the field is required' })),
  minLength: Type.Optional(Type.Number({ minimum: 0, description: 'Minimum length for text/textarea' })),
  maxLength: Type.Optional(Type.Number({ minimum: 1, description: 'Maximum length for text/textarea' })),
  min: Type.Optional(Type.Number({ description: 'Minimum value for number fields' })),
  max: Type.Optional(Type.Number({ description: 'Maximum value for number fields' })),
  pattern: Type.Optional(Type.String({ description: 'Regex pattern for text fields' })),
  allowedExtensions: Type.Optional(Type.Array(Type.String(), { description: 'Allowed file extensions' })),
  maxFileSize: Type.Optional(Type.Number({ minimum: 1, description: 'Max file size in bytes' })),
  options: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'Dropdown options' })),
});

/**
 * Schema for creating a custom field definition.
 */
export const CreateCustomFieldDefinitionSchema = Type.Object({
  entityType: CustomFieldEntityTypeSchema,
  fieldKey: Type.String({
    minLength: 1,
    maxLength: 100,
    pattern: '^[a-z][a-z0-9_]*$',
    description: 'Machine-readable field key (lowercase, underscores, starts with letter)',
  }),
  label: Type.String({ minLength: 1, maxLength: 255, description: 'Human-readable label' }),
  description: Type.Optional(Type.Union([
    Type.String({ maxLength: 1000 }),
    Type.Null(),
  ], { description: 'Optional description/help text' })),
  fieldType: CustomFieldTypeSchema,
  validationRules: Type.Optional(ValidationRulesSchema),
  displayOrder: Type.Optional(Type.Number({ minimum: 0, default: 0, description: 'Display order' })),
  isActive: Type.Optional(Type.Boolean({ default: true, description: 'Whether the field is active' })),
});

export type CreateCustomFieldDefinitionInput = Static<typeof CreateCustomFieldDefinitionSchema>;

/**
 * Schema for updating a custom field definition.
 */
export const UpdateCustomFieldDefinitionSchema = Type.Object({
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 255, description: 'Human-readable label' })),
  description: Type.Optional(Type.Union([
    Type.String({ maxLength: 1000 }),
    Type.Null(),
  ], { description: 'Optional description/help text' })),
  validationRules: Type.Optional(ValidationRulesSchema),
  displayOrder: Type.Optional(Type.Number({ minimum: 0, description: 'Display order' })),
  isActive: Type.Optional(Type.Boolean({ description: 'Whether the field is active' })),
});

export type UpdateCustomFieldDefinitionInput = Static<typeof UpdateCustomFieldDefinitionSchema>;

/**
 * Schema for setting a custom field value.
 */
export const SetCustomFieldValueSchema = Type.Object({
  entityType: CustomFieldEntityTypeSchema,
  entityId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Entity UUID',
  }),
  fieldDefinitionId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Custom field definition UUID',
  }),
  value: Type.Unknown({ description: 'The field value (validated against definition rules)' }),
});

export type SetCustomFieldValueInput = Static<typeof SetCustomFieldValueSchema>;

/**
 * Schema for bulk setting custom field values for an entity.
 */
export const BulkSetCustomFieldValuesSchema = Type.Object({
  entityType: CustomFieldEntityTypeSchema,
  entityId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Entity UUID',
  }),
  values: Type.Record(Type.String(), Type.Unknown(), {
    description: 'Map of fieldDefinitionId to value',
  }),
});

export type BulkSetCustomFieldValuesInput = Static<typeof BulkSetCustomFieldValuesSchema>;

/**
 * Schema for custom field definition list query parameters.
 */
export const CustomFieldDefinitionListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1, description: 'Page number' })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' })),
  entityType: Type.Optional(CustomFieldEntityTypeSchema),
  isActive: Type.Optional(Type.Boolean({ description: 'Filter by active status' })),
  search: Type.Optional(Type.String({ description: 'Search by label or field key' })),
});

export type CustomFieldDefinitionListQuery = Static<typeof CustomFieldDefinitionListQuerySchema>;

/**
 * Schema for custom field definition ID path parameter.
 */
export const CustomFieldDefinitionParamsSchema = Type.Object({
  id: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Custom field definition UUID',
  }),
});

export type CustomFieldDefinitionParams = Static<typeof CustomFieldDefinitionParamsSchema>;

/**
 * Schema for entity values query parameters.
 */
export const EntityValuesParamsSchema = Type.Object({
  entityType: CustomFieldEntityTypeSchema,
  entityId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Entity UUID',
  }),
});

export type EntityValuesParams = Static<typeof EntityValuesParamsSchema>;
