/**
 * Unit tests for schema constraint validation.
 * Tests constraint definitions, validation logic, and report serialization.
 */

import { describe, it, expect } from 'vitest';
import {
  SCHEMA_CONSTRAINTS,
  serializeConstraintReport,
  ConstraintValidationReport,
  ConstraintViolation,
} from './constraint-validator.js';

describe('constraint-validator', () => {
  describe('SCHEMA_CONSTRAINTS', () => {
    it('should define constraints for all core tables', () => {
      const tables = [...new Set(SCHEMA_CONSTRAINTS.map((c) => c.table))];
      expect(tables).toContain('institutions');
      expect(tables).toContain('students');
      expect(tables).toContain('staff');
      expect(tables).toContain('enrollments');
      expect(tables).toContain('geographic_areas');
      expect(tables).toContain('academic_periods');
      expect(tables).toContain('classes');
    });

    it('should have NOT NULL constraints for required fields', () => {
      const notNullConstraints = SCHEMA_CONSTRAINTS.filter((c) => c.type === 'not_null');
      expect(notNullConstraints.length).toBeGreaterThan(0);

      // Institutions must have name, code, area_id
      const institutionNotNull = notNullConstraints.filter((c) => c.table === 'institutions');
      const institutionCols = institutionNotNull.map((c) => c.column);
      expect(institutionCols).toContain('name');
      expect(institutionCols).toContain('code');
      expect(institutionCols).toContain('area_id');

      // Students must have first_name, last_name, date_of_birth
      const studentNotNull = notNullConstraints.filter((c) => c.table === 'students');
      const studentCols = studentNotNull.map((c) => c.column);
      expect(studentCols).toContain('first_name');
      expect(studentCols).toContain('last_name');
      expect(studentCols).toContain('date_of_birth');
    });

    it('should have UNIQUE constraints for identity columns', () => {
      const uniqueConstraints = SCHEMA_CONSTRAINTS.filter((c) => c.type === 'unique');
      expect(uniqueConstraints.length).toBeGreaterThan(0);

      const uniqueColumns = uniqueConstraints.map((c) => `${c.table}.${c.column}`);
      expect(uniqueColumns).toContain('institutions.code');
      expect(uniqueColumns).toContain('staff.identity_number');
    });

    it('should have ENUM constraints with valid allowed values', () => {
      const enumConstraints = SCHEMA_CONSTRAINTS.filter((c) => c.type === 'enum_value');
      expect(enumConstraints.length).toBeGreaterThan(0);

      for (const constraint of enumConstraints) {
        expect(constraint.allowedValues).toBeDefined();
        expect(constraint.allowedValues!.length).toBeGreaterThan(0);
      }

      // Institution status should allow active/inactive
      const institutionStatus = enumConstraints.find(
        (c) => c.table === 'institutions' && c.column === 'status',
      );
      expect(institutionStatus).toBeDefined();
      expect(institutionStatus!.allowedValues).toContain('active');
      expect(institutionStatus!.allowedValues).toContain('inactive');

      // Enrollment status should allow all lifecycle states
      const enrollmentStatus = enumConstraints.find(
        (c) => c.table === 'enrollments' && c.column === 'status',
      );
      expect(enrollmentStatus).toBeDefined();
      expect(enrollmentStatus!.allowedValues).toContain('ENROLLED');
      expect(enrollmentStatus!.allowedValues).toContain('TRANSFERRED');
      expect(enrollmentStatus!.allowedValues).toContain('WITHDRAWN');
      expect(enrollmentStatus!.allowedValues).toContain('GRADUATED');
    });

    it('should have FOREIGN KEY constraints for relationship columns', () => {
      const fkConstraints = SCHEMA_CONSTRAINTS.filter((c) => c.type === 'foreign_key');
      expect(fkConstraints.length).toBeGreaterThan(0);

      const fkColumns = fkConstraints.map((c) => `${c.table}.${c.column}`);
      expect(fkColumns).toContain('institutions.area_id');
      expect(fkColumns).toContain('enrollments.student_id');
      expect(fkColumns).toContain('enrollments.institution_id');
    });

    it('should have STRING_LENGTH constraints for text columns', () => {
      const lengthConstraints = SCHEMA_CONSTRAINTS.filter((c) => c.type === 'string_length');
      expect(lengthConstraints.length).toBeGreaterThan(0);

      for (const constraint of lengthConstraints) {
        expect(constraint.maxLength).toBeDefined();
        expect(constraint.maxLength).toBeGreaterThan(0);
      }

      // Institution name max 255
      const institutionName = lengthConstraints.find(
        (c) => c.table === 'institutions' && c.column === 'name',
      );
      expect(institutionName).toBeDefined();
      expect(institutionName!.maxLength).toBe(255);

      // Institution code max 50
      const institutionCode = lengthConstraints.find(
        (c) => c.table === 'institutions' && c.column === 'code',
      );
      expect(institutionCode).toBeDefined();
      expect(institutionCode!.maxLength).toBe(50);
    });

    it('should mark all NOT NULL and UNIQUE constraints as errors', () => {
      const criticalConstraints = SCHEMA_CONSTRAINTS.filter(
        (c) => c.type === 'not_null' || c.type === 'unique' || c.type === 'foreign_key',
      );

      for (const constraint of criticalConstraints) {
        expect(constraint.severity).toBe('error');
      }
    });

    it('should mark STRING_LENGTH constraints as warnings', () => {
      const lengthConstraints = SCHEMA_CONSTRAINTS.filter((c) => c.type === 'string_length');

      for (const constraint of lengthConstraints) {
        expect(constraint.severity).toBe('warning');
      }
    });
  });

  describe('serializeConstraintReport', () => {
    it('should serialize a passing report', () => {
      const report: ConstraintValidationReport = {
        timestamp: '2024-01-15T10:00:00.000Z',
        totalViolations: 0,
        errorCount: 0,
        warningCount: 0,
        violations: [],
        tablesChecked: 7,
        constraintsChecked: 30,
        status: 'pass',
      };

      const json = serializeConstraintReport(report);
      const parsed = JSON.parse(json);

      expect(parsed.status).toBe('pass');
      expect(parsed.totalViolations).toBe(0);
      expect(parsed.tablesChecked).toBe(7);
    });

    it('should serialize a report with violations', () => {
      const violations: ConstraintViolation[] = [
        {
          table: 'institutions',
          column: 'code',
          constraintType: 'unique',
          violationCount: 3,
          sampleValues: ['SCH001', 'SCH002', 'SCH003'],
          sampleIds: [],
          message: "3 duplicate values found in column 'code'",
          severity: 'error',
        },
        {
          table: 'students',
          column: 'first_name',
          constraintType: 'string_length',
          violationCount: 5,
          sampleValues: ['A very long name that exceeds the limit...'],
          sampleIds: [],
          message: "5 rows exceed max length 100 in column 'first_name'",
          severity: 'warning',
        },
      ];

      const report: ConstraintValidationReport = {
        timestamp: '2024-01-15T10:00:00.000Z',
        totalViolations: 2,
        errorCount: 1,
        warningCount: 1,
        violations,
        tablesChecked: 7,
        constraintsChecked: 30,
        status: 'violations_found',
      };

      const json = serializeConstraintReport(report);
      const parsed = JSON.parse(json);

      expect(parsed.status).toBe('violations_found');
      expect(parsed.totalViolations).toBe(2);
      expect(parsed.errorCount).toBe(1);
      expect(parsed.warningCount).toBe(1);
      expect(parsed.violations[0].constraintType).toBe('unique');
      expect(parsed.violations[1].constraintType).toBe('string_length');
    });
  });
});
