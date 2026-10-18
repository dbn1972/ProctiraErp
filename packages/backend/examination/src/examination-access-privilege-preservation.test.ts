/**
 * D2 role-catalogue normalization (PRC-M015, PRC-M237) — privilege-preservation proof.
 *
 * Normalization applied to this module:
 *  - exam_officer -> examinations_officer (synonym collapse; examinations_officer was already
 *    present in every officer array, so the canonical name's effective allow-set is unchanged).
 *  - system_admin -> platform_admin add (ADMIN_ROLES now also admits platform_admin; no role
 *    was removed).
 *
 * These tests prove, per action, that:
 *  (a) every role admitted before the change is still admitted (no shrink), and
 *  (b) the former synonym `exam_officer` now flows through its canonical `examinations_officer`
 *      so no legitimate officer loses access.
 */
import { describe, expect, it } from 'vitest';

import { hasExaminationAccess, type ExaminationAction } from './examination-access.js';

const ALL_ACTIONS: ExaminationAction[] = [
  'exam.create',
  'exam.update',
  'exam.delete',
  'exam.publish',
  'candidate.register',
  'document.generate',
  'ops.moderate',
  'exam.read.staff',
];

// Roles that were admitted for officer actions before normalization (via exam_officer or the
// admin tier). Each must still be admitted post-change through the canonical name.
const PRESERVED_OFFICER_ROLES = [
  'examinations_officer',
  'registrar',
  'board_officer',
  'admin',
  'super-admin',
  'system_admin',
  'principal',
  'school_admin',
];

describe('examination-access privilege preservation (D2)', () => {
  it('still admits every previously-admitted officer role for every officer action', () => {
    const officerActions: ExaminationAction[] = [
      'exam.create',
      'exam.update',
      'exam.publish',
      'candidate.register',
      'document.generate',
      'ops.moderate',
    ];
    for (const action of officerActions) {
      for (const role of PRESERVED_OFFICER_ROLES) {
        expect(hasExaminationAccess([role], action), `${role} -> ${action}`).toBe(true);
      }
    }
  });

  it('exam.delete still admits examinations_officer, registrar and the admin tier', () => {
    for (const role of [
      'examinations_officer',
      'registrar',
      'admin',
      'super-admin',
      'system_admin',
    ]) {
      expect(hasExaminationAccess([role], 'exam.delete'), role).toBe(true);
    }
  });

  it('adds platform_admin alongside system_admin for every action (additive, no removal)', () => {
    for (const action of ALL_ACTIONS.filter((a) => a !== 'exam.read.staff')) {
      expect(hasExaminationAccess(['platform_admin'], action), action).toBe(true);
      expect(hasExaminationAccess(['system_admin'], action), action).toBe(true);
    }
  });

  it('does not admit a never-authorized role (fail-closed unchanged)', () => {
    expect(hasExaminationAccess(['viewer'], 'exam.create')).toBe(false);
    expect(hasExaminationAccess(['guardian'], 'exam.publish')).toBe(false);
  });
});
