import { describe, expect, it } from 'vitest';

import { nurseIncidentInstitutionError } from './nurse-incident-institution';

const SCHOOL = '11111111-1111-4111-8111-111111111111';

describe('nurse incident school', () => {
  it('rejects an empty institution id', () => {
    expect(nurseIncidentInstitutionError('', 1)).toBe('Select a school.');
    expect(nurseIncidentInstitutionError('   ', 2)).toBe('Select a school.');
  });

  it('rejects a visit when no schools are loaded', () => {
    expect(nurseIncidentInstitutionError('', 0)).toBe(
      'School directory is empty — add a school before logging a visit.',
    );
    expect(nurseIncidentInstitutionError(SCHOOL, 0)).toBe(
      'School directory is empty — add a school before logging a visit.',
    );
  });

  it('accepts a selected school id', () => {
    expect(nurseIncidentInstitutionError(SCHOOL, 1)).toBeNull();
  });
});
