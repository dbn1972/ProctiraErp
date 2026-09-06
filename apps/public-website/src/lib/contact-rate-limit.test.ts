import { describe, expect, it, beforeEach } from 'vitest';

import { allowContactRequest, resetContactRateLimitForTests } from './contact-rate-limit';

describe('allowContactRequest', () => {
  beforeEach(() => {
    resetContactRateLimitForTests();
  });

  it('allows the first requests in a window', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(allowContactRequest('10.0.0.1', 1_000)).toBe(true);
    }
  });

  it('blocks after the window budget is exhausted', () => {
    for (let i = 0; i < 5; i += 1) {
      allowContactRequest('10.0.0.2', 1_000);
    }
    expect(allowContactRequest('10.0.0.2', 1_000)).toBe(false);
  });

  it('resets after the window elapses', () => {
    for (let i = 0; i < 5; i += 1) {
      allowContactRequest('10.0.0.3', 1_000);
    }
    expect(allowContactRequest('10.0.0.3', 1_000 + 60_001)).toBe(true);
  });
});
