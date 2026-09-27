import { directoryLabel } from '@/lib/entity-label';

/** Student and route names for a transport assignment option. */
export function transportAssignmentLabel(
  studentId: string,
  routeId: string,
  studentLabels: Record<string, string>,
  routeLabels: Record<string, string>,
): string {
  const student = directoryLabel(studentId, studentLabels, 'Unknown student');
  const route = directoryLabel(routeId, routeLabels, 'Unknown route');
  return `${student} · ${route}`;
}
