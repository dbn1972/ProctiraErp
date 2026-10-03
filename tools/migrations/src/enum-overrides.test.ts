import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyEnumOverrides, loadEnumOverrides, parseEnumOverrides } from './enum-overrides.js';
import { TABLE_MAPPINGS } from './table-mappings.js';
import { buildTransformExpression } from './transform-schema.js';

// PRC-H105: owner code tables extend map_enum mappings; unmapped codes still fail the step.
describe('OpenEMIS enum overrides (PRC-H105)', () => {
  it('merges an override into the target map_enum column', () => {
    const merged = applyEnumOverrides(TABLE_MAPPINGS, { 'students.gender': { '3': 'other' } });
    const gender = merged
      .find((m) => m.targetTable === 'students')!
      .columns.find((c) => c.target === 'gender')!;
    expect(buildTransformExpression(gender.source, gender.transform)).toContain(
      `= '3' THEN 'other'`,
    );
    // Built-ins are untouched by reference.
    const original = TABLE_MAPPINGS.find((m) => m.targetTable === 'students')!.columns.find(
      (c) => c.target === 'gender',
    )!;
    expect(JSON.stringify(original.transform)).not.toContain('other');
  });

  it('rejects quotes/SQL in codes or values and unknown target columns', () => {
    expect(() => parseEnumOverrides({ 'students.gender': { "3'": 'other' } })).toThrow();
    expect(() => parseEnumOverrides({ 'students.gender': { '3': "x'; DROP" } })).toThrow();
    expect(() => parseEnumOverrides({ 'Students.gender': { '3': 'other' } })).toThrow();
    expect(() => applyEnumOverrides(TABLE_MAPPINGS, { 'students.nope': { '1': 'a' } })).toThrow(
      /no map_enum column/,
    );
  });

  it('loads overrides from OPENEMIS_ENUM_OVERRIDES and is empty when unset', () => {
    expect(loadEnumOverrides({})).toEqual({});
    const dir = mkdtempSync(join(tmpdir(), 'h105-'));
    try {
      const file = join(dir, 'o.json');
      writeFileSync(file, JSON.stringify({ 'enrollments.status': { '5': 'PROMOTED' } }));
      expect(loadEnumOverrides({ OPENEMIS_ENUM_OVERRIDES: file })).toEqual({
        'enrollments.status': { '5': 'PROMOTED' },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
