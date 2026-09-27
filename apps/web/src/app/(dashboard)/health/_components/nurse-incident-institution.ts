const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A nurse visit must name a school. An empty string is not a valid institution id.
 */
export function nurseIncidentInstitutionError(
  institutionId: string,
  schoolCount: number,
): string | null {
  if (schoolCount === 0) {
    return 'School directory is empty — add a school before logging a visit.';
  }
  if (!UUID_RE.test(institutionId.trim())) {
    return 'Select a school.';
  }
  return null;
}
