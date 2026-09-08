/**
 * Legacy CakePHP table → new Prisma model mappings.
 *
 * The legacy ProctiraERP system uses CakePHP conventions:
 * - Integer auto-increment primary keys
 * - snake_case table names (often prefixed by domain: institution_*, security_*)
 * - `created` / `modified` timestamp columns
 * - `created_user_id` / `modified_user_id` audit columns
 * - `security_users` table holds ALL user types (students, staff, guardians, admins)
 *
 * The new system uses:
 * - UUID primary keys
 * - Service-prefixed table names matching Prisma @@map()
 * - `created_at` / `updated_at` / `deleted_at` columns
 * - Separate tables for students, staff, etc.
 * - tenant_id on every row for RLS
 */

import { TableMapping } from './types.js';

export const TABLE_MAPPINGS: TableMapping[] = [
  // =========================================================================
  // GEOGRAPHIC AREAS (area hierarchy)
  // =========================================================================
  {
    sourceTable: 'areas',
    targetTable: 'geographic_areas',
    legacyPkColumn: 'id',
    requiresUuidGeneration: true,
    columns: [
      { source: 'id', target: 'id' },
      { source: 'name', target: 'name' },
      { source: 'code', target: 'code' },
      {
        source: 'area_level_id',
        target: 'level',
        transform: { type: 'cast', targetType: 'smallint' },
      },
      { source: 'parent_id', target: 'parent_id' },
      { source: 'lft', target: 'lft' },
      { source: 'rght', target: 'rgt' },
      { source: 'created', target: 'created_at' },
      { source: 'modified', target: 'updated_at' },
    ],
    foreignKeys: [
      {
        column: 'parent_id',
        referencesTable: 'areas',
        referencesColumn: 'id',
        targetReferencesTable: 'geographic_areas',
      },
    ],
  },

  // =========================================================================
  // INSTITUTIONS
  // =========================================================================
  {
    sourceTable: 'institutions',
    targetTable: 'institutions',
    legacyPkColumn: 'id',
    requiresUuidGeneration: true,
    columns: [
      { source: 'id', target: 'id' },
      { source: 'name', target: 'name' },
      { source: 'code', target: 'code' },
      { source: 'area_id', target: 'area_id' },
      {
        source: 'institution_type_id',
        target: 'type',
        transform: { type: 'cast', targetType: 'varchar' },
      },
      {
        source: 'institution_sector_id',
        target: 'sector',
        transform: { type: 'cast', targetType: 'varchar' },
      },
      {
        source: 'institution_ownership_id',
        target: 'ownership',
        transform: { type: 'cast', targetType: 'varchar' },
      },
      {
        source: 'institution_status_id',
        target: 'status',
        transform: {
          type: 'map_enum',
          mapping: { '1': 'active', '2': 'inactive' },
        },
      },
      { source: 'created', target: 'created_at' },
      { source: 'modified', target: 'updated_at' },
    ],
    foreignKeys: [
      {
        column: 'area_id',
        referencesTable: 'areas',
        referencesColumn: 'id',
        targetReferencesTable: 'geographic_areas',
      },
    ],
  },

  // =========================================================================
  // STUDENTS (extracted from security_users where is_student = 1)
  // =========================================================================
  {
    sourceTable: 'security_users',
    targetTable: 'students',
    legacyPkColumn: 'id',
    requiresUuidGeneration: true,
    sourceFilter: 'is_student = 1',
    columns: [
      { source: 'id', target: 'id' },
      { source: 'first_name', target: 'first_name' },
      { source: 'last_name', target: 'last_name' },
      { source: 'date_of_birth', target: 'date_of_birth' },
      {
        source: 'gender_id',
        target: 'gender',
        transform: {
          type: 'map_enum',
          mapping: { '1': 'male', '2': 'female' },
        },
      },
      { source: 'identity_number', target: 'national_id' },
      { source: 'created', target: 'created_at' },
      { source: 'modified', target: 'updated_at' },
    ],
    foreignKeys: [],
  },

  // =========================================================================
  // STAFF (extracted from security_users where is_staff = 1)
  // =========================================================================
  {
    sourceTable: 'security_users',
    targetTable: 'staff',
    legacyPkColumn: 'id',
    requiresUuidGeneration: true,
    sourceFilter: 'is_staff = 1',
    columns: [
      { source: 'id', target: 'id' },
      { source: 'first_name', target: 'first_name' },
      { source: 'last_name', target: 'last_name' },
      { source: 'date_of_birth', target: 'date_of_birth' },
      { source: 'identity_number', target: 'identity_number' },
      { source: 'created', target: 'created_at' },
      { source: 'modified', target: 'updated_at' },
    ],
    foreignKeys: [],
  },

  // =========================================================================
  // ACADEMIC PERIODS
  // =========================================================================
  {
    sourceTable: 'academic_periods',
    targetTable: 'academic_periods',
    legacyPkColumn: 'id',
    requiresUuidGeneration: true,
    columns: [
      { source: 'id', target: 'id' },
      { source: 'name', target: 'name' },
      { source: 'code', target: 'code' },
      { source: 'start_date', target: 'start_date' },
      { source: 'end_date', target: 'end_date' },
      {
        source: 'current',
        target: 'status',
        transform: {
          type: 'map_enum',
          mapping: { '1': 'active', '0': 'inactive' },
        },
      },
      { source: 'created', target: 'created_at' },
      { source: 'modified', target: 'updated_at' },
    ],
    foreignKeys: [],
  },

  // =========================================================================
  // GRADES (education_grades)
  // =========================================================================
  {
    sourceTable: 'education_grades',
    targetTable: 'grades',
    legacyPkColumn: 'id',
    requiresUuidGeneration: true,
    columns: [
      { source: 'id', target: 'id' },
      { source: 'name', target: 'name' },
      { source: 'code', target: 'code' },
      { source: 'order', target: 'order' },
      { source: 'created', target: 'created_at' },
      { source: 'modified', target: 'updated_at' },
    ],
    foreignKeys: [],
  },

  // =========================================================================
  // CLASSES (institution_classes)
  // =========================================================================
  {
    sourceTable: 'institution_classes',
    targetTable: 'classes',
    legacyPkColumn: 'id',
    requiresUuidGeneration: true,
    columns: [
      { source: 'id', target: 'id' },
      { source: 'institution_id', target: 'institution_id' },
      { source: 'education_grade_id', target: 'grade_id' },
      { source: 'academic_period_id', target: 'academic_period_id' },
      { source: 'name', target: 'name' },
      { source: 'capacity', target: 'capacity' },
      { source: 'created', target: 'created_at' },
      { source: 'modified', target: 'updated_at' },
    ],
    foreignKeys: [
      {
        column: 'institution_id',
        referencesTable: 'institutions',
        referencesColumn: 'id',
        targetReferencesTable: 'institutions',
      },
      {
        column: 'grade_id',
        referencesTable: 'education_grades',
        referencesColumn: 'id',
        targetReferencesTable: 'grades',
      },
      {
        column: 'academic_period_id',
        referencesTable: 'academic_periods',
        referencesColumn: 'id',
        targetReferencesTable: 'academic_periods',
      },
    ],
  },

  // =========================================================================
  // ENROLLMENTS (institution_students → enrollments)
  // =========================================================================
  {
    sourceTable: 'institution_students',
    targetTable: 'enrollments',
    legacyPkColumn: 'id',
    requiresUuidGeneration: true,
    columns: [
      { source: 'id', target: 'id' },
      { source: 'student_id', target: 'student_id' },
      { source: 'institution_id', target: 'institution_id' },
      { source: 'education_grade_id', target: 'grade_id' },
      { source: 'institution_class_id', target: 'class_id' },
      { source: 'academic_period_id', target: 'academic_period_id' },
      {
        source: 'student_status_id',
        target: 'status',
        transform: {
          type: 'map_enum',
          mapping: {
            '1': 'ENROLLED',
            '2': 'TRANSFERRED',
            '3': 'WITHDRAWN',
            '4': 'GRADUATED',
          },
        },
      },
      { source: 'start_date', target: 'enrolled_at' },
      { source: 'end_date', target: 'exited_at' },
      { source: 'created', target: 'created_at' },
      { source: 'modified', target: 'updated_at' },
    ],
    foreignKeys: [
      {
        column: 'student_id',
        referencesTable: 'security_users',
        referencesColumn: 'id',
        targetReferencesTable: 'students',
      },
      {
        column: 'institution_id',
        referencesTable: 'institutions',
        referencesColumn: 'id',
        targetReferencesTable: 'institutions',
      },
      {
        column: 'grade_id',
        referencesTable: 'education_grades',
        referencesColumn: 'id',
        targetReferencesTable: 'grades',
      },
      {
        column: 'class_id',
        referencesTable: 'institution_classes',
        referencesColumn: 'id',
        targetReferencesTable: 'classes',
      },
      {
        column: 'academic_period_id',
        referencesTable: 'academic_periods',
        referencesColumn: 'id',
        targetReferencesTable: 'academic_periods',
      },
    ],
  },

  // =========================================================================
  // SUBJECTS
  // =========================================================================
  {
    sourceTable: 'education_subjects',
    targetTable: 'subjects',
    legacyPkColumn: 'id',
    requiresUuidGeneration: true,
    columns: [
      { source: 'id', target: 'id' },
      { source: 'name', target: 'name' },
      { source: 'code', target: 'code' },
      { source: 'created', target: 'created_at' },
      { source: 'modified', target: 'updated_at' },
    ],
    foreignKeys: [],
  },

  // =========================================================================
  // INSTITUTION SUBJECTS (grade-subject linkage per institution)
  // =========================================================================
  {
    sourceTable: 'institution_subjects',
    targetTable: 'institution_subjects',
    legacyPkColumn: 'id',
    requiresUuidGeneration: true,
    columns: [
      { source: 'id', target: 'id' },
      { source: 'institution_id', target: 'institution_id' },
      { source: 'education_subject_id', target: 'subject_id' },
      { source: 'education_grade_id', target: 'grade_id' },
      { source: 'created', target: 'created_at' },
      { source: 'modified', target: 'updated_at' },
    ],
    foreignKeys: [
      {
        column: 'institution_id',
        referencesTable: 'institutions',
        referencesColumn: 'id',
        targetReferencesTable: 'institutions',
      },
      {
        column: 'subject_id',
        referencesTable: 'education_subjects',
        referencesColumn: 'id',
        targetReferencesTable: 'subjects',
      },
      {
        column: 'grade_id',
        referencesTable: 'education_grades',
        referencesColumn: 'id',
        targetReferencesTable: 'grades',
      },
    ],
  },
];

/**
 * Returns the table mapping for a given legacy source table.
 * If the source table has multiple mappings (e.g., security_users → students, staff),
 * returns all of them.
 */
export function getMappingsForSource(sourceTable: string): TableMapping[] {
  return TABLE_MAPPINGS.filter((m) => m.sourceTable === sourceTable);
}

/**
 * Returns the table mapping for a given target table.
 */
export function getMappingForTarget(targetTable: string): TableMapping | undefined {
  return TABLE_MAPPINGS.find((m) => m.targetTable === targetTable);
}

/**
 * Returns all unique source tables referenced in the mappings.
 */
export function getAllSourceTables(): string[] {
  return [...new Set(TABLE_MAPPINGS.map((m) => m.sourceTable))];
}

/**
 * Returns all unique target tables referenced in the mappings.
 */
export function getAllTargetTables(): string[] {
  return [...new Set(TABLE_MAPPINGS.map((m) => m.targetTable))];
}
