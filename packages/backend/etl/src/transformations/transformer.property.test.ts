/**
 * Property-Based Test: ETL Field Mapping Transformation (Property 27)
 *
 * **Validates: Requirements 14.5**
 *
 * Tests that the ETL transformation engine correctly applies field mapping
 * transformation rules:
 * 1. type_cast transformations correctly convert values to the target type
 *    (string, number, integer, boolean, date)
 * 2. lookup transformations correctly replace values using the lookup table,
 *    falling back to defaultValue
 * 3. concatenate transformations correctly join multiple source fields with
 *    the separator
 * 4. format transformations correctly apply template strings with {field}
 *    placeholders
 * 5. Rows with transformation errors still produce output (with raw values)
 *    and report errors
 *
 * Uses fast-check to generate arbitrary field mappings and data rows.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { transformRows } from './transformer.js';
import type { FieldMapping } from '../schemas.js';

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a non-empty alphanumeric field name (valid identifier).
 */
function arbFieldName(): fc.Arbitrary<string> {
  return fc.stringMatching(/^[a-z][a-zA-Z0-9_]{0,19}$/);
}

/**
 * Generates a numeric string value that can be parsed as a number.
 */
function arbNumericString(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.integer({ min: -999999, max: 999999 }).map(String),
    fc
      .float({ min: -999999, max: 999999, noNaN: true, noDefaultInfinity: true })
      .map((n) => n.toFixed(2)),
  );
}

/**
 * Generates a boolean-like string value.
 */
function arbBooleanString(): fc.Arbitrary<string> {
  return fc.oneof(fc.constantFrom('true', 'false', '1', '0', 'yes', 'no', 'y', 'n'));
}

/**
 * Generates a valid ISO date string.
 */
function arbDateString(): fc.Arbitrary<string> {
  return fc
    .record({
      year: fc.integer({ min: 1970, max: 2099 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
    })
    .map(({ year, month, day }) => {
      const m = String(month).padStart(2, '0');
      const d = String(day).padStart(2, '0');
      return `${year}-${m}-${d}`;
    });
}

/**
 * Generates a simple string value (non-empty, printable).
 */
function arbSimpleString(): fc.Arbitrary<string> {
  return fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Property 27: ETL Field Mapping Transformation', () => {
  describe('type_cast transformations', () => {
    it('type_cast to string always produces a string', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer().map((v) => ({ val: v })),
            fc.float({ noNaN: true, noDefaultInfinity: true }).map((v) => ({ val: v })),
            fc.boolean().map((v) => ({ val: v })),
            fc.string({ minLength: 1, maxLength: 20 }).map((v) => ({ val: v })),
          ),
          ({ val }) => {
            const rows = [{ source: val }];
            const mappings: FieldMapping[] = [
              {
                sourceField: 'source',
                destinationField: 'dest',
                transformation: 'type_cast',
                transformConfig: { targetType: 'string' },
              },
            ];

            const result = transformRows(rows, mappings);

            expect(result.rows[0]!.dest).toBe(String(val));
            expect(typeof result.rows[0]!.dest).toBe('string');
            expect(result.errorCount).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('type_cast to number correctly converts valid numeric strings', () => {
      fc.assert(
        fc.property(arbNumericString(), (numStr) => {
          const rows = [{ value: numStr }];
          const mappings: FieldMapping[] = [
            {
              sourceField: 'value',
              destinationField: 'result',
              transformation: 'type_cast',
              transformConfig: { targetType: 'number' },
            },
          ];

          const result = transformRows(rows, mappings);

          expect(result.rows[0]!.result).toBe(Number(numStr));
          expect(typeof result.rows[0]!.result).toBe('number');
          expect(result.errorCount).toBe(0);
        }),
        { numRuns: 100 },
      );
    });

    it('type_cast to integer truncates decimal portion', () => {
      fc.assert(
        fc.property(
          fc.float({ min: -999999, max: 999999, noNaN: true, noDefaultInfinity: true }),
          (num) => {
            const rows = [{ value: String(num) }];
            const mappings: FieldMapping[] = [
              {
                sourceField: 'value',
                destinationField: 'result',
                transformation: 'type_cast',
                transformConfig: { targetType: 'integer' },
              },
            ];

            const result = transformRows(rows, mappings);

            expect(result.rows[0]!.result).toBe(parseInt(String(num), 10));
            expect(Number.isInteger(result.rows[0]!.result)).toBe(true);
            expect(result.errorCount).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('type_cast to boolean correctly interprets truthy/falsy strings', () => {
      fc.assert(
        fc.property(arbBooleanString(), (boolStr) => {
          const rows = [{ flag: boolStr }];
          const mappings: FieldMapping[] = [
            {
              sourceField: 'flag',
              destinationField: 'result',
              transformation: 'type_cast',
              transformConfig: { targetType: 'boolean' },
            },
          ];

          const result = transformRows(rows, mappings);

          const truthyValues = ['true', '1', 'yes', 'y'];
          const expected = truthyValues.includes(boolStr.toLowerCase());

          expect(result.rows[0]!.result).toBe(expected);
          expect(typeof result.rows[0]!.result).toBe('boolean');
          expect(result.errorCount).toBe(0);
        }),
        { numRuns: 100 },
      );
    });

    it('type_cast to date produces valid ISO date string', () => {
      fc.assert(
        fc.property(arbDateString(), (dateStr) => {
          const rows = [{ created: dateStr }];
          const mappings: FieldMapping[] = [
            {
              sourceField: 'created',
              destinationField: 'result',
              transformation: 'type_cast',
              transformConfig: { targetType: 'date' },
            },
          ];

          const result = transformRows(rows, mappings);

          const resultValue = result.rows[0]!.result as string;
          // Should be a valid ISO string
          expect(resultValue).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
          // Parsing back should give a valid date
          const parsed = new Date(resultValue);
          expect(isNaN(parsed.getTime())).toBe(false);
          expect(result.errorCount).toBe(0);
        }),
        { numRuns: 100 },
      );
    });

    it('type_cast with null/undefined values returns null without error', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('string', 'number', 'integer', 'boolean', 'date'),
          (targetType) => {
            const rows = [{ value: null }];
            const mappings: FieldMapping[] = [
              {
                sourceField: 'value',
                destinationField: 'result',
                transformation: 'type_cast',
                transformConfig: { targetType },
              },
            ];

            const result = transformRows(rows, mappings);

            expect(result.rows[0]!.result).toBe(null);
            expect(result.errorCount).toBe(0);
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  describe('lookup transformations', () => {
    it('lookup replaces values found in the lookup table', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(arbSimpleString(), { minLength: 1, maxLength: 10 }).chain((keys) => {
            return fc.tuple(...keys.map(() => arbSimpleString())).map((values) => {
              const table: Record<string, string> = {};
              keys.forEach((k, i) => {
                table[k] = values[i]!;
              });
              return { table, keys };
            });
          }),
          ({ table, keys }) => {
            // Pick a random key that exists in the table
            const key = keys[0]!;
            const rows = [{ code: key }];
            const mappings: FieldMapping[] = [
              {
                sourceField: 'code',
                destinationField: 'label',
                transformation: 'lookup',
                transformConfig: {
                  lookupTable: table,
                  defaultValue: 'FALLBACK',
                },
              },
            ];

            const result = transformRows(rows, mappings);

            expect(result.rows[0]!.label).toBe(table[key]);
            expect(result.errorCount).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('lookup falls back to defaultValue when key is not in table', () => {
      fc.assert(
        fc.property(
          fc.record({
            lookupTable: fc.dictionary(fc.stringMatching(/^[A-Z]{1,3}$/), arbSimpleString(), {
              minKeys: 1,
              maxKeys: 5,
            }),
            defaultValue: arbSimpleString(),
            missingKey: fc.stringMatching(/^[a-z]{4,8}$/),
          }),
          ({ lookupTable, defaultValue, missingKey }) => {
            // Ensure missingKey is not in the lookup table
            if (missingKey in lookupTable) return;

            const rows = [{ status: missingKey }];
            const mappings: FieldMapping[] = [
              {
                sourceField: 'status',
                destinationField: 'statusLabel',
                transformation: 'lookup',
                transformConfig: { lookupTable, defaultValue },
              },
            ];

            const result = transformRows(rows, mappings);

            expect(result.rows[0]!.statusLabel).toBe(defaultValue);
            expect(result.errorCount).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('lookup returns original value when key not found and no defaultValue', () => {
      fc.assert(
        fc.property(
          fc.record({
            lookupTable: fc.dictionary(fc.stringMatching(/^[A-Z]{1,3}$/), arbSimpleString(), {
              minKeys: 1,
              maxKeys: 5,
            }),
            missingKey: fc.stringMatching(/^[a-z]{4,8}$/),
          }),
          ({ lookupTable, missingKey }) => {
            if (missingKey in lookupTable) return;

            const rows = [{ code: missingKey }];
            const mappings: FieldMapping[] = [
              {
                sourceField: 'code',
                destinationField: 'label',
                transformation: 'lookup',
                transformConfig: { lookupTable },
              },
            ];

            const result = transformRows(rows, mappings);

            expect(result.rows[0]!.label).toBe(missingKey);
            expect(result.errorCount).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('concatenate transformations', () => {
    it('concatenate joins multiple fields with the separator', () => {
      fc.assert(
        fc.property(
          fc.record({
            values: fc.array(arbSimpleString(), { minLength: 2, maxLength: 5 }),
            separator: fc.constantFrom(' ', ', ', '-', '_', '|', ''),
          }),
          ({ values, separator }) => {
            // Build a row with field0, field1, field2, ...
            const row: Record<string, unknown> = {};
            const fields: string[] = [];
            values.forEach((val, i) => {
              const fieldName = `field${i}`;
              row[fieldName] = val;
              fields.push(fieldName);
            });

            const rows = [row];
            const mappings: FieldMapping[] = [
              {
                sourceField: fields[0]!,
                destinationField: 'combined',
                transformation: 'concatenate',
                transformConfig: { fields, separator },
              },
            ];

            const result = transformRows(rows, mappings);

            const expected = values.join(separator);
            expect(result.rows[0]!.combined).toBe(expected);
            expect(result.errorCount).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('concatenate treats null/undefined fields as empty strings', () => {
      fc.assert(
        fc.property(
          fc.record({
            presentValue: arbSimpleString(),
            separator: fc.constantFrom(' ', '-', ''),
          }),
          ({ presentValue, separator }) => {
            const row: Record<string, unknown> = {
              first: presentValue,
              second: null,
              third: undefined,
            };

            const rows = [row];
            const mappings: FieldMapping[] = [
              {
                sourceField: 'first',
                destinationField: 'combined',
                transformation: 'concatenate',
                transformConfig: {
                  fields: ['first', 'second', 'third'],
                  separator,
                },
              },
            ];

            const result = transformRows(rows, mappings);

            const expected = [presentValue, '', ''].join(separator);
            expect(result.rows[0]!.combined).toBe(expected);
            expect(result.errorCount).toBe(0);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe('format transformations', () => {
    it('format replaces {field} placeholders with source row values', () => {
      fc.assert(
        fc.property(
          fc.record({
            city: arbSimpleString(),
            country: arbSimpleString(),
            zip: fc.stringMatching(/^\d{5}$/),
          }),
          ({ city, country, zip }) => {
            const row = { city, country, zip };
            const rows = [row];
            const mappings: FieldMapping[] = [
              {
                sourceField: 'city',
                destinationField: 'address',
                transformation: 'format',
                transformConfig: { template: '{city}, {country} {zip}' },
              },
            ];

            const result = transformRows(rows, mappings);

            expect(result.rows[0]!.address).toBe(`${city}, ${country} ${zip}`);
            expect(result.errorCount).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('format replaces missing fields with empty strings', () => {
      fc.assert(
        fc.property(arbSimpleString(), (name) => {
          const row = { name };
          const rows = [row];
          const mappings: FieldMapping[] = [
            {
              sourceField: 'name',
              destinationField: 'greeting',
              transformation: 'format',
              transformConfig: { template: 'Hello {name}, from {city}!' },
            },
          ];

          const result = transformRows(rows, mappings);

          expect(result.rows[0]!.greeting).toBe(`Hello ${name}, from !`);
          expect(result.errorCount).toBe(0);
        }),
        { numRuns: 50 },
      );
    });

    it('format with arbitrary field count produces correct substitution', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 5 }).chain((fieldCount) => {
            const fieldNames = Array.from({ length: fieldCount }, (_, i) => `f${i}`);
            return fc.tuple(...fieldNames.map(() => arbSimpleString())).map((values) => {
              const row: Record<string, unknown> = {};
              fieldNames.forEach((name, i) => {
                row[name] = values[i];
              });
              const template = fieldNames.map((n) => `{${n}}`).join(' - ');
              const expected = values.join(' - ');
              return { row, template, expected };
            });
          }),
          ({ row, template, expected }) => {
            const rows = [row];
            const mappings: FieldMapping[] = [
              {
                sourceField: Object.keys(row)[0]!,
                destinationField: 'output',
                transformation: 'format',
                transformConfig: { template },
              },
            ];

            const result = transformRows(rows, mappings);

            expect(result.rows[0]!.output).toBe(expected);
            expect(result.errorCount).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('error handling - rows with transformation errors', () => {
    it('rows with errors still produce output with raw values and report errors', () => {
      fc.assert(
        fc.property(
          fc.record({
            validField: arbSimpleString(),
            invalidNumeric: fc.stringMatching(/^[a-z]{3,10}$/).filter((s) => isNaN(Number(s))),
          }),
          ({ validField, invalidNumeric }) => {
            const rows = [{ name: validField, price: invalidNumeric }];
            const mappings: FieldMapping[] = [
              { sourceField: 'name', destinationField: 'name' },
              {
                sourceField: 'price',
                destinationField: 'price',
                transformation: 'type_cast',
                transformConfig: { targetType: 'number' },
              },
            ];

            const result = transformRows(rows, mappings);

            // Row is still present in output
            expect(result.rows.length).toBe(1);
            // Valid field is mapped correctly
            expect(result.rows[0]!.name).toBe(validField);
            // Failed field falls back to raw value
            expect(result.rows[0]!.price).toBe(invalidNumeric);
            // Error is reported
            expect(result.errorCount).toBe(1);
            expect(result.errors.length).toBe(1);
            expect(result.errors[0]!.row).toBe(0);
            expect(result.errors[0]!.field).toBe('price');
            expect(result.errors[0]!.message).toContain('Cannot cast');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('multiple rows with mixed success/failure all produce output', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              // Valid numeric string
              arbNumericString().map((v) => ({ value: v, shouldSucceed: true })),
              // Invalid non-numeric string
              fc
                .stringMatching(/^[a-z]{3,8}$/)
                .filter((s) => isNaN(Number(s)))
                .map((v) => ({ value: v, shouldSucceed: false })),
            ),
            { minLength: 2, maxLength: 10 },
          ),
          (inputs) => {
            const rows = inputs.map((input) => ({ amount: input.value }));
            const mappings: FieldMapping[] = [
              {
                sourceField: 'amount',
                destinationField: 'amount',
                transformation: 'type_cast',
                transformConfig: { targetType: 'number' },
              },
            ];

            const result = transformRows(rows, mappings);

            // All rows produce output regardless of errors
            expect(result.rows.length).toBe(inputs.length);

            // Count expected errors
            const expectedErrors = inputs.filter((i) => !i.shouldSucceed).length;
            expect(result.errorCount).toBe(expectedErrors);

            // Successful rows are transformed
            const expectedTransformed = inputs.filter((i) => i.shouldSucceed).length;
            expect(result.transformedCount).toBe(expectedTransformed);

            // Each error row retains its raw value
            inputs.forEach((input, idx) => {
              if (input.shouldSucceed) {
                expect(result.rows[idx]!.amount).toBe(Number(input.value));
              } else {
                expect(result.rows[idx]!.amount).toBe(input.value);
              }
            });
          },
        ),
        { numRuns: 50 },
      );
    });

    it('transformedCount equals total rows minus rows with errors', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              arbNumericString().map((v) => ({ value: v })),
              fc
                .stringMatching(/^[a-z]{3,8}$/)
                .filter((s) => isNaN(Number(s)))
                .map((v) => ({ value: v })),
            ),
            { minLength: 1, maxLength: 15 },
          ),
          (inputs) => {
            const rows = inputs.map((input) => ({ num: input.value }));
            const mappings: FieldMapping[] = [
              {
                sourceField: 'num',
                destinationField: 'num',
                transformation: 'type_cast',
                transformConfig: { targetType: 'number' },
              },
            ];

            const result = transformRows(rows, mappings);

            // Count rows that have at least one error
            const errorRowIndices = new Set(result.errors.map((e) => e.row));
            const rowsWithErrors = errorRowIndices.size;

            expect(result.transformedCount).toBe(inputs.length - rowsWithErrors);
            expect(result.rows.length).toBe(inputs.length);
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
