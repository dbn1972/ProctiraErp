/**
 * Custom Field Service
 *
 * Business logic for custom field definition CRUD and value management.
 * Validates field definitions, enforces uniqueness of field keys per tenant/entity type,
 * and validates values against their definition's rules before storage.
 *
 * Requirements:
 * - 6.5: Support Custom_Fields to extend student profiles without database schema changes
 * - 7.6: Support Custom_Fields to extend staff profiles without database schema changes
 */
import { ConflictError, NotFoundError, ValidationError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult, FieldError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  CustomFieldDefinition,
  CustomFieldDefinitionFilter,
  CustomFieldDefinitionRepository,
  CustomFieldEntityType,
  CustomFieldValue,
  CustomFieldValueRepository,
} from './custom-field-repository.js';
import type {
  CreateCustomFieldDefinitionInput,
  UpdateCustomFieldDefinitionInput,
} from './schemas.js';
import { validateCustomFieldValue } from './custom-field-validator.js';

/**
 * Service handling custom field business logic.
 */
export class CustomFieldService {
  constructor(
    private readonly definitionRepository: CustomFieldDefinitionRepository,
    private readonly valueRepository: CustomFieldValueRepository,
  ) {}

  // ─── Definition CRUD ───────────────────────────────────────────────────────

  /**
   * Create a new custom field definition.
   *
   * Validates:
   * - Field key is unique within the tenant and entity type
   * - Dropdown fields must have at least one option defined
   *
   * @throws ConflictError if field key already exists for this tenant/entity type
   * @throws ValidationError if definition is invalid
   */
  async createDefinition(
    tenantId: string,
    input: CreateCustomFieldDefinitionInput,
  ): Promise<CustomFieldDefinition> {
    // Check field key uniqueness within tenant + entity type
    const existing = await this.definitionRepository.findByFieldKey(
      input.fieldKey,
      input.entityType,
      tenantId,
    );
    if (existing) {
      throw new ConflictError(
        `Custom field with key '${input.fieldKey}' already exists for entity type '${input.entityType}'`,
      );
    }

    // Validate dropdown fields have options
    if (input.fieldType === 'dropdown') {
      const options = input.validationRules?.options;
      if (!options || options.length === 0) {
        throw new ValidationError('Dropdown fields must have at least one option defined', [
          {
            field: 'validationRules.options',
            message: 'Dropdown fields must have at least one option defined',
            rule: 'required',
          },
        ]);
      }
    }

    const definition: Omit<CustomFieldDefinition, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      entityType: input.entityType,
      fieldKey: input.fieldKey,
      label: input.label,
      description: input.description ?? null,
      fieldType: input.fieldType,
      validationRules: input.validationRules ?? {},
      displayOrder: input.displayOrder ?? 0,
      isActive: input.isActive ?? true,
    };

    return this.definitionRepository.create(definition);
  }

  /**
   * Update an existing custom field definition.
   *
   * @throws NotFoundError if definition not found
   */
  async updateDefinition(
    tenantId: string,
    id: string,
    input: UpdateCustomFieldDefinitionInput,
  ): Promise<CustomFieldDefinition> {
    const existing = await this.definitionRepository.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Custom field definition with id '${id}' not found`);
    }

    const updateData: Partial<CustomFieldDefinition> = {};
    if (input.label !== undefined) updateData.label = input.label;
    if (input.description !== undefined) updateData.description = input.description ?? null;
    if (input.validationRules !== undefined) updateData.validationRules = input.validationRules;
    if (input.displayOrder !== undefined) updateData.displayOrder = input.displayOrder;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;

    const updated = await this.definitionRepository.update(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Custom field definition with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Get a custom field definition by ID.
   *
   * @throws NotFoundError if definition not found
   */
  async getDefinitionById(tenantId: string, id: string): Promise<CustomFieldDefinition> {
    const definition = await this.definitionRepository.findById(id, tenantId);
    if (!definition) {
      throw new NotFoundError(`Custom field definition with id '${id}' not found`);
    }
    return definition;
  }

  /**
   * List custom field definitions with pagination and filtering.
   */
  async listDefinitions(
    tenantId: string,
    filter: CustomFieldDefinitionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<CustomFieldDefinition>> {
    return this.definitionRepository.list(tenantId, filter, pagination);
  }

  /**
   * Delete (deactivate) a custom field definition.
   *
   * @throws NotFoundError if definition not found
   */
  async deleteDefinition(tenantId: string, id: string): Promise<void> {
    const deleted = await this.definitionRepository.delete(id, tenantId);
    if (!deleted) {
      throw new NotFoundError(`Custom field definition with id '${id}' not found`);
    }
  }

  // ─── Value Management ──────────────────────────────────────────────────────

  /**
   * Set a custom field value for an entity.
   * Validates the value against the field definition's type and rules.
   *
   * @throws NotFoundError if field definition not found
   * @throws ValidationError if value fails validation
   */
  async setValue(
    tenantId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
    fieldDefinitionId: string,
    value: unknown,
  ): Promise<CustomFieldValue> {
    // Get the field definition
    const definition = await this.definitionRepository.findById(fieldDefinitionId, tenantId);
    if (!definition) {
      throw new NotFoundError(`Custom field definition with id '${fieldDefinitionId}' not found`);
    }

    // Verify entity type matches
    if (definition.entityType !== entityType) {
      throw new ValidationError(
        `Field '${definition.fieldKey}' is defined for '${definition.entityType}', not '${entityType}'`,
        [
          {
            field: 'entityType',
            message: `Field '${definition.fieldKey}' is defined for '${definition.entityType}', not '${entityType}'`,
            rule: 'entityType',
          },
        ],
      );
    }

    // Validate the value
    const validationResult = validateCustomFieldValue(definition, value);
    if (!validationResult.valid) {
      throw new ValidationError(
        `Validation failed for custom field '${definition.label}'`,
        validationResult.errors,
      );
    }

    // Store the value
    const valueRecord: Omit<CustomFieldValue, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      entityType,
      entityId,
      fieldDefinitionId,
      value,
    };

    return this.valueRepository.setValue(valueRecord);
  }

  /**
   * Bulk set custom field values for an entity.
   * Validates all values before storing any.
   *
   * @throws ValidationError if any value fails validation (with all errors)
   */
  async bulkSetValues(
    tenantId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
    values: Record<string, unknown>,
  ): Promise<CustomFieldValue[]> {
    const allErrors: FieldError[] = [];
    const validEntries: Array<{ definition: CustomFieldDefinition; value: unknown }> = [];

    // Validate all values first
    for (const [fieldDefinitionId, value] of Object.entries(values)) {
      const definition = await this.definitionRepository.findById(fieldDefinitionId, tenantId);
      if (!definition) {
        allErrors.push({
          field: `values.${fieldDefinitionId}`,
          message: `Custom field definition '${fieldDefinitionId}' not found`,
          rule: 'notFound',
        });
        continue;
      }

      if (definition.entityType !== entityType) {
        allErrors.push({
          field: `values.${fieldDefinitionId}`,
          message: `Field '${definition.fieldKey}' is defined for '${definition.entityType}', not '${entityType}'`,
          rule: 'entityType',
        });
        continue;
      }

      const validationResult = validateCustomFieldValue(definition, value);
      if (!validationResult.valid) {
        allErrors.push(...validationResult.errors);
      } else {
        validEntries.push({ definition, value });
      }
    }

    if (allErrors.length > 0) {
      throw new ValidationError('Validation failed for one or more custom field values', allErrors);
    }

    // Store all valid values
    const results: CustomFieldValue[] = [];
    for (const { definition, value } of validEntries) {
      const valueRecord: Omit<CustomFieldValue, 'createdAt' | 'updatedAt'> = {
        id: uuidv4(),
        tenantId,
        entityType,
        entityId,
        fieldDefinitionId: definition.id,
        value,
      };
      const stored = await this.valueRepository.setValue(valueRecord);
      results.push(stored);
    }

    return results;
  }

  /**
   * Get all custom field values for an entity.
   */
  async getValuesForEntity(
    tenantId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
  ): Promise<CustomFieldValue[]> {
    return this.valueRepository.getValuesForEntity(tenantId, entityType, entityId);
  }

  /**
   * Delete all custom field values for an entity.
   */
  async deleteValuesForEntity(
    tenantId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
  ): Promise<number> {
    return this.valueRepository.deleteValuesForEntity(tenantId, entityType, entityId);
  }
}
