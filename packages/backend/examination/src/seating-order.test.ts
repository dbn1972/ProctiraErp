/**
 * PRC-M242 — seating allocation must order candidates by roll number using
 * natural numeric ordering (R2 before R10), not lexical ordering.
 */
import { describe, expect, it } from 'vitest';

import { generateSeatingPlan, type SeatingCandidate } from './seating-generator.js';

function candidate(roll: string, idx: number): SeatingCandidate {
  return {
    candidateId: `c${idx}`,
    studentId: `s${idx}`,
    studentName: `Student ${idx}`,
    rollNumber: roll,
    centerId: 'center-1',
    centerName: 'Center 1',
    subjectNames: ['Maths'],
  };
}

describe('seating generator roll-number ordering (PRC-M242)', () => {
  it('seats R2 before R10 (numeric), not lexical R10 before R2', () => {
    const rolls = ['R10', 'R2', 'R1', 'R21', 'R3'];
    const plan = generateSeatingPlan(
      rolls.map((r, i) => candidate(r, i)),
      30,
    );
    const orderedRolls = plan
      .sort((a, b) => a.seatNumber.localeCompare(b.seatNumber))
      .map((s) => s.rollNumber);
    expect(orderedRolls).toEqual(['R1', 'R2', 'R3', 'R10', 'R21']);
  });
});
