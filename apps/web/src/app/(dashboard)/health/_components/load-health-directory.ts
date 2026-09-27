/**
 * Health write forms — directory labels for student/staff pickers.
 * Uses an explicit page size (20) so gateway validation never rejects the request
 * and the client does not silently render an empty picker.
 */
import { listStaff } from '@/lib/api/staff';
import { listStudents } from '@/lib/api/students';
import { formatPersonLabel, type EntityLabelOption } from '@/lib/entity-label';

const HEALTH_DIRECTORY_PAGE_SIZE = 20;

export async function loadHealthStudentOptions(): Promise<EntityLabelOption[]> {
  const result = await listStudents({ pageSize: HEALTH_DIRECTORY_PAGE_SIZE });
  return (result.data ?? []).map((student) => ({
    id: student.id,
    label: formatPersonLabel(student.firstName, student.lastName, student.nationalId),
    searchText: `${student.firstName} ${student.lastName} ${student.nationalId ?? ''}`,
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
