import { describe, expect, it } from 'vitest';

import { utilizationLabel, utilizationWidth } from './utilization';

describe('utilizationLabel', () => {
  it('caps the bar and names over-capacity instead of a raw percent', () => {
    expect(utilizationLabel(3093)).toBe('Over capacity');
    expect(utilizationWidth(3093)).toBe(100);
    expect(utilizationLabel(94)).toBe('94%');
    expect(utilizationWidth(94)).toBe(94);
  });
});
