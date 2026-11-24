/**
 * Health write forms — directory labels for student/staff/school pickers.
 *
 * HL-O4: these read one 20-row page, so a student, counsellor or school beyond the
 * first 20 could not be selected. They now use the shared directory loaders: students
 * are paged to the end, staff and schools are read at the API page maximum. Labels
 * never carry the national ID (PRC-M156).
 */
import type { EntityLabelOption } from '@/lib/entity-label';
import {
  loadInstitutionOptions,
  loadStaffOptions,
  loadStudentOptions,
} from '@/lib/load-entity-labels';

export function loadHealthStudentOptions(): Promise<EntityLabelOption[]> {
  return loadStudentOptions();
}

export function loadHealthInstitutionOptions(): Promise<EntityLabelOption[]> {
  return loadInstitutionOptions();
}

export function loadHealthStaffOptions(): Promise<EntityLabelOption[]> {
  return loadStaffOptions();
}
