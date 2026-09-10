/**
 * Custom Field Repository Interface
 *
 * Defines the data access contract for custom field definitions and values.
 * Implementations can use Prisma, in-memory stores, or other backends.
 *
 * Requirements:
 * - 6.5: Support Custom_Fields to extend student profiles without database schema changes
 * - 7.6: Support Custom_Fields to extend staff profiles without database schema changes
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

/**
 * Supported custom field types.
 */
export type CustomFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'dropdown'
  | 'checkbox'
  | 'textarea'
  | 'file';

/**
 * Entity types that support custom fields.
 */
export type CustomFieldEntityType = 'student' | 'staff' | 'institution';

/**
 * Validation rules for a custom field definition.
 */
export interface CustomFieldValidationRules {
  /** Whether the field is required */
  required?: boolean;
  /** Minimum length for text/textarea fields */
  minLength?: number;
  /** Maximum length for text/textarea fields */
  maxLength?: number;
  /** Minimum value for number fields */
  min?: number;
  /** Maximum value for number fields */
  max?: number;
  /** Regex pattern for text fields */
  pattern?: string;
  /** Allowed file extensions for file fields (e.g., [".pdf", ".jpg"]) */
  allowedExtensions?: string[];
  /** Maximum file size in bytes for file fields */
  maxFileSize?: number;
  /** Dropdown options for dropdown fields */
  options?: string[];
}

/**
 * Custom field definition entity as stored in the database.
 */
export interface CustomFieldDefinition {
  id: string;
  tenantId: string;
  /** Entity type this field applies to */
  entityType: CustomFieldEntityType;
  /** Machine-readable field key (unique per tenant + entity type) */
  fieldKey: string;
  /** Human-readable label */
  label: string;
  /** Optional description/help text */
  description: string | null;
  /** Field data type */
  fieldType: CustomFieldType;
  /** Validation rules */
  validationRules: CustomFieldValidationRules;
  /** Display order (lower = first) */
  displayOrder: number;
  /** Whether the field is active */
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Custom field value entity stored in JSONB.
 */
export interface CustomFieldValue {
  id: string;
  tenantId: string;
  /** The entity type (student, staff, institution) */
  entityType: CustomFieldEntityType;
  /** The ID of the entity this value belongs to */
  entityId: string;
  /** The custom field definition ID */
  fieldDefinitionId: string;
  /** The stored value (JSONB) */
  value: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filter options for listing custom field definitions.
 */
export interface CustomFieldDefinitionFilter {
  entityType?: CustomFieldEntityType;
  isActive?: boolean;
  search?: string;
}

/**
 * Repository interface for custom field definitions.
 */
export interface CustomFieldDefinitionRepository {
  /** Create a new custom field definition */
  create(
    data: Omit<CustomFieldDefinition, 'createdAt' | 'updatedAt'>,
  ): Promise<CustomFieldDefinition>;

  /** Update an existing custom field definition */
  update(
    id: string,
    tenantId: string,
    data: Partial<CustomFieldDefinition>,
  ): Promise<CustomFieldDefinition | null>;

  /** Find a definition by ID within a tenant */
  findById(id: string, tenantId: string): Promise<CustomFieldDefinition | null>;

  /** Find a definition by field key within a tenant and entity type */
  findByFieldKey(
    fieldKey: string,
    entityType: CustomFieldEntityType,
    tenantId: string,
  ): Promise<CustomFieldDefinition | null>;

  /** List definitions with pagination and filtering */
  list(
    tenantId: string,
    filter: CustomFieldDefinitionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<CustomFieldDefinition>>;

  /** Delete a definition (soft delete by setting isActive = false) */
  delete(id: string, tenantId: string): Promise<boolean>;
}

/**
 * Repository interface for custom field values.
 */
export interface CustomFieldValueRepository {
  /** Set (create or update) a custom field value for an entity */
  setValue(data: Omit<CustomFieldValue, 'createdAt' | 'updatedAt'>): Promise<CustomFieldValue>;

  /** Get all custom field values for an entity */
  getValuesForEntity(
    tenantId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
  ): Promise<CustomFieldValue[]>;

  /** Get a specific field value for an entity */
  getValue(
    tenantId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
    fieldDefinitionId: string,
  ): Promise<CustomFieldValue | null>;

  /** Delete all custom field values for an entity */
  deleteValuesForEntity(
    tenantId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
  ): Promise<number>;

  /** Delete a specific field value */
  deleteValue(
    tenantId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
    fieldDefinitionId: string,
  ): Promise<boolean>;
}
