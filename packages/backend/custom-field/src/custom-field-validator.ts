/**
 * Custom Field Value Validator
 *
 * Validates custom field values against their definition's type and validation rules.
 * Returns structured field-level errors compatible with the platform's error format.
 *
 * Requirements:
 * - 6.5: Support Custom_Fields to extend student profiles without database schema changes
 * - 7.6: Support Custom_Fields to extend staff profiles without database schema changes
 */
import type { FieldError } from '@proctira/common';

import type {
  CustomFieldDefinition,
  CustomFieldType,
  CustomFieldValidationRules,
} from './custom-field-repository.js';

/**
 * Result of validating a custom field value.
 */
export type CustomFieldValidationResult = { valid: true } | { valid: false; errors: FieldError[] };

/**
 * Validates a value against a custom field definition's type and rules.
 *
 * @param definition - The custom field definition
 * @param value - The value to validate
 * @returns Validation result with errors if invalid
 */
export function validateCustomFieldValue(
  definition: CustomFieldDefinition,
  value: unknown,
): CustomFieldValidationResult {
  const errors: FieldError[] = [];
  const fieldPath = `customFields.${definition.fieldKey}`;
  const rules = definition.validationRules;

  // Check required
  if (rules.required && (value === null || value === undefined || value === '')) {
    errors.push({
      field: fieldPath,
      message: `${definition.label} is required`,
      rule: 'required',
    });
    return { valid: false, errors };
  }

  // If value is null/undefined and not required, it's valid
  if (value === null || value === undefined || value === '') {
    return { valid: true };
  }

  // Type-specific validation
  const typeErrors = validateByType(
    definition.fieldType,
    value,
    fieldPath,
    definition.label,
    rules,
  );
  errors.push(...typeErrors);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

/**
 * Validates a value based on the field type.
 */
function validateByType(
  fieldType: CustomFieldType,
  value: unknown,
  fieldPath: string,
  label: string,
  rules: CustomFieldValidationRules,
): FieldError[] {
  switch (fieldType) {
    case 'text':
      return validateText(value, fieldPath, label, rules);
    case 'textarea':
      return validateText(value, fieldPath, label, rules);
    case 'number':
      return validateNumber(value, fieldPath, label, rules);
    case 'date':
      return validateDate(value, fieldPath, label);
    case 'dropdown':
      return validateDropdown(value, fieldPath, label, rules);
    case 'checkbox':
      return validateCheckbox(value, fieldPath, label);
    case 'file':
      return validateFile(value, fieldPath, label, rules);
    default:
      return [
        {
          field: fieldPath,
          message: `${label} has unsupported field type`,
          rule: 'type',
        },
      ];
  }
}

/**
 * Validates text and textarea field values.
 */
function validateText(
  value: unknown,
  fieldPath: string,
  label: string,
  rules: CustomFieldValidationRules,
): FieldError[] {
  const errors: FieldError[] = [];

  if (typeof value !== 'string') {
    errors.push({
      field: fieldPath,
      message: `${label} must be a string`,
      rule: 'type',
    });
    return errors;
  }

  if (rules.minLength !== undefined && value.length < rules.minLength) {
    errors.push({
      field: fieldPath,
      message: `${label} must be at least ${rules.minLength} characters`,
      rule: 'minLength',
    });
  }

  if (rules.maxLength !== undefined && value.length > rules.maxLength) {
    errors.push({
      field: fieldPath,
      message: `${label} must be at most ${rules.maxLength} characters`,
      rule: 'maxLength',
    });
  }

  if (rules.pattern !== undefined) {
    try {
      const regex = new RegExp(rules.pattern);
      if (!regex.test(value)) {
        errors.push({
          field: fieldPath,
          message: `${label} does not match the required pattern`,
          rule: 'pattern',
        });
      }
    } catch {
      // Invalid regex in definition — skip pattern validation
    }
  }

  return errors;
}

/**
 * Validates number field values.
 */
function validateNumber(
  value: unknown,
  fieldPath: string,
  label: string,
  rules: CustomFieldValidationRules,
): FieldError[] {
  const errors: FieldError[] = [];

  if (typeof value !== 'number' || Number.isNaN(value)) {
    errors.push({
      field: fieldPath,
      message: `${label} must be a number`,
      rule: 'type',
    });
    return errors;
  }

  if (rules.min !== undefined && value < rules.min) {
    errors.push({
      field: fieldPath,
      message: `${label} must be at least ${rules.min}`,
      rule: 'minimum',
    });
  }

  if (rules.max !== undefined && value > rules.max) {
    errors.push({
      field: fieldPath,
      message: `${label} must be at most ${rules.max}`,
      rule: 'maximum',
    });
  }

  return errors;
}

/**
 * Validates date field values (ISO 8601 date string).
 */
function validateDate(value: unknown, fieldPath: string, label: string): FieldError[] {
  const errors: FieldError[] = [];

  if (typeof value !== 'string') {
    errors.push({
      field: fieldPath,
      message: `${label} must be a date string (YYYY-MM-DD)`,
      rule: 'type',
    });
    return errors;
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(value)) {
    errors.push({
      field: fieldPath,
      message: `${label} must be a valid date (YYYY-MM-DD)`,
      rule: 'pattern',
    });
    return errors;
  }

  // Verify it's a real date
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    errors.push({
      field: fieldPath,
      message: `${label} must be a valid date`,
      rule: 'invalid',
    });
  }

  return errors;
}

/**
 * Validates dropdown field values against allowed options.
 */
function validateDropdown(
  value: unknown,
  fieldPath: string,
  label: string,
  rules: CustomFieldValidationRules,
): FieldError[] {
  const errors: FieldError[] = [];

  if (typeof value !== 'string') {
    errors.push({
      field: fieldPath,
      message: `${label} must be a string`,
      rule: 'type',
    });
    return errors;
  }

  if (rules.options && rules.options.length > 0) {
    if (!rules.options.includes(value)) {
      errors.push({
        field: fieldPath,
        message: `${label} must be one of: ${rules.options.join(', ')}`,
        rule: 'enum',
      });
    }
  }

  return errors;
}

/**
 * Validates checkbox field values (must be boolean).
 */
function validateCheckbox(value: unknown, fieldPath: string, label: string): FieldError[] {
  const errors: FieldError[] = [];

  if (typeof value !== 'boolean') {
    errors.push({
      field: fieldPath,
      message: `${label} must be a boolean`,
      rule: 'type',
    });
  }

  return errors;
}

/**
 * Validates file field values.
 * File values are expected to be objects with { filename, size, mimeType } metadata.
 */
function validateFile(
  value: unknown,
  fieldPath: string,
  label: string,
  rules: CustomFieldValidationRules,
): FieldError[] {
  const errors: FieldError[] = [];

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push({
      field: fieldPath,
      message: `${label} must be a file object with filename, size, and mimeType`,
      rule: 'type',
    });
    return errors;
  }

  const fileValue = value as Record<string, unknown>;

  if (typeof fileValue['filename'] !== 'string' || fileValue['filename'].length === 0) {
    errors.push({
      field: fieldPath,
      message: `${label} must include a filename`,
      rule: 'required',
    });
    return errors;
  }

  if (typeof fileValue['size'] !== 'number') {
    errors.push({
      field: fieldPath,
      message: `${label} must include a numeric file size`,
      rule: 'type',
    });
    return errors;
  }

  // Check file extension
  if (rules.allowedExtensions && rules.allowedExtensions.length > 0) {
    const filename = fileValue['filename'] as string;
    const ext = filename.includes('.') ? '.' + filename.split('.').pop()!.toLowerCase() : '';
    if (!rules.allowedExtensions.includes(ext)) {
      errors.push({
        field: fieldPath,
        message: `${label} must have one of these extensions: ${rules.allowedExtensions.join(', ')}`,
        rule: 'fileExtension',
      });
    }
  }

  // Check file size
  if (rules.maxFileSize !== undefined) {
    const size = fileValue['size'] as number;
    if (size > rules.maxFileSize) {
      errors.push({
        field: fieldPath,
        message: `${label} exceeds maximum file size of ${rules.maxFileSize} bytes`,
        rule: 'maxFileSize',
      });
    }
  }

  return errors;
}
