/**
 * Human labels for student list, profile, and transfer.
 *
 * Sunrise (and any tenant that stores class on the enrollment, not customData)
 * must show the person's name and the class/section name. A raw UUID is never
 * the primary label.
 */
import { formatPersonLabel, isUuidLike } from '@/lib/entity-label';

export interface PlacementDirectories {
  institutions: Map<string, string>;
  grades: Map<string, string>;
  classes: Map<string, string>;
}

export function emptyPlacementDirectories(): PlacementDirectories {
  return {
    institutions: new Map(),
    grades: new Map(),
    classes: new Map(),
  };
}

function directoryName(map: Map<string, string>, id: string | null | undefined): string {
  if (!id) return '';
  const hit = map.get(id)?.trim() ?? '';
  if (!hit || isUuidLike(hit)) return '';
  return hit;
}

export function studentDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  const name = formatPersonLabel(firstName, lastName);
  return name || 'Student';
}

/**
 * Grade / section cell. Prefers the class name (for example "9-B") and prefixes
 * the grade name when it is not already part of that class name.
 */
export function classSectionLabel(input: {
  classId?: string | null;
  gradeId?: string | null;
  customGradeSection?: string | null;
  directories: PlacementDirectories;
}): string {
  const className = directoryName(input.directories.classes, input.classId);
  const gradeName = directoryName(input.directories.grades, input.gradeId);
  if (className) {
    if (gradeName && !className.toLowerCase().includes(gradeName.toLowerCase())) {
      return `${gradeName} · ${className}`;
    }
    return className;
  }
  const custom = (input.customGradeSection ?? '').trim();
  if (custom && !isUuidLike(custom)) return custom;
  if (gradeName) return gradeName;
  return '—';
}

export function institutionLabel(input: {
  institutionId?: string | null;
  customName?: string | null;
  directories: PlacementDirectories;
}): string {
  const fromDirectory = directoryName(input.directories.institutions, input.institutionId);
  if (fromDirectory) return fromDirectory;
  const custom = (input.customName ?? '').trim();
  if (custom && !isUuidLike(custom)) return custom;
  return '—';
}

/** Source-enrollment option: school and class, never the enrollment UUID. */
export function enrollmentOptionLabel(input: {
  institutionId?: string | null;
  classId?: string | null;
  gradeId?: string | null;
  customGradeSection?: string | null;
  customInstitutionName?: string | null;
  directories: PlacementDirectories;
}): string {
  const school = institutionLabel({
    institutionId: input.institutionId,
    customName: input.customInstitutionName,
    directories: input.directories,
  });
  const section = classSectionLabel({
    classId: input.classId,
    gradeId: input.gradeId,
    customGradeSection: input.customGradeSection,
    directories: input.directories,
  });
  if (school !== '—' && section !== '—') return `${school} · ${section}`;
  if (school !== '—') return school;
  if (section !== '—') return section;
  return 'Current enrollment';
}
