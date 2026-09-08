import { describe, expect, it } from 'vitest';

import {
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

  it('allows draft → submit → approve → lock', () => {
    let s = transitionGradeWorkflow('DRAFT', 'submit');
    expect(s).toBe('SUBMITTED');
    s = transitionGradeWorkflow(s, 'approve');
    expect(s).toBe('APPROVED');
    s = transitionGradeWorkflow(s, 'lock');
    expect(s).toBe('LOCKED');
  });

  it('allows reject then re-submit', () => {
    expect(transitionGradeWorkflow('SUBMITTED', 'reject')).toBe('REJECTED');
    expect(transitionGradeWorkflow('REJECTED', 'submit')).toBe('SUBMITTED');
  });

  it('rejects illegal transitions', () => {
    expect(() => transitionGradeWorkflow('DRAFT', 'approve')).toThrow(/Cannot approve/);
    expect(() => transitionGradeWorkflow('SUBMITTED', 'lock')).toThrow(/Cannot lock/);
  });

  it('narrows action strings', () => {
    expect(isGradeWorkflowAction('submit')).toBe(true);
    expect(isGradeWorkflowAction('explode')).toBe(false);
  });
});
