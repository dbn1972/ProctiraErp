import { describe, expect, it } from 'vitest';

import { isParentVisibleGrade } from './academic-visibility.js';

describe('isParentVisibleGrade', () => {
  it('shows only published grades', () => {
    expect(isParentVisibleGrade({ workflowStatus: 'PUBLISHED', publishedAt: null })).toBe(true);
    expect(
      isParentVisibleGrade({ workflowStatus: 'LOCKED', publishedAt: '2026-09-22T00:00:00Z' }),
    ).toBe(true);
    expect(isParentVisibleGrade({ workflowStatus: 'LOCKED', publishedAt: null })).toBe(false);
    expect(isParentVisibleGrade({ workflowStatus: 'APPROVED', publishedAt: null })).toBe(false);
    expect(isParentVisibleGrade({ workflowStatus: 'DRAFT', publishedAt: null })).toBe(false);
    expect(isParentVisibleGrade({ workflowStatus: 'SUBMITTED', publishedAt: null })).toBe(false);
  });
});
