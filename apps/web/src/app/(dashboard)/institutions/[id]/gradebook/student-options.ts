/**
 * HN-F4-R1: gradebook student picker options. The code shown next to the name is the
 * tenant's gradebook code, else the admission/roll code; never the national ID.
 */
import type { Student } from '@/lib/api/students';
import { formatPersonLabel, type EntityLabelOption } from '@/lib/entity-label';
import { studentDisplayCode } from '@/lib/load-entity-labels';

function gradebookStudentCode(student: Student): string | null {
  const custom = student.customData?.gradebookCode;
  return typeof custom === 'string' && custom.length > 0 ? custom : studentDisplayCode(student);
}

export function toGradebookStudentOption(student: Student): EntityLabelOption {
  const code = gradebookStudentCode(student);
  return {
    id: student.id,
    label: formatPersonLabel(student.firstName, student.lastName, code),
    searchText: [student.firstName, student.lastName, code].filter(Boolean).join(' '),
  };
}
