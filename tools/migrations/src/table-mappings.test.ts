/**
 * Unit tests for table mappings and schema transformation logic.
 */

import { describe, it, expect } from 'vitest';
import {
  TABLE_MAPPINGS,
  getMappingsForSource,
  getMappingForTarget,
  getAllSourceTables,
  getAllTargetTables,
} from './table-mappings.js';
import { buildTransformExpression, buildTransformSQL } from './transform-schema.js';

describe('table-mappings', () => {
  it('should have mappings for all core legacy tables', () => {
    const sourceTables = getAllSourceTables();
    expect(sourceTables).toContain('institutions');
    expect(sourceTables).toContain('security_users');
    expect(sourceTables).toContain('areas');
    expect(sourceTables).toContain('academic_periods');
    expect(sourceTables).toContain('education_grades');
    expect(sourceTables).toContain('institution_classes');
    expect(sourceTables).toContain('institution_students');
  });

  it('should map security_users to both students and staff', () => {
    const mappings = getMappingsForSource('security_users');
    expect(mappings.length).toBe(2);

    const targets = mappings.map((m) => m.targetTable);
    expect(targets).toContain('students');
    expect(targets).toContain('staff');
  });

  it('should have source filters for security_users split', () => {
    const mappings = getMappingsForSource('security_users');
    const studentMapping = mappings.find((m) => m.targetTable === 'students');
    const staffMapping = mappings.find((m) => m.targetTable === 'staff');

    expect(studentMapping?.sourceFilter).toBe('is_student = 1');
    expect(staffMapping?.sourceFilter).toBe('is_staff = 1');
  });

  it('should map institution_students to enrollments', () => {
    const mapping = getMappingForTarget('enrollments');
    expect(mapping).toBeDefined();
    expect(mapping!.sourceTable).toBe('institution_students');
  });

  it('should map areas to geographic_areas', () => {
    const mapping = getMappingForTarget('geographic_areas');
    expect(mapping).toBeDefined();
    expect(mapping!.sourceTable).toBe('areas');
  });

  it('should require UUID generation for all mapped tables', () => {
    for (const mapping of TABLE_MAPPINGS) {
      expect(mapping.requiresUuidGeneration).toBe(true);
    }
  });

  it('should have valid foreign key references', () => {
    const allTargets = getAllTargetTables();
    for (const mapping of TABLE_MAPPINGS) {
      for (const fk of mapping.foreignKeys) {
        expect(allTargets).toContain(fk.targetReferencesTable);
      }
    }
  });

  it('should have enrollment mapping with all required FK relationships', () => {
    const mapping = getMappingForTarget('enrollments');
    expect(mapping).toBeDefined();

    const fkColumns = mapping!.foreignKeys.map((fk) => fk.column);
    expect(fkColumns).toContain('student_id');
    expect(fkColumns).toContain('institution_id');
    expect(fkColumns).toContain('grade_id');
    expect(fkColumns).toContain('academic_period_id');
  });

  it('should have no duplicate target tables (except from split sources)', () => {
    const targets = TABLE_MAPPINGS.map((m) => m.targetTable);
    const uniqueTargets = [...new Set(targets)];
    // All targets should be unique (security_users splits into different targets)
    expect(targets.length).toBe(uniqueTargets.length);
  });
});

describe('buildTransformExpression', () => {
  it('should return plain column reference for no transform', () => {
    const result = buildTransformExpression('name', undefined);
    expect(result).toBe('s."name"');
  });

  it('should handle rename transform', () => {
    const result = buildTransformExpression('old_col', { type: 'rename' });
    expect(result).toBe('s."old_col"');
  });

  it('should handle cast transform', () => {
    const result = buildTransformExpression('level_id', { type: 'cast', targetType: 'smallint' });
    expect(result).toBe('CAST(s."level_id" AS smallint)');
  });

  it('should handle map_enum transform', () => {
    const result = buildTransformExpression('status_id', {
      type: 'map_enum',
      mapping: { '1': 'active', '2': 'inactive' },
    });
    expect(result).toContain('CASE');
    expect(result).toContain("WHEN CAST(s.\"status_id\" AS text) = '1' THEN 'active'");
    expect(result).toContain("WHEN CAST(s.\"status_id\" AS text) = '2' THEN 'inactive'");
  });

  it('should handle coalesce transform', () => {
    const result = buildTransformExpression('optional_col', { type: 'coalesce', fallback: 'default' });
    expect(result).toBe("COALESCE(s.\"optional_col\", 'default')");
  });

  it('should handle json_wrap transform', () => {
    const result = buildTransformExpression('data', { type: 'json_wrap' });
    expect(result).toBe("COALESCE(s.\"data\"::jsonb, '{}'::jsonb)");
  });
});

describe('buildTransformSQL', () => {
  it('should generate valid INSERT...SELECT SQL', () => {
    const mapping = getMappingForTarget('geographic_areas')!;
    const sql = buildTransformSQL(mapping, 'migration_staging', 'public');

    expect(sql).toContain('INSERT INTO "public"."geographic_areas"');
    expect(sql).toContain('FROM "migration_staging"."areas" s');
    expect(sql).toContain('"name"');
    expect(sql).toContain('"code"');
    expect(sql).toContain('ON CONFLICT DO NOTHING');
  });

  it('should include WHERE clause for filtered mappings', () => {
    const mapping = getMappingsForSource('security_users').find((m) => m.targetTable === 'students')!;
    const sql = buildTransformSQL(mapping, 'migration_staging', 'public');

    expect(sql).toContain('WHERE is_student = 1');
  });

  it('should not include WHERE clause for unfiltered mappings', () => {
    const mapping = getMappingForTarget('institutions')!;
    const sql = buildTransformSQL(mapping, 'migration_staging', 'public');

    expect(sql).not.toContain('WHERE');
  });
});
