import { Value } from '@sinclair/typebox/value';
import { describe, it, expect } from 'vitest';

import { FieldErrorSchema, ApiErrorSchema } from './index.js';

describe('FieldErrorSchema', () => {
  it('should validate a correct field error object', () => {
    const fieldError = {
      field: 'body.email',
      rule: 'format',
      message: 'Invalid email format',
    };

    expect(Value.Check(FieldErrorSchema, fieldError)).toBe(true);
  });

  it('should reject an object missing required fields', () => {
    const incomplete = {
      field: 'body.email',
      // missing rule and message
    };

    expect(Value.Check(FieldErrorSchema, incomplete)).toBe(false);
  });

  it('should reject non-string field values', () => {
    const invalid = {
      field: 123,
      rule: 'required',
      message: 'Field is required',
    };

    expect(Value.Check(FieldErrorSchema, invalid)).toBe(false);
  });
});

describe('ApiErrorSchema', () => {
  it('should validate a complete API error with field errors', () => {
    const apiError = {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      statusCode: 400,
      errors: [
        { field: 'body.name', rule: 'required', message: 'Name is required' },
      ],
    };

    expect(Value.Check(ApiErrorSchema, apiError)).toBe(true);
  });

  it('should validate an API error without field errors', () => {
    const apiError = {
      code: 'NOT_FOUND',
      message: 'Resource not found',
      statusCode: 404,
    };

    expect(Value.Check(ApiErrorSchema, apiError)).toBe(true);
  });

  it('should reject an API error with invalid status code', () => {
    const apiError = {
      code: 'NOT_FOUND',
      message: 'Resource not found',
      statusCode: 200, // not in 400-599 range
    };

    expect(Value.Check(ApiErrorSchema, apiError)).toBe(false);
  });

  it('should reject an API error missing required fields', () => {
    const incomplete = {
      code: 'INTERNAL_ERROR',
      // missing message and statusCode
    };

    expect(Value.Check(ApiErrorSchema, incomplete)).toBe(false);
  });

  it('should validate an API error with empty errors array', () => {
    const apiError = {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      statusCode: 400,
      errors: [],
    };

    expect(Value.Check(ApiErrorSchema, apiError)).toBe(true);
  });
});
