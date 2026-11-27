import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bandForAverage,
  bandForPercent,
  buildThresholds,
  roundHalfUp,
  scaleArb,
  schemeValid,
  weightedAverage,
  WORKFLOW,
} from './grades-model.js';

const PF = [
  { grade: 'F', minScore: 0, maxScore: 49 },
  { grade: 'P', minScore: 50, maxScore: 100 },
];

describe('grades oracle', () => {
  it('scheme validity: contiguous cover only', () => {
    expect(schemeValid(0, 100, PF).ok).toBe(true);
    expect(schemeValid(0, 100, [{ grade: 'A', minScore: 0, maxScore: 100 }]).ok).toBe(true);
    expect(schemeValid(0, 100, [PF[0]!, { grade: 'P', minScore: 49, maxScore: 100 }]).why).toMatch(
      /overlap/,
    );
    expect(schemeValid(0, 100, [PF[0]!, { grade: 'P', minScore: 51, maxScore: 100 }]).why).toMatch(
      /gap/,
    );
    expect(schemeValid(0, 100, [PF[0]!, { grade: 'P', minScore: 50, maxScore: 97 }]).why).toMatch(
      /end at max/,
    );
    expect(schemeValid(0, 100, [{ grade: 'F', minScore: 3, maxScore: 49 }, PF[1]!]).why).toMatch(
      /start at min/,
    );
    expect(schemeValid(0, 100, [PF[0]!, { grade: 'P', minScore: 50, maxScore: 105 }]).why).toMatch(
      /outside/,
    );
    expect(schemeValid(10, 10, PF).ok).toBe(false);
  });

  it('generated schemes: unperturbed are valid, perturbed are not', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(100, 10, 4, 50),
        fc.array(fc.double({ min: 0.05, max: 0.95, noNaN: true }), { minLength: 1, maxLength: 6 }),
        fc.constantFrom<0.01 | 1>(0.01, 1),
        (max, cuts, step) => schemeValid(0, max, buildThresholds(max, cuts, step, 'none')).ok,
      ),
    );
    for (const p of ['overlap', 'short-top', 'outside', 'inverted'] as const) {
      expect(schemeValid(0, 100, buildThresholds(100, [0.5], 1, p)).ok).toBe(false);
    }
  });

  it('half-open band for a subject average', () => {
    expect(bandForAverage(49.5, PF)).toBe('F');
    expect(bandForAverage(50, PF)).toBe('P');
    expect(bandForAverage(100.01, PF)).toBe('Ungraded');
    expect(bandForAverage(-1, PF)).toBe('Ungraded');
  });

  it('weighted average pro-rates entered weight and scales to the scheme', () => {
    const items = [
      { id: 'a', weight: 40, minScore: 0, maxScore: 50 },
      { id: 'b', weight: 60, minScore: 0, maxScore: 100 },
    ];
    expect(weightedAverage(items, new Map([['a', 47.5]]), 0, 100)).toEqual({
      average: 95,
      complete: false,
    });
    expect(
      weightedAverage(
        items,
        new Map([
          ['a', 25],
          ['b', 80],
        ]),
        0,
        10,
      ),
    ).toEqual({ average: 6.8, complete: true });
    expect(weightedAverage(items, new Map(), 0, 100).average).toBe(0);
  });

  it('gradebook scale: generated scales are contiguous and every 2-dp score has one band', () => {
    fc.assert(
      fc.property(scaleArb, fc.integer({ min: 0, max: 10_000 }), (bands, n) => {
        const score = n / 100;
        const hits = bands.filter((b) => score >= b.min && score <= b.max);
        return hits.length === 1 && bandForPercent(score, bands) === hits[0];
      }),
    );
  });

  it('workflow table and rounding', () => {
    expect(WORKFLOW.publish.from).toEqual(['LOCKED', 'PUBLISHED']);
    expect(WORKFLOW.submit.to).toBe('SUBMITTED');
    expect(roundHalfUp(2.0005, 3)).toBe(2.001);
    expect(roundHalfUp(7 / 3, 3)).toBe(2.333);
  });
});
