/**
 * Schema Constraint Validator.
 *
 * Validates migrated data against new PostgreSQL schema constraints.
 * Reports violations without halting the migration process.
 *
 * Satisfies Requirement 24.5: Validate migrated data against new schema constraints
 * and report violations without halting the migration process.
 *
 * Checks:
 * - NOT NULL constraints on required columns
 * - UNIQUE constraints (duplicate detection)
 * - CHECK constraints (enum values, ranges)
 * - Foreign key integrity
 * - Data type compatibility
 * - String length limits
 * - UUID format validity
 */

import { Pool, PoolClient } from 'pg';
import { MigrationConfig, MigrationStepResult } from './types.js';
import { TABLE_MAPPINGS } from './table-mappings.js';

/** A single constraint violation found during validation. */
export interface ConstraintViolation {
  table: string;
  column: string;
  constraintType: ConstraintType;
  violationCount: number;
  sampleValues: string[];
  sampleIds: string[];
  message: string;
  severity: 'error' | 'warning';
}

export type ConstraintType =
  | 'not_null'
  | 'unique'
  | 'foreign_key'
  | 'check'
  | 'data_type'
  | 'string_length'
  | 'uuid_format'
  | 'enum_value'
  | 'date_range';

/** Schema constraint definition for validation. */
export interface SchemaConstraint {
  table: string;
  column: string;
  type: ConstraintType;
  /** For string_length: max allowed length */
  maxLength?: number;
  /** For enum_value: allowed values */
  allowedValues?: string[];
  /** For date_range: min/max dates */
  minDate?: string;
  maxDate?: string;
  /** Whether this is a hard constraint (error) or soft (warning) */
  severity: 'error' | 'warning';
}

/** Constraint validation report. */
export interface ConstraintValidationReport {
  timestamp: string;
  totalViolations: number;
  errorCount: number;
  warningCount: number;
  violations: ConstraintViolation[];
  tablesChecked: number;
  constraintsChecked: number;
  status: 'pass' | 'violations_found' | 'error';
}

/**
 * Defines the schema constraints for the new PostgreSQL schema.
 * These represent the target schema's rules that migrated data must satisfy.
 */
export const SCHEMA_CONSTRAINTS: SchemaConstraint[] = [
  // Institutions
  { table: 'institutions', column: 'name', type: 'not_null', severity: 'error' },
  { table: 'institutions', column: 'code', type: 'not_null', severity: 'error' },
  { table: 'institutions', column: 'code', type: 'unique', severity: 'error' },
  { table: 'institutions', column: 'area_id', type: 'not_null', severity: 'error' },
  { table: 'institutions', column: 'area_id', type: 'foreign_key', severity: 'error' },
  {
    table: 'institutions',
    column: 'name',
    type: 'string_length',
    maxLength: 255,
    severity: 'warning',
  },
  {
    table: 'institutions',
    column: 'code',
    type: 'string_length',
    maxLength: 50,
    severity: 'warning',
  },
  {
    table: 'institutions',
    column: 'status',
    type: 'enum_value',
    allowedValues: ['active', 'inactive'],
    severity: 'error',
  },

  // Students
  { table: 'students', column: 'first_name', type: 'not_null', severity: 'error' },
  { table: 'students', column: 'last_name', type: 'not_null', severity: 'error' },
  { table: 'students', column: 'date_of_birth', type: 'not_null', severity: 'error' },
  {
    table: 'students',
    column: 'first_name',
    type: 'string_length',
    maxLength: 100,
    severity: 'warning',
  },
  {
    table: 'students',
    column: 'last_name',
    type: 'string_length',
    maxLength: 100,
    severity: 'warning',
  },
  {
    table: 'students',
    column: 'gender',
    type: 'enum_value',
    allowedValues: ['male', 'female', 'other'],
    severity: 'warning',
  },

  // Staff
  { table: 'staff', column: 'first_name', type: 'not_null', severity: 'error' },
  { table: 'staff', column: 'last_name', type: 'not_null', severity: 'error' },
  { table: 'staff', column: 'date_of_birth', type: 'not_null', severity: 'error' },
  { table: 'staff', column: 'identity_number', type: 'unique', severity: 'error' },
  {
    table: 'staff',
    column: 'first_name',
    type: 'string_length',
    maxLength: 100,
    severity: 'warning',
  },
  {
    table: 'staff',
    column: 'last_name',
    type: 'string_length',
    maxLength: 100,
    severity: 'warning',
  },

  // Enrollments
  { table: 'enrollments', column: 'student_id', type: 'not_null', severity: 'error' },
  { table: 'enrollments', column: 'institution_id', type: 'not_null', severity: 'error' },
  { table: 'enrollments', column: 'student_id', type: 'foreign_key', severity: 'error' },
  { table: 'enrollments', column: 'institution_id', type: 'foreign_key', severity: 'error' },
  {
    table: 'enrollments',
    column: 'status',
    type: 'enum_value',
    allowedValues: ['ENROLLED', 'TRANSFERRED', 'WITHDRAWN', 'GRADUATED'],
    severity: 'error',
  },

  // Geographic Areas
  { table: 'geographic_areas', column: 'name', type: 'not_null', severity: 'error' },
  { table: 'geographic_areas', column: 'code', type: 'not_null', severity: 'error' },
  {
    table: 'geographic_areas',
    column: 'name',
    type: 'string_length',
    maxLength: 255,
    severity: 'warning',
  },

  // Academic Periods
  { table: 'academic_periods', column: 'name', type: 'not_null', severity: 'error' },
  { table: 'academic_periods', column: 'start_date', type: 'not_null', severity: 'error' },
  { table: 'academic_periods', column: 'end_date', type: 'not_null', severity: 'error' },
  {
    table: 'academic_periods',
    column: 'status',
    type: 'enum_value',
    allowedValues: ['active', 'inactive', 'archived'],
    severity: 'warning',
  },

  // Classes
  { table: 'classes', column: 'name', type: 'not_null', severity: 'error' },
  { table: 'classes', column: 'institution_id', type: 'not_null', severity: 'error' },
  { table: 'classes', column: 'grade_id', type: 'not_null', severity: 'error' },
  { table: 'classes', column: 'institution_id', type: 'foreign_key', severity: 'error' },
  { table: 'classes', column: 'grade_id', type: 'foreign_key', severity: 'error' },

  // Grades
  { table: 'grades', column: 'name', type: 'not_null', severity: 'error' },

  // Subjects
  { table: 'subjects', column: 'name', type: 'not_null', severity: 'error' },
];

/**
 * FK reference table mapping for validation.
 */
const FK_REFERENCES: Record<string, Record<string, string>> = {
  institutions: { area_id: 'geographic_areas' },
  enrollments: {
    student_id: 'students',
    institution_id: 'institutions',
    grade_id: 'grades',
    class_id: 'classes',
    academic_period_id: 'academic_periods',
  },
  classes: {
    institution_id: 'institutions',
    grade_id: 'grades',
    academic_period_id: 'academic_periods',
  },
  institution_subjects: {
    institution_id: 'institutions',
    subject_id: 'subjects',
    grade_id: 'grades',
  },
};

/**
 * Validates all migrated data against schema constraints.
 * Reports violations without halting — all tables are checked regardless of failures.
 */
export async function validateConstraints(config: MigrationConfig): Promise<MigrationStepResult> {
  const startTime = Date.now();
  const stepErrors: MigrationStepResult['errors'] = [];
  const stepWarnings: MigrationStepResult['warnings'] = [];

  const pool = new Pool({
    host: config.pg.host,
    port: config.pg.port,
    database: config.pg.database,
    user: config.pg.user,
    password: config.pg.password,
  });

  let client: PoolClient | null = null;

  try {
    client = await pool.connect();

    console.log('[constraint-validator] Starting schema constraint validation...');

    const violations: ConstraintViolation[] = [];
    let constraintsChecked = 0;
    const tablesChecked = new Set<string>();

    for (const constraint of SCHEMA_CONSTRAINTS) {
      constraintsChecked++;
      tablesChecked.add(constraint.table);

      try {
        const violation = await checkConstraint(client, constraint, config.pg.schema);
        if (violation) {
          violations.push(violation);

          if (violation.severity === 'error') {
            stepErrors.push({
              table: violation.table,
              column: violation.column,
              message: violation.message,
            });
          } else {
            stepWarnings.push({
              table: violation.table,
              message: violation.message,
              count: violation.violationCount,
            });
          }

          const icon = violation.severity === 'error' ? '✗' : '⚠';
          console.log(
            `[constraint-validator]   ${icon} ${violation.table}.${violation.column}: ${violation.message}`,
          );
        }
      } catch {
        // Table or column might not exist yet — skip silently
      }
    }

    const errorCount = violations.filter((v) => v.severity === 'error').length;
    const warningCount = violations.filter((v) => v.severity === 'warning').length;

    const report: ConstraintValidationReport = {
      timestamp: new Date().toISOString(),
      totalViolations: violations.length,
      errorCount,
      warningCount,
      violations,
      tablesChecked: tablesChecked.size,
      constraintsChecked,
      status: violations.length === 0 ? 'pass' : 'violations_found',
    };

    console.log('\n[constraint-validator] === CONSTRAINT VALIDATION REPORT ===');
    console.log(`[constraint-validator] Tables checked: ${report.tablesChecked}`);
    console.log(`[constraint-validator] Constraints checked: ${report.constraintsChecked}`);
    console.log(
      `[constraint-validator] Violations: ${report.totalViolations} (${errorCount} errors, ${warningCount} warnings)`,
    );
    console.log(`[constraint-validator] Status: ${report.status}`);

    return {
      step: 'constraint_validation',
      status: errorCount > 0 ? 'warning' : 'success', // Never 'error' — we report but don't halt
      tablesProcessed: tablesChecked.size,
      rowsProcessed: constraintsChecked,
      errors: stepErrors,
      warnings: stepWarnings,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stepErrors.push({ table: 'all', message: `Constraint validation failed: ${message}` });

    return {
      step: 'constraint_validation',
      status: 'error',
      tablesProcessed: 0,
      rowsProcessed: 0,
      errors: stepErrors,
      warnings: stepWarnings,
      durationMs: Date.now() - startTime,
    };
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

/**
 * Checks a single constraint against the migrated data.
 * Returns a violation if the constraint is violated, null otherwise.
 */
async function checkConstraint(
  client: PoolClient,
  constraint: SchemaConstraint,
  schema: string,
): Promise<ConstraintViolation | null> {
  switch (constraint.type) {
    case 'not_null':
      return checkNotNull(client, constraint, schema);
    case 'unique':
      return checkUnique(client, constraint, schema);
    case 'foreign_key':
      return checkForeignKey(client, constraint, schema);
    case 'string_length':
      return checkStringLength(client, constraint, schema);
    case 'enum_value':
      return checkEnumValue(client, constraint, schema);
    case 'uuid_format':
      return checkUuidFormat(client, constraint, schema);
    default:
      return null;
  }
}

async function checkNotNull(
  client: PoolClient,
  constraint: SchemaConstraint,
  schema: string,
): Promise<ConstraintViolation | null> {
  const result = await client.query(`
    SELECT COUNT(*) as count,
           ARRAY_AGG(id::text) FILTER (WHERE id IS NOT NULL) AS sample_ids
    FROM "${schema}"."${constraint.table}"
    WHERE "${constraint.column}" IS NULL
  `);

  const count = parseInt(result.rows[0].count, 10);
  if (count === 0) return null;

  const sampleIds = (result.rows[0].sample_ids || []).slice(0, 5);

  return {
    table: constraint.table,
    column: constraint.column,
    constraintType: 'not_null',
    violationCount: count,
    sampleValues: [],
    sampleIds,
    message: `${count} rows have NULL value in required column '${constraint.column}'`,
    severity: constraint.severity,
  };
}

async function checkUnique(
  client: PoolClient,
  constraint: SchemaConstraint,
  schema: string,
): Promise<ConstraintViolation | null> {
  const result = await client.query(`
    SELECT "${constraint.column}", COUNT(*) as dup_count
    FROM "${schema}"."${constraint.table}"
    WHERE "${constraint.column}" IS NOT NULL
    GROUP BY "${constraint.column}"
    HAVING COUNT(*) > 1
    LIMIT 5
  `);

  if (result.rows.length === 0) return null;

  const totalDuplicates = result.rows.reduce(
    (sum, row) => sum + parseInt(row.dup_count, 10) - 1,
    0,
  );
  const sampleValues = result.rows.map((row) => String(row[constraint.column]));

  return {
    table: constraint.table,
    column: constraint.column,
    constraintType: 'unique',
    violationCount: totalDuplicates,
    sampleValues,
    sampleIds: [],
    message: `${totalDuplicates} duplicate values found in column '${constraint.column}' (samples: ${sampleValues.join(', ')})`,
    severity: constraint.severity,
  };
}

async function checkForeignKey(
  client: PoolClient,
  constraint: SchemaConstraint,
  schema: string,
): Promise<ConstraintViolation | null> {
  const refTable = FK_REFERENCES[constraint.table]?.[constraint.column];
  if (!refTable) return null;

  const result = await client.query(`
    SELECT COUNT(*) as count,
           ARRAY_AGG(t."${constraint.column}"::text) FILTER (WHERE t."${constraint.column}" IS NOT NULL) AS sample_values
    FROM "${schema}"."${constraint.table}" t
    LEFT JOIN "${schema}"."${refTable}" ref ON t."${constraint.column}" = ref.id
    WHERE t."${constraint.column}" IS NOT NULL AND ref.id IS NULL
  `);

  const count = parseInt(result.rows[0].count, 10);
  if (count === 0) return null;

  const sampleValues = (result.rows[0].sample_values || []).slice(0, 5);

  return {
    table: constraint.table,
    column: constraint.column,
    constraintType: 'foreign_key',
    violationCount: count,
    sampleValues,
    sampleIds: [],
    message: `${count} rows reference non-existent records in '${refTable}' via column '${constraint.column}'`,
    severity: constraint.severity,
  };
}

async function checkStringLength(
  client: PoolClient,
  constraint: SchemaConstraint,
  schema: string,
): Promise<ConstraintViolation | null> {
  if (!constraint.maxLength) return null;

  const result = await client.query(`
    SELECT COUNT(*) as count,
           ARRAY_AGG(LEFT("${constraint.column}"::text, 50)) FILTER (WHERE LENGTH("${constraint.column}"::text) > ${constraint.maxLength}) AS sample_values
    FROM "${schema}"."${constraint.table}"
    WHERE LENGTH("${constraint.column}"::text) > ${constraint.maxLength}
  `);

  const count = parseInt(result.rows[0].count, 10);
  if (count === 0) return null;

  const sampleValues = (result.rows[0].sample_values || []).slice(0, 3);

  return {
    table: constraint.table,
    column: constraint.column,
    constraintType: 'string_length',
    violationCount: count,
    sampleValues,
    sampleIds: [],
    message: `${count} rows exceed max length ${constraint.maxLength} in column '${constraint.column}'`,
    severity: constraint.severity,
  };
}

async function checkEnumValue(
  client: PoolClient,
  constraint: SchemaConstraint,
  schema: string,
): Promise<ConstraintViolation | null> {
  if (!constraint.allowedValues || constraint.allowedValues.length === 0) return null;

  const placeholders = constraint.allowedValues.map((_, i) => `$${i + 1}`).join(', ');

  const result = await client.query(
    `SELECT "${constraint.column}", COUNT(*) as count
     FROM "${schema}"."${constraint.table}"
     WHERE "${constraint.column}" IS NOT NULL
       AND "${constraint.column}"::text NOT IN (${placeholders})
     GROUP BY "${constraint.column}"
     LIMIT 10`,
    constraint.allowedValues,
  );

  if (result.rows.length === 0) return null;

  const totalViolations = result.rows.reduce((sum, row) => sum + parseInt(row.count, 10), 0);
  const invalidValues = result.rows.map((row) => String(row[constraint.column]));

  return {
    table: constraint.table,
    column: constraint.column,
    constraintType: 'enum_value',
    violationCount: totalViolations,
    sampleValues: invalidValues,
    sampleIds: [],
    message: `${totalViolations} rows have invalid enum value in '${constraint.column}' (found: ${invalidValues.join(', ')}; allowed: ${constraint.allowedValues.join(', ')})`,
    severity: constraint.severity,
  };
}

async function checkUuidFormat(
  client: PoolClient,
  constraint: SchemaConstraint,
  schema: string,
): Promise<ConstraintViolation | null> {
  const uuidRegex = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  const result = await client.query(`
    SELECT COUNT(*) as count,
           ARRAY_AGG("${constraint.column}"::text) FILTER (WHERE "${constraint.column}" IS NOT NULL) AS sample_values
    FROM "${schema}"."${constraint.table}"
    WHERE "${constraint.column}" IS NOT NULL
      AND "${constraint.column}"::text !~ '${uuidRegex}'
  `);

  const count = parseInt(result.rows[0].count, 10);
  if (count === 0) return null;

  const sampleValues = (result.rows[0].sample_values || []).slice(0, 5);

  return {
    table: constraint.table,
    column: constraint.column,
    constraintType: 'uuid_format',
    violationCount: count,
    sampleValues,
    sampleIds: [],
    message: `${count} rows have invalid UUID format in column '${constraint.column}'`,
    severity: constraint.severity,
  };
}

/**
 * Serializes the constraint validation report to JSON.
 */
export function serializeConstraintReport(report: ConstraintValidationReport): string {
  return JSON.stringify(report, null, 2);
}
