/**
 * Student target fields for bulk import column mapping.
 * Defines the available fields that file columns can be mapped to.
 *
 * _Requirements: 6.1, 6.7_
 */

import type { TargetField } from './types';

export const STUDENT_TARGET_FIELDS: TargetField[] = [
  { name: 'firstName', label: 'First Name', required: true, type: 'text' },
  { name: 'lastName', label: 'Last Name', required: true, type: 'text' },
  { name: 'dateOfBirth', label: 'Date of Birth', required: true, type: 'date' },
  { name: 'gender', label: 'Gender', required: false, type: 'select' },
  { name: 'nationalId', label: 'National ID', required: false, type: 'text' },
  { name: 'email', label: 'Email', required: false, type: 'email' },
  { name: 'phone', label: 'Phone', required: false, type: 'phone' },
  { name: 'address', label: 'Address', required: false, type: 'text' },
  { name: 'nationality', label: 'Nationality', required: false, type: 'text' },
  { name: 'guardianName', label: 'Guardian Name', required: false, type: 'text' },
  { name: 'guardianPhone', label: 'Guardian Phone', required: false, type: 'phone' },
  { name: 'guardianEmail', label: 'Guardian Email', required: false, type: 'email' },
  { name: 'guardianRelation', label: 'Guardian Relation', required: false, type: 'select' },
  { name: 'enrollmentStatus', label: 'Enrollment Status', required: false, type: 'select' },
  { name: 'institutionCode', label: 'Institution Code', required: false, type: 'text' },
  { name: 'gradeLevel', label: 'Grade Level', required: false, type: 'text' },
  { name: 'className', label: 'Class Name', required: false, type: 'text' },
  { name: 'admissionDate', label: 'Admission Date', required: false, type: 'date' },
  { name: 'previousSchool', label: 'Previous School', required: false, type: 'text' },
  { name: 'specialNeeds', label: 'Special Needs', required: false, type: 'text' },
];
