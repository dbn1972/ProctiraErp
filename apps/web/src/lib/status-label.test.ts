import { describe, expect, it } from 'vitest';

import { attendanceBand, humanizeStatus, utilizationBand, workloadBand } from './status-label';

describe('humanizeStatus', () => {
  it('maps known enums to words', () => {
    expect(humanizeStatus('OVERDUE')).toBe('Overdue');
    expect(humanizeStatus('in_progress')).toBe('In progress');
    expect(humanizeStatus('paid')).toBe('Paid');
  });

  it('title-cases unknown snake enums and leaves prose', () => {
    expect(humanizeStatus('PART_PAID')).toBe('Part Paid');
    expect(humanizeStatus('Upcoming')).toBe('Upcoming');
    expect(humanizeStatus('')).toBe('—');
  });
});

describe('metric bands', () => {
  it('names attendance, utilization, and workload without relying on colour', () => {
    expect(attendanceBand(92)).toBe('On track');
    expect(attendanceBand(80)).toBe('Watch');
    expect(attendanceBand(80, 85)).toBe('Low');
    expect(utilizationBand(100)).toBe('Over capacity');
    expect(utilizationBand(96)).toBe('Near capacity');
    expect(workloadBand(70)).toBe('Steady');
    expect(workloadBand(40)).toBe('Light');
  });
});
