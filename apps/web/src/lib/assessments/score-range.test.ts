import { describe, expect, it } from 'vitest';
import { itemScoreError } from './score-range';

const quiz = { name: 'Quiz 1', minScore: 0, maxScore: 20 };

describe('itemScoreError (PRC-L230)', () => {
  it('rejects 95 for an item whose max is 20, even though a 0–100 scheme would allow it', () => {
    expect(itemScoreError(quiz, '95')).toBe('Quiz 1: score 95 is outside the item range [0, 20]');
  });

  it('accepts boundary values of the item range', () => {
    expect(itemScoreError(quiz, '0')).toBeNull();
    expect(itemScoreError(quiz, '20')).toBeNull();
    expect(itemScoreError(quiz, '12.5')).toBeNull();
  });

  it('respects a non-zero item minimum', () => {
    expect(itemScoreError({ name: 'Lab', minScore: 5, maxScore: 10 }, '4')).toMatch(/outside/);
  });

  it('rejects non-numeric, blank and non-finite input', () => {
    for (const raw of ['abc', ' ', 'Infinity', '1e999']) {
      expect(itemScoreError(quiz, raw)).toMatch(/must be a number/);
    }
  });
});
