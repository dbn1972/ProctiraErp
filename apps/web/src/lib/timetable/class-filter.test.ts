import { describe, expect, it } from 'vitest';
import { classFilterOptions, sectionClassKey } from './subject-label';

describe('timetable class filter (PRC-M103)', () => {
  const sections = [
    { id: 'a', name: 'Class 9-B Mathematics' },
    { id: 'b', name: 'Class 10-A English' },
    { id: 'c', name: 'Class 9-B Science' },
    { id: 'd', name: 'Robotics Club' },
  ];

  it('groups banded sections and keeps unbanded ones reachable', () => {
    expect(classFilterOptions(sections)).toEqual([
      { value: '9-B', label: 'Class 9-B' },
      { value: '10-A', label: 'Class 10-A' },
      { value: 'section:d', label: 'Robotics Club' },
    ]);
    expect(sectionClassKey(sections[3]!)).toBe('section:d');
    expect(sectionClassKey(sections[0]!)).toBe('9-B');
  });
});
