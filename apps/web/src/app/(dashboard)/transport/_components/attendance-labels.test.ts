import { describe, expect, it } from 'vitest';

import { transportAssignmentLabel } from './attendance-labels';

const studentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const routeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

describe('transportAssignmentLabel', () => {
  it('uses student and route names', () => {
    expect(
      transportAssignmentLabel(
        studentId,
        routeId,
        { [studentId]: 'S-01 · Asha Rao' },
        { [routeId]: 'North loop' },
      ),
    ).toBe('S-01 · Asha Rao · North loop');
  });

  it('does not render truncated ids when the directory misses', () => {
    expect(transportAssignmentLabel(studentId, routeId, {}, {})).toBe(
      'Unknown student · Unknown route',
    );
  });
});
