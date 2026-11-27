import { describe, expect, it } from 'vitest';

import {
  fillTemplate,
  isIdProperty,
  isPlaceholder,
  placeholder,
  sampleSchema,
  type JsonSchema,
} from './schema-sample.js';

describe('schema-sample', () => {
  it('flags id-named and uuid-typed string properties', () => {
    expect(isIdProperty('studentId', { type: 'string' })).toBe(true);
    expect(isIdProperty('id', { type: 'string' })).toBe(true);
    expect(isIdProperty('invoice_id', { type: 'string' })).toBe(true);
    expect(isIdProperty('ownerId', { type: 'string', format: 'uuid' })).toBe(true);
    expect(isIdProperty('ref', { type: 'string', format: 'uuid' })).toBe(true);
    expect(isIdProperty('name', { type: 'string' })).toBe(false);
    expect(isIdProperty('amount', { type: 'integer' })).toBe(false);
  });

  it('samples required fields and marks id slots as placeholders', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['studentId', 'amountCents', 'note'],
      properties: {
        studentId: { type: 'string', format: 'uuid' },
        amountCents: { type: 'integer', minimum: 0 },
        note: { type: 'string', minLength: 2, maxLength: 10 },
        optionalOmitted: { type: 'string' },
        subjectId: { type: 'string', format: 'uuid' }, // id prop kept even if optional
      },
    };
    const { value, idFields } = sampleSchema(schema);
    const body = value as Record<string, unknown>;
    expect(isPlaceholder(body['studentId'])).toBe(true);
    expect(isPlaceholder(body['subjectId'])).toBe(true);
    expect(typeof body['amountCents']).toBe('number');
    expect(body['note']).toBeTypeOf('string');
    expect(body).not.toHaveProperty('optionalOmitted');
    expect(idFields.map((f) => f.name).sort()).toEqual(['studentId', 'subjectId']);
  });

  it('handles id arrays and nested objects', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['studentIds', 'detail'],
      properties: {
        studentIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
        detail: {
          type: 'object',
          required: ['sectionId'],
          properties: { sectionId: { type: 'string', format: 'uuid' } },
        },
      },
    };
    const { value, idFields } = sampleSchema(schema);
    const body = value as { studentIds: unknown[]; detail: Record<string, unknown> };
    expect(Array.isArray(body.studentIds)).toBe(true);
    expect(isPlaceholder(body.studentIds[0])).toBe(true);
    expect(isPlaceholder(body.detail['sectionId'])).toBe(true);
    const paths = idFields.map((f) => f.path).sort();
    expect(paths).toEqual(['detail.sectionId', 'studentIds']);
    expect(idFields.find((f) => f.name === 'studentIds')?.array).toBe(true);
  });

  it('fills a template: attacked path gets the override, other slots the resolver', () => {
    const template = {
      studentId: placeholder('studentId'),
      subjectId: placeholder('subjectId'),
      ids: [placeholder('ids')],
      comment: 'x',
    };
    const filled = fillTemplate(template, (name) => `own-${name}`, {
      studentId: 'ATTACKED',
    }) as Record<string, unknown>;
    expect(filled['studentId']).toBe('ATTACKED');
    expect(filled['subjectId']).toBe('own-subjectId');
    expect(filled['ids']).toEqual(['own-ids']);
    expect(filled['comment']).toBe('x');
  });

  it('picks the first non-null branch of a union', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['status'],
      properties: {
        status: {
          anyOf: [
            { const: 'OPEN', type: 'string' },
            { const: 'CLOSED', type: 'string' },
          ],
        },
      },
    };
    const body = sampleSchema(schema).value as Record<string, unknown>;
    expect(body['status']).toBe('OPEN');
  });
});
