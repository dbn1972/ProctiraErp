import { describe, expect, it } from 'vitest';

import {
  isGradePublished,
  isGradeWorkflowAction,
  readGradeWorkflowStatus,
  transitionGradeWorkflow,
} from './grade-workflow.js';

describe('grade workflow state machine', () => {
  it('reads DRAFT by default and LOCKED when lockedAt set', () => {
    expect(readGradeWorkflowStatus({})).toBe('DRAFT');
    expect(readGradeWorkflowStatus({ workflowStatus: 'SUBMITTED' })).toBe('SUBMITTED');
    expect(readGradeWorkflowStatus({ workflowStatus: 'APPROVED' }, '2026-01-01T00:00:00Z')).toBe(
      'LOCKED',
    );
  });

  it('reads PUBLISHED when publishedAt is set', () => {
    expect(
      readGradeWorkflowStatus({ workflowStatus: 'LOCKED' }, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
    ).toBe('PUBLISHED');
    expect(isGradePublished({ published: true })).toBe(true);
    expect(isGradePublished({ workflowStatus: 'DRAFT' })).toBe(false);
  });

  it('allows draft → submit → approve → lock → publish', () => {
    let s = transitionGradeWorkflow('DRAFT', 'submit');
    expect(s).toBe('SUBMITTED');
    s = transitionGradeWorkflow(s, 'approve');
    expect(s).toBe('APPROVED');
    s = transitionGradeWorkflow(s, 'lock');
    expect(s).toBe('LOCKED');
    s = transitionGradeWorkflow(s, 'publish');
    expect(s).toBe('PUBLISHED');
  });

  it('allows reject then re-submit', () => {
    expect(transitionGradeWorkflow('SUBMITTED', 'reject')).toBe('REJECTED');
    expect(transitionGradeWorkflow('REJECTED', 'submit')).toBe('SUBMITTED');
  });

  it('rejects illegal transitions', () => {
    expect(() => transitionGradeWorkflow('DRAFT', 'approve')).toThrow(/Cannot approve/);
    expect(() => transitionGradeWorkflow('SUBMITTED', 'lock')).toThrow(/Cannot lock/);
    expect(() => transitionGradeWorkflow('APPROVED', 'publish')).toThrow(/Cannot publish/);
  });

  it('narrows action strings', () => {
    expect(isGradeWorkflowAction('submit')).toBe(true);
    expect(isGradeWorkflowAction('publish')).toBe(true);
    expect(isGradeWorkflowAction('explode')).toBe(false);
  });
});
