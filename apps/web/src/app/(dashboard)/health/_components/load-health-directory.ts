/**
 * Health write forms — directory labels for student/staff pickers.
 * Uses an explicit page size (20) so gateway validation never rejects the request
 * and the client does not silently render an empty picker.
 */
import { toStudentOption } from '@/lib/load-entity-labels';
import { listInstitutions } from '@/lib/api/institutions';
import { listStaff } from '@/lib/api/staff';
import { listStudents } from '@/lib/api/students';
import { formatCodeNameLabel, formatPersonLabel, type EntityLabelOption } from '@/lib/entity-label';

const HEALTH_DIRECTORY_PAGE_SIZE = 20;

export async function loadHealthStudentOptions(): Promise<EntityLabelOption[]> {
  const result = await listStudents({ pageSize: HEALTH_DIRECTORY_PAGE_SIZE });
  // PRC-M156: labels never carry the national ID.
  return (result.data ?? []).map(toStudentOption);
}

export async function loadHealthInstitutionOptions(): Promise<EntityLabelOption[]> {
  const rows = await listInstitutions({ pageSize: HEALTH_DIRECTORY_PAGE_SIZE });
  return rows.map((row) => ({
    id: row.id,
    label: formatCodeNameLabel(row.code, row.name) || row.name,
    searchText: `${row.code} ${row.name}`,
  }));
}

export async function loadHealthStaffOptions(): Promise<EntityLabelOption[]> {
  const result = await listStaff({ pageSize: HEALTH_DIRECTORY_PAGE_SIZE });
  return (result.data ?? []).map((staff) => ({
    id: staff.id,
    label: formatPersonLabel(staff.firstName, staff.lastName, staff.position),
    searchText: `${staff.firstName} ${staff.lastName} ${staff.position}`,
  }));
}
