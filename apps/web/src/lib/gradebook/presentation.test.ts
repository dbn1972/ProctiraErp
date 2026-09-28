import { describe, expect, it } from 'vitest';

import {
  formatGpaSnapshotMessage,
  humanGradebookError,
  reportCardStatusLabel,
} from './presentation';

describe('gradebook presentation', () => {
  it('hides developer schema paths', () => {
    expect(
      humanGradebookError(
        'listGradebookSections failed: GRADEBOOK_SCHEMA_MISSING — apply db/sql/003_sis_timetable_schedule_schema.sql',
        'GRADEBOOK_SCHEMA_MISSING',
      ),
    ).not.toMatch(/db\/sql|WS2/);
  });

  it('hides seed instructions', () => {
    expect(
      humanGradebookError(
        'Seed with db/seeds/004_sis_gradebook_credit_section.sql or create sections',
      ),
    ).not.toMatch(/db\/seeds/);
  });

  it('formats GPA and report-card labels without ids', () => {
    expect(
      formatGpaSnapshotMessage({ weightedGpa: 9.6, unweightedGpa: 9.4, creditsEarned: 24 }),
    ).toBe('GPA snapshot saved · weighted 9.6 · unweighted 9.4 · credits 24');
    expect(reportCardStatusLabel('SUCCEEDED')).toBe('Done');
    expect(reportCardStatusLabel('FAILED')).toBe('Failed');
    expect(reportCardStatusLabel('QUEUED')).toBe('Queued');
  });
});
