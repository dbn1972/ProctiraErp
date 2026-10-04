/** PRC-H023 — blank options must not shift the quiz answer key. */
import { describe, expect, it } from 'vitest';
import { compactQuizOptions } from './new-assignment-form';

describe('compactQuizOptions (PRC-H023)', () => {
  it("remaps ['', 'B', 'C'] with 'B' marked to options ['B','C'] index 0", () => {
    expect(compactQuizOptions(['', 'B', 'C'], 1)).toEqual({
      options: ['B', 'C'],
      correctOptionIndex: 0,
    });
  });
  it("keeps 'Rome' as the key for ['', 'Paris', 'Rome'] marked index 2", () => {
    const out = compactQuizOptions(['', 'Paris', 'Rome'], 2);
    expect(out.options[out.correctOptionIndex]).toBe('Rome');
  });
  it('handles blanks between options and trims whitespace', () => {
    const out = compactQuizOptions(['A', '  ', 'C', '', ' D '], 4);
    expect(out).toEqual({ options: ['A', 'C', 'D'], correctOptionIndex: 2 });
  });
  it('returns -1 when the marked option is blank', () => {
    expect(compactQuizOptions(['A', '', 'C'], 1).correctOptionIndex).toBe(-1);
  });
  it('every marked non-blank option survives compaction as the key', () => {
    const opts = ['', 'x', ' ', 'y', 'z', ''];
    opts.forEach((o, i) => {
      if (!o.trim()) return;
      const out = compactQuizOptions(opts, i);
      expect(out.options[out.correctOptionIndex]).toBe(o.trim());
    });
  });
});
