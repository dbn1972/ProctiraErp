/**
 * @vitest-environment jsdom
 *
 * PRC-M119 — student drafts are user+tenant scoped, TTL-bound, PII-free,
 * purged on logout, not applied when older than the record, and offered
 * (not silently applied) on return.
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAFT_DEFAULT_TTL_MS,
  buildDraftKey,
  purgeAllDrafts,
  useDraftAutosave,
} from '@/lib/draft/useDraftAutosave';
import type { StudentFormValues } from '@/lib/validation/student-schema';
import { isDraftStale, mergeDraftOverRecord, sanitizeStudentDraft } from './student-draft';

let authUser: { id: string; tenant_id: string } | null = { id: 'user-a', tenant_id: 'tenant-1' };
vi.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: authUser }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../actions', () => ({ createStudentAction: vi.fn(), updateStudentAction: vi.fn() }));

import { StudentForm } from './student-form';

const values: StudentFormValues = {
  firstName: 'Asha',
  lastName: 'Rao',
  dateOfBirth: '2014-02-01',
  gender: 'female',
  nationalId: 'ID-123',
  nationality: 'IN',
  contacts: [{ type: 'phone', value: '+91 90000 00000', isPrimary: true }],
  guardians: [
    {
      firstName: 'Ravi',
      lastName: 'Rao',
      relationship: 'father',
      contactPhone: '+91 90000 00001',
      contactEmail: 'guardian@example.com',
    },
  ],
  identityDocuments: [
    { type: 'passport', number: 'P1234567', issuingCountry: 'IN', expiryDate: '' },
  ],
  customData: {},
};

const A = { userId: 'user-a', tenantId: 'tenant-1' };
const B = { userId: 'user-b', tenantId: 'tenant-1' };

function seed(scope: typeof A, formId: string, savedAt: string, v: StudentFormValues = values) {
  window.localStorage.setItem(
    buildDraftKey(formId, scope),
    JSON.stringify({ v: 1, savedAt, values: v }),
  );
}

describe('student draft hardening (PRC-M119)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    authUser = { id: 'user-a', tenant_id: 'tenant-1' };
  });

  it('never persists identity numbers or contact details', () => {
    const { result } = renderHook(() =>
      useDraftAutosave<StudentFormValues>('student-create', undefined, {
        scope: A,
        requireScope: true,
        sanitize: sanitizeStudentDraft,
      }),
    );
    act(() => result.current.flush(values));
    const raw = window.localStorage.getItem(buildDraftKey('student-create', A)) ?? '';
    expect(raw).toContain('Asha');
    for (const secret of ['ID-123', 'P1234567', '+91 90000', 'guardian@example.com']) {
      expect(raw).not.toContain(secret);
    }
  });

  it('fails closed without a session scope', () => {
    const { result } = renderHook(() =>
      useDraftAutosave<StudentFormValues>('student-create', undefined, {
        scope: null,
        requireScope: true,
      }),
    );
    act(() => result.current.flush(values));
    expect(window.localStorage.length).toBe(0);
  });

  it('a draft saved by user A is not restored for user B', () => {
    seed(A, 'student-create', new Date().toISOString());
    const { result } = renderHook(() =>
      useDraftAutosave<StudentFormValues>('student-create', undefined, {
        scope: B,
        requireScope: true,
      }),
    );
    expect(result.current.values).toBeNull();
  });

  it('expired drafts are purged on read', () => {
    seed(A, 'student-create', new Date(Date.now() - DRAFT_DEFAULT_TTL_MS - 1000).toISOString());
    const { result } = renderHook(() =>
      useDraftAutosave<StudentFormValues>('student-create', undefined, { scope: A }),
    );
    expect(result.current.values).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it('after logout no draft keys remain', () => {
    seed(A, 'student-create', new Date().toISOString());
    window.localStorage.setItem('proctira-draft:/registration:registration-draft', '{}');
    window.localStorage.setItem('unrelated', '1');
    purgeAllDrafts();
    expect(Object.keys(window.localStorage)).toEqual(['unrelated']);
  });

  it('a draft older than the record updatedAt is not applied on edit', () => {
    expect(isDraftStale('2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z')).toBe(true);
    expect(isDraftStale('2025-01-03T00:00:00Z', '2025-01-02T00:00:00Z')).toBe(false);
    const savedAt = new Date(Date.now() - 60_000).toISOString();
    seed(A, 'student-edit-s1', savedAt, { ...values, firstName: 'Old' });
    render(
      <StudentForm
        mode="edit"
        studentId="s1"
        initialValues={values}
        customFields={[]}
        recordUpdatedAt={new Date().toISOString()}
      />,
    );
    expect(screen.queryByTestId('student-draft-offer')).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it('a newer draft is offered and only applied on Restore (sensitive fields kept)', () => {
    seed(
      A,
      'student-edit-s1',
      new Date().toISOString(),
      sanitizeStudentDraft({
        ...values,
        firstName: 'Draft',
      }),
    );
    render(
      <StudentForm
        mode="edit"
        studentId="s1"
        initialValues={values}
        customFields={[]}
        recordUpdatedAt={new Date(Date.now() - 60_000).toISOString()}
      />,
    );
    const first = document.querySelector('input[name="firstName"]') as HTMLInputElement;
    expect(first.value).toBe('Asha');
    fireEvent.click(screen.getByRole('button', { name: 'Restore draft' }));
    expect(first.value).toBe('Draft');
    expect(mergeDraftOverRecord(values, sanitizeStudentDraft(values)).nationalId).toBe('ID-123');
  });
});
