/**
 * Property-based tests for API validation structured errors.
 *
 * Property 1: API Validation Produces Structured Errors
 *
 * **Validates: Requirements 2.3, 2.4**
 *
 * For any API request with an invalid payload (missing required fields, wrong types,
 * constraint violations), the system SHALL reject it with a structured error response
 * containing an error code, human-readable message, and an array of field-level error
 * objects each identifying the field path and the validation rule that failed.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { Type, type TSchema } from '@sinclair/typebox';

import { validate } from './validator';

// --- Arbitraries ---

/** Generates a valid string value satisfying minLength/maxLength constraints. */
function validStringArb(minLength = 1, maxLength = 50): fc.Arbitrary<string> {
  return fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
    { minLength, maxLength },
  );
}

/** Generates a valid number within a range. */
function validNumberArb(min = 0, max = 1000): fc.Arbitrary<number> {
  return fc.integer({ min, max });
}

/** Generates a valid email-like string. */
const validEmailArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 10 }),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 8 }),
    fc.constantFrom('com', 'org', 'net', 'edu'),
  )
  .map(([user, domain, tld]) => `${user}@${domain}.${tld}`);

/** Generates a valid UUID v4 string. */
const validUuidArb: fc.Arbitrary<string> = fc.uuid();

/**
 * A representative API schema simulating a typical endpoint payload.
 * This schema has required fields, type constraints, and format constraints.
 */
const SampleApiSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  code: Type.String({ minLength: 1, maxLength: 50 }),
  age: Type.Number({ minimum: 0, maximum: 150 }),
  email: Type.String({ minLength: 5, maxLength: 255 }),
  active: Type.Boolean(),
});

/**
 * A nested schema to test field path reporting for nested objects.
 */
const NestedApiSchema = Type.Object({
  institution: Type.Object({
    name: Type.String({ minLength: 1, maxLength: 255 }),
    code: Type.String({ minLength: 1, maxLength: 50 }),
    address: Type.Object({
      city: Type.String({ minLength: 1 }),
      zip: Type.String({ minLength: 5, maxLength: 10 }),
    }),
  }),
  contact: Type.Object({
    phone: Type.String({ minLength: 7, maxLength: 20 }),
  }),
});

/**
 * A schema with array fields to test array item path reporting.
 */
const ArrayApiSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      name: Type.String({ minLength: 1 }),
      quantity: Type.Number({ minimum: 1 }),
    }),
  ),
});

/** Generates a fully valid payload for SampleApiSchema. */
const validSamplePayloadArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(
    validStringArb(1, 100),
    validStringArb(1, 50),
    validNumberArb(0, 150),
    validEmailArb,
    fc.boolean(),
  )
  .map(([name, code, age, email, active]) => ({ name, code, age, email, active }));

/** Generates a fully valid payload for NestedApiSchema. */
const validNestedPayloadArb: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(
    validStringArb(1, 100),
    validStringArb(1, 50),
    validStringArb(1, 50),
    validStringArb(5, 10),
    validStringArb(7, 20),
  )
  .map(([name, code, city, zip, phone]) => ({
    institution: { name, code, address: { city, zip } },
    contact: { phone },
  }));

/**
 * Generates an invalid payload by applying one or more mutations to a valid payload.
 * Mutations include: removing required fields, wrong types, constraint violations.
 */
const invalidSamplePayloadArb: fc.Arbitrary<{ payload: Record<string, unknown>; invalidFields: string[] }> = fc
  .tuple(
    validSamplePayloadArb,
    fc.constantFrom(
      'remove_name',
      'remove_code',
      'wrong_type_age',
      'wrong_type_active',
      'violate_minLength_name',
      'violate_maxLength_code',
      'violate_minimum_age',
      'violate_maximum_age',
    ),
  )
  .map(([payload, mutation]) => {
    const mutated = { ...payload };
    let invalidFields: string[] = [];

    switch (mutation) {
      case 'remove_name':
        delete mutated.name;
        invalidFields = ['name'];
        break;
      case 'remove_code':
        delete mutated.code;
        invalidFields = ['code'];
        break;
      case 'wrong_type_age':
        mutated.age = 'not-a-number';
        invalidFields = ['age'];
        break;
      case 'wrong_type_active':
        mutated.active = 'not-a-boolean';
        invalidFields = ['active'];
        break;
      case 'violate_minLength_name':
        mutated.name = '';
        invalidFields = ['name'];
        break;
      case 'violate_maxLength_code':
        mutated.code = 'x'.repeat(51);
        invalidFields = ['code'];
        break;
      case 'violate_minimum_age':
        mutated.age = -1;
        invalidFields = ['age'];
        break;
      case 'violate_maximum_age':
        mutated.age = 200;
        invalidFields = ['age'];
        break;
    }

    return { payload: mutated, invalidFields };
  });

/**
 * Generates payloads with multiple simultaneous violations.
 */
const multipleViolationsPayloadArb: fc.Arbitrary<{ payload: Record<string, unknown>; expectedMinErrors: number }> = fc
  .tuple(
    fc.subarray(
      ['name', 'code', 'age', 'email', 'active'] as const,
      { minLength: 2, maxLength: 5 },
    ),
  )
  .map(([fieldsToRemove]) => {
    const payload: Record<string, unknown> = {};
    // Start with a valid payload but remove selected fields
    if (!fieldsToRemove.includes('name')) payload.name = 'ValidName';
    if (!fieldsToRemove.includes('code')) payload.code = 'CODE1';
    if (!fieldsToRemove.includes('age')) payload.age = 25;
    if (!fieldsToRemove.includes('email')) payload.email = 'test@example.com';
    if (!fieldsToRemove.includes('active')) payload.active = true;

    return { payload, expectedMinErrors: fieldsToRemove.length };
  });

// --- Property Tests ---

describe('Property 1: API Validation Produces Structured Errors', () => {
  // Feature: proctira-unified-platform, Property 1: API Validation Produces Structured Errors
  // **Validates: Requirements 2.3, 2.4**

  describe('Valid payloads are accepted without errors', () => {
    it('any valid payload matching the schema produces a success result with no validation errors', () => {
      fc.assert(
        fc.property(
          validSamplePayloadArb,
          (payload) => {
            const result = validate(SampleApiSchema, payload);

            // Valid payloads must be accepted
            expect(result.success).toBe(true);
            if (result.success) {
              // Validated data should contain all the original fields
              expect(result.data.name).toBe(payload.name);
              expect(result.data.code).toBe(payload.code);
              expect(result.data.age).toBe(payload.age);
              expect(result.data.email).toBe(payload.email);
              expect(result.data.active).toBe(payload.active);
            }
          },
        ),
        { numRuns: 200 },
      );
    });

    it('any valid nested payload matching the schema produces a success result', () => {
      fc.assert(
        fc.property(
          validNestedPayloadArb,
          (payload) => {
            const result = validate(NestedApiSchema, payload);
            expect(result.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Invalid payloads produce structured error responses', () => {
    it('any invalid payload produces a failure result with field-level errors', () => {
      fc.assert(
        fc.property(
          invalidSamplePayloadArb,
          ({ payload, invalidFields }) => {
            const result = validate(SampleApiSchema, payload);

            // Invalid payloads must be rejected
            expect(result.success).toBe(false);
            if (!result.success) {
              // Must have at least one error
              expect(result.errors.length).toBeGreaterThan(0);

              // Each error must have the required structure
              for (const error of result.errors) {
                // Field path must be a non-empty string
                expect(typeof error.field).toBe('string');
                expect(error.field.length).toBeGreaterThan(0);

                // Human-readable message must be a non-empty string
                expect(typeof error.message).toBe('string');
                expect(error.message.length).toBeGreaterThan(0);

                // Rule must be a non-empty string identifying the validation rule
                expect(typeof error.rule).toBe('string');
                expect(error.rule.length).toBeGreaterThan(0);
              }

              // The invalid fields should be identified in the errors
              const errorFields = result.errors.map((e) => e.field);
              for (const field of invalidFields) {
                expect(errorFields).toContain(field);
              }
            }
          },
        ),
        { numRuns: 200 },
      );
    });

    it('each field-level error identifies the field path and the validation rule that failed', () => {
      fc.assert(
        fc.property(
          invalidSamplePayloadArb,
          ({ payload }) => {
            const result = validate(SampleApiSchema, payload);

            if (!result.success) {
              for (const error of result.errors) {
                // Field path must be a dot-notation path (no leading slash)
                expect(error.field).not.toMatch(/^\//);

                // Rule must be one of the known validation rules
                const knownRules = [
                  'required', 'type', 'minLength', 'maxLength',
                  'minimum', 'maximum', 'pattern', 'format', 'invalid',
                ];
                expect(knownRules).toContain(error.rule);

                // Message must be human-readable (not a raw JSON path or schema reference)
                expect(error.message).not.toMatch(/^\//);
                expect(error.message.length).toBeGreaterThan(3);
              }
            }
          },
        ),
        { numRuns: 200 },
      );
    });

    it('multiple field violations produce multiple field-level errors', () => {
      fc.assert(
        fc.property(
          multipleViolationsPayloadArb,
          ({ payload, expectedMinErrors }) => {
            const result = validate(SampleApiSchema, payload);

            expect(result.success).toBe(false);
            if (!result.success) {
              // Should have at least as many errors as fields removed
              expect(result.errors.length).toBeGreaterThanOrEqual(expectedMinErrors);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Error response format is consistent regardless of which fields fail', () => {
    it('error structure is identical whether one field or many fields fail validation', () => {
      fc.assert(
        fc.property(
          // Generate a random subset of fields to invalidate
          fc.subarray(
            ['name', 'code', 'age', 'email', 'active'] as const,
            { minLength: 1, maxLength: 5 },
          ),
          (fieldsToInvalidate) => {
            const payload: Record<string, unknown> = {
              name: 'ValidName',
              code: 'CODE1',
              age: 25,
              email: 'test@example.com',
              active: true,
            };

            // Invalidate selected fields
            for (const field of fieldsToInvalidate) {
              delete payload[field];
            }

            const result = validate(SampleApiSchema, payload);

            expect(result.success).toBe(false);
            if (!result.success) {
              // Every error must have the same consistent structure
              for (const error of result.errors) {
                // Must have exactly these three properties as strings
                expect(Object.keys(error).sort()).toEqual(['field', 'message', 'rule']);
                expect(typeof error.field).toBe('string');
                expect(typeof error.message).toBe('string');
                expect(typeof error.rule).toBe('string');

                // None should be empty
                expect(error.field.length).toBeGreaterThan(0);
                expect(error.message.length).toBeGreaterThan(0);
                expect(error.rule.length).toBeGreaterThan(0);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('nested field paths use dot notation consistently for any schema depth', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            // Various invalid nested payloads
            { institution: { name: '', code: 'x', address: { city: '', zip: 'ab' } }, contact: { phone: '12' } },
            { institution: { name: 123, code: true, address: { city: 456, zip: 789 } }, contact: { phone: false } },
            { institution: { name: 'Valid', code: 'V', address: {} }, contact: {} },
          ),
          (payload) => {
            const result = validate(NestedApiSchema, payload as unknown);

            if (!result.success) {
              for (const error of result.errors) {
                // Field paths for nested objects must use dot notation
                // e.g., "institution.name", "institution.address.city"
                expect(error.field).not.toContain('/');

                // Structure must be consistent
                expect(typeof error.field).toBe('string');
                expect(typeof error.message).toBe('string');
                expect(typeof error.rule).toBe('string');
                expect(error.field.length).toBeGreaterThan(0);
                expect(error.message.length).toBeGreaterThan(0);
                expect(error.rule.length).toBeGreaterThan(0);
              }
            }
          },
        ),
        { numRuns: 50 },
      );
    });

    it('array item field paths include the index in dot notation', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              name: fc.constantFrom('', 'valid'),
              quantity: fc.constantFrom(-1, 0, 1, 5),
            }),
            { minLength: 1, maxLength: 5 },
          ),
          (items) => {
            const hasInvalid = items.some((item) => item.name === '' || item.quantity < 1);
            const payload = { items };

            const result = validate(ArrayApiSchema, payload);

            if (hasInvalid) {
              expect(result.success).toBe(false);
              if (!result.success) {
                for (const error of result.errors) {
                  // Array item paths should be like "items.0.name" or "items.1.quantity"
                  expect(error.field).toMatch(/^items\.\d+\./);

                  // Consistent structure
                  expect(typeof error.field).toBe('string');
                  expect(typeof error.message).toBe('string');
                  expect(typeof error.rule).toBe('string');
                }
              }
            } else {
              expect(result.success).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Validation rules are correctly identified', () => {
    it('type violations produce "type" rule for any field with wrong type', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('name', 'code', 'email'),
          fc.constantFrom(123, true, null, [], {}),
          (field, wrongValue) => {
            const payload: Record<string, unknown> = {
              name: 'ValidName',
              code: 'CODE1',
              age: 25,
              email: 'test@example.com',
              active: true,
            };
            payload[field] = wrongValue;

            const result = validate(SampleApiSchema, payload);

            expect(result.success).toBe(false);
            if (!result.success) {
              const fieldError = result.errors.find((e) => e.field === field);
              expect(fieldError).toBeDefined();
              expect(fieldError!.rule).toBe('type');
            }
          },
        ),
        { numRuns: 50 },
      );
    });

    it('constraint violations produce the correct rule name', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            { field: 'name', value: '', expectedRule: 'minLength' },
            { field: 'code', value: 'x'.repeat(51), expectedRule: 'maxLength' },
            { field: 'age', value: -1, expectedRule: 'minimum' },
            { field: 'age', value: 200, expectedRule: 'maximum' },
          ),
          ({ field, value, expectedRule }) => {
            const payload: Record<string, unknown> = {
              name: 'ValidName',
              code: 'CODE1',
              age: 25,
              email: 'test@example.com',
              active: true,
            };
            payload[field] = value;

            const result = validate(SampleApiSchema, payload);

            expect(result.success).toBe(false);
            if (!result.success) {
              const fieldError = result.errors.find((e) => e.field === field);
              expect(fieldError).toBeDefined();
              expect(fieldError!.rule).toBe(expectedRule);
            }
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
