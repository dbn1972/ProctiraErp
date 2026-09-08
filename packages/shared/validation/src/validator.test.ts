import { Type } from '@sinclair/typebox';
import { describe, it, expect } from 'vitest';

import { validate, validateQuery } from './validator';

describe('validate', () => {
  describe('successful validation', () => {
    it('returns success with valid data for a simple schema', () => {
      const schema = Type.Object({
        name: Type.String({ minLength: 1 }),
        age: Type.Number({ minimum: 0 }),
      });

      const result = validate(schema, { name: 'Alice', age: 30 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: 'Alice', age: 30 });
      }
    });

    it('applies default values when fields are missing', () => {
      const schema = Type.Object({
        page: Type.Number({ default: 1 }),
        pageSize: Type.Number({ default: 20 }),
      });

      const result = validate(schema, {});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.pageSize).toBe(20);
      }
    });

    it('returns success for optional fields that are absent', () => {
      const schema = Type.Object({
        name: Type.String(),
        email: Type.Optional(Type.String()),
      });

      const result = validate(schema, { name: 'Bob' });

      expect(result.success).toBe(true);
    });
  });

  describe('failed validation', () => {
    it('returns field errors for missing required fields', () => {
      const schema = Type.Object({
        name: Type.String(),
        email: Type.String(),
      });

      const result = validate(schema, {});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
        const fieldNames = result.errors.map((e) => e.field);
        expect(fieldNames).toContain('name');
        expect(fieldNames).toContain('email');
      }
    });

    it('returns field errors with correct rule for type mismatch', () => {
      const schema = Type.Object({
        age: Type.Number(),
      });

      const result = validate(schema, { age: 'not-a-number' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.field).toBe('age');
        expect(result.errors[0]!.rule).toBe('type');
        expect(result.errors[0]!.message).toContain('number');
      }
    });

    it('returns field errors for minLength violation', () => {
      const schema = Type.Object({
        name: Type.String({ minLength: 3 }),
      });

      const result = validate(schema, { name: 'AB' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.field).toBe('name');
        expect(result.errors[0]!.rule).toBe('minLength');
        expect(result.errors[0]!.message).toContain('at least 3');
      }
    });

    it('returns field errors for maxLength violation', () => {
      const schema = Type.Object({
        name: Type.String({ maxLength: 5 }),
      });

      const result = validate(schema, { name: 'TooLongName' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.field).toBe('name');
        expect(result.errors[0]!.rule).toBe('maxLength');
        expect(result.errors[0]!.message).toContain('at most 5');
      }
    });

    it('returns field errors for minimum violation', () => {
      const schema = Type.Object({
        page: Type.Number({ minimum: 1 }),
      });

      const result = validate(schema, { page: 0 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.field).toBe('page');
        expect(result.errors[0]!.rule).toBe('minimum');
        expect(result.errors[0]!.message).toContain('at least 1');
      }
    });

    it('returns field errors for maximum violation', () => {
      const schema = Type.Object({
        pageSize: Type.Number({ maximum: 100 }),
      });

      const result = validate(schema, { pageSize: 200 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.field).toBe('pageSize');
        expect(result.errors[0]!.rule).toBe('maximum');
        expect(result.errors[0]!.message).toContain('at most 100');
      }
    });

    it('returns field errors for pattern violation', () => {
      const schema = Type.Object({
        phone: Type.String({ pattern: '^\\+?[\\d\\s\\-()]{7,20}$', description: 'Phone number' }),
      });

      const result = validate(schema, { phone: 'abc' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.field).toBe('phone');
        expect(result.errors[0]!.rule).toBe('pattern');
      }
    });

    it('handles nested object field paths', () => {
      const schema = Type.Object({
        address: Type.Object({
          city: Type.String({ minLength: 1 }),
          zip: Type.String({ pattern: '^\\d{5}$' }),
        }),
      });

      const result = validate(schema, { address: { city: '', zip: 'abc' } });

      expect(result.success).toBe(false);
      if (!result.success) {
        const fields = result.errors.map((e) => e.field);
        expect(fields).toContain('address.city');
        expect(fields).toContain('address.zip');
      }
    });

    it('handles array item field paths', () => {
      const schema = Type.Object({
        items: Type.Array(
          Type.Object({
            name: Type.String({ minLength: 1 }),
          }),
        ),
      });

      const result = validate(schema, { items: [{ name: '' }] });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
        // Should contain path like "items.0.name"
        expect(result.errors[0]!.field).toContain('items');
      }
    });

    it('returns multiple errors for multiple violations', () => {
      const schema = Type.Object({
        name: Type.String({ minLength: 1 }),
        age: Type.Number({ minimum: 0 }),
        email: Type.String(),
      });

      const result = validate(schema, { name: '', age: -1 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('FieldError structure', () => {
    it('each error has field, message, and rule properties', () => {
      const schema = Type.Object({
        name: Type.String({ minLength: 1 }),
      });

      const result = validate(schema, { name: '' });

      expect(result.success).toBe(false);
      if (!result.success) {
        for (const error of result.errors) {
          expect(error).toHaveProperty('field');
          expect(error).toHaveProperty('message');
          expect(error).toHaveProperty('rule');
          expect(typeof error.field).toBe('string');
          expect(typeof error.message).toBe('string');
          expect(typeof error.rule).toBe('string');
        }
      }
    });

    it('messages are human-readable (not raw schema paths)', () => {
      const schema = Type.Object({
        email: Type.String({ minLength: 5 }),
      });

      const result = validate(schema, { email: 'ab' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0]!.message).not.toMatch(/^\//);
        expect(result.errors[0]!.message.length).toBeGreaterThan(5);
      }
    });
  });

  describe('Fastify 5 null-prototype inputs (Wave 8 regression)', () => {
    it('validates request.query / request.params style objects without throwing', () => {
      const schema = Type.Object({
        page: Type.Optional(Type.Integer({ default: 1 })),
        tags: Type.Optional(Type.Array(Type.Object({ id: Type.String() }))),
      });
      const query = Object.create(null) as Record<string, unknown>;
      query.page = 3;
      const nested = Object.create(null) as Record<string, unknown>;
      nested.id = 'a';
      query.tags = [nested];

      const result = validate(schema, query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ page: 3, tags: [{ id: 'a' }] });
        expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
      }
    });

    it('validates objects inheriting from a custom prototype (find-my-way params)', () => {
      const schema = Type.Object({ id: Type.String() });
      const params = Object.create({ inherited: true }) as Record<string, unknown>;
      params.id = 'abc';
      const result = validate(schema, params);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ id: 'abc' });
    });

    it('still applies defaults to an empty null-prototype object', () => {
      const schema = Type.Object({ pageSize: Type.Optional(Type.Integer({ default: 20 })) });
      const result = validate(schema, Object.create(null));
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.pageSize).toBe(20);
    });
  });
});

describe('validateQuery — query-string coercion (Wave 8)', () => {
  const Query = Type.Object({
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
    includeClosed: Type.Optional(Type.Boolean()),
    search: Type.Optional(Type.String()),
  });

  it('coerces numeric and boolean strings from a query string', () => {
    const result = validateQuery(Query, { pageSize: '100', includeClosed: 'true', search: 'x' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ pageSize: 100, includeClosed: true, search: 'x' });
    }
  });

  it('still rejects out-of-range and non-numeric values after coercion', () => {
    expect(validateQuery(Query, { pageSize: '500' }).success).toBe(false);
    expect(validateQuery(Query, { pageSize: 'lots' }).success).toBe(false);
  });

  it('plain validate does not coerce JSON body strings into numbers', () => {
    expect(validate(Query, { pageSize: '100' }).success).toBe(false);
  });
});
