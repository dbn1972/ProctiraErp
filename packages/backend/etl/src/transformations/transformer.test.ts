/**
 * Transformer Unit Tests
 */
import { describe, it, expect } from 'vitest';
import { transformRows } from './transformer.js';
import type { FieldMapping } from '../schemas.js';

describe('transformRows', () => {
  it('should map fields without transformation', () => {
    const rows = [
      { first_name: 'John', last_name: 'Doe', age: '30' },
      { first_name: 'Jane', last_name: 'Smith', age: '25' },
    ];
    const mappings: FieldMapping[] = [
      { sourceField: 'first_name', destinationField: 'firstName' },
      { sourceField: 'last_name', destinationField: 'lastName' },
      { sourceField: 'age', destinationField: 'age' },
    ];

    const result = transformRows(rows, mappings);

    expect(result.transformedCount).toBe(2);
    expect(result.errorCount).toBe(0);
    expect(result.rows).toEqual([
      { firstName: 'John', lastName: 'Doe', age: '30' },
      { firstName: 'Jane', lastName: 'Smith', age: '25' },
    ]);
  });

  it('should apply type_cast transformation to number', () => {
    const rows = [{ price: '19.99' }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'price',
        destinationField: 'price',
        transformation: 'type_cast',
        transformConfig: { targetType: 'number' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.price).toBe(19.99);
    expect(result.transformedCount).toBe(1);
  });

  it('should apply type_cast transformation to integer', () => {
    const rows = [{ count: '42.7' }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'count',
        destinationField: 'count',
        transformation: 'type_cast',
        transformConfig: { targetType: 'integer' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.count).toBe(42);
  });

  it('should apply type_cast transformation to boolean', () => {
    const rows = [{ active: 'true' }, { active: '0' }, { active: 'yes' }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'active',
        destinationField: 'isActive',
        transformation: 'type_cast',
        transformConfig: { targetType: 'boolean' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.isActive).toBe(true);
    expect(result.rows[1]!.isActive).toBe(false);
    expect(result.rows[2]!.isActive).toBe(true);
  });

  it('should apply type_cast transformation to string', () => {
    const rows = [{ id: 123 }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'id',
        destinationField: 'id',
        transformation: 'type_cast',
        transformConfig: { targetType: 'string' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.id).toBe('123');
  });

  it('should apply type_cast transformation to date', () => {
    const rows = [{ created: '2024-01-15' }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'created',
        destinationField: 'createdAt',
        transformation: 'type_cast',
        transformConfig: { targetType: 'date' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.createdAt).toBe('2024-01-15T00:00:00.000Z');
  });

  it('should report error for invalid type_cast', () => {
    const rows = [{ price: 'not-a-number' }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'price',
        destinationField: 'price',
        transformation: 'type_cast',
        transformConfig: { targetType: 'number' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.errorCount).toBe(1);
    expect(result.errors[0]!.field).toBe('price');
    expect(result.errors[0]!.message).toContain('Cannot cast');
  });

  it('should apply lookup transformation', () => {
    const rows = [{ status: 'A' }, { status: 'I' }, { status: 'X' }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'status',
        destinationField: 'statusLabel',
        transformation: 'lookup',
        transformConfig: {
          lookupTable: { A: 'Active', I: 'Inactive' },
          defaultValue: 'Unknown',
        },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.statusLabel).toBe('Active');
    expect(result.rows[1]!.statusLabel).toBe('Inactive');
    expect(result.rows[2]!.statusLabel).toBe('Unknown');
  });

  it('should apply concatenate transformation', () => {
    const rows = [{ first_name: 'John', last_name: 'Doe' }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'first_name',
        destinationField: 'fullName',
        transformation: 'concatenate',
        transformConfig: { fields: ['first_name', 'last_name'], separator: ' ' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.fullName).toBe('John Doe');
  });

  it('should apply format transformation', () => {
    const rows = [{ city: 'New York', country: 'USA', zip: '10001' }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'city',
        destinationField: 'address',
        transformation: 'format',
        transformConfig: { template: '{city}, {country} {zip}' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.address).toBe('New York, USA 10001');
  });

  it('should apply custom uppercase transformation', () => {
    const rows = [{ name: 'hello world' }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'name',
        destinationField: 'name',
        transformation: 'custom',
        transformConfig: { expression: 'uppercase' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.name).toBe('HELLO WORLD');
  });

  it('should apply custom lowercase transformation', () => {
    const rows = [{ name: 'HELLO' }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'name',
        destinationField: 'name',
        transformation: 'custom',
        transformConfig: { expression: 'lowercase' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.name).toBe('hello');
  });

  it('should apply custom trim transformation', () => {
    const rows = [{ name: '  hello  ' }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'name',
        destinationField: 'name',
        transformation: 'custom',
        transformConfig: { expression: 'trim' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.name).toBe('hello');
  });

  it('should apply custom prefix transformation', () => {
    const rows = [{ code: '001' }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'code',
        destinationField: 'code',
        transformation: 'custom',
        transformConfig: { expression: 'prefix:SCH-' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.code).toBe('SCH-001');
  });

  it('should apply custom default transformation for empty values', () => {
    const rows = [{ name: '' }, { name: 'John' }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'name',
        destinationField: 'name',
        transformation: 'custom',
        transformConfig: { expression: 'default:N/A' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.name).toBe('N/A');
    expect(result.rows[1]!.name).toBe('John');
  });

  it('should handle null values in type_cast gracefully', () => {
    const rows = [{ value: null }];
    const mappings: FieldMapping[] = [
      {
        sourceField: 'value',
        destinationField: 'value',
        transformation: 'type_cast',
        transformConfig: { targetType: 'number' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.value).toBe(null);
    expect(result.errorCount).toBe(0);
  });

  it('should handle missing source fields', () => {
    const rows = [{ name: 'John' }];
    const mappings: FieldMapping[] = [{ sourceField: 'email', destinationField: 'email' }];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]!.email).toBe(null);
  });

  it('should process multiple mappings per row', () => {
    const rows = [{ first: 'John', last: 'Doe', age: '30' }];
    const mappings: FieldMapping[] = [
      { sourceField: 'first', destinationField: 'firstName' },
      { sourceField: 'last', destinationField: 'lastName' },
      {
        sourceField: 'age',
        destinationField: 'age',
        transformation: 'type_cast',
        transformConfig: { targetType: 'integer' },
      },
    ];

    const result = transformRows(rows, mappings);

    expect(result.rows[0]).toEqual({ firstName: 'John', lastName: 'Doe', age: 30 });
  });
});
