/**
 * Unit tests for audience estimator.
 */
import { describe, expect, it } from 'vitest';

import { estimateAudience } from './audience.js';

describe('estimateAudience', () => {
  it('defaults to all-tenant base', () => {
    expect(estimateAudience({}).estimatedRecipients).toBe(500);
    expect(estimateAudience({ scope: 'all' }).scope).toBe('all');
  });

  it('scales grade and hostel scopes', () => {
    expect(estimateAudience({ scope: 'grade', grade: '10' }).estimatedRecipients).toBe(100);
    expect(estimateAudience({ scope: 'hostel' }).estimatedRecipients).toBe(75);
  });

  it('prefers live hostel counts when provided', () => {
    const result = estimateAudience({ scope: 'hostel' }, { hostelActiveAssignments: 12 });
    expect(result.estimatedRecipients).toBe(12);
    expect(result.source).toBe('live');
  });
});
