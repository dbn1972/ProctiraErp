import { describe, expect, it } from 'vitest';

import { classBand, slotTitle, subjectTone } from './subject-label';

describe('slot titles', () => {
  it('shortens prototype subject names and keeps the class band', () => {
    expect(slotTitle('Class 9-B Mathematics')).toBe('9-B Maths');
    expect(slotTitle('Class 9-B Computer Science')).toBe('9-B Comp. Sci');
    expect(slotTitle('Class 9-B Social Science')).toBe('9-B Social Sc.');
    expect(classBand('Class 9-A Mathematics')).toBe('9-A');
  });

  it('picks a stable colour per subject', () => {
    expect(subjectTone('Class 9-B Mathematics')).toBe('c1');
    expect(subjectTone('Class 9-B English')).toBe('c3');
    expect(subjectTone('Class 9-B Hindi')).toBe('c4');
  });
});
