/**
 * PRC-M054 — after a successful submit no registration draft (child +
 * guardian PII) stays in sessionStorage and a new application starts empty.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearRegistrationDrafts, hasApplicantData } from '@/lib/registration-draft';
import { RegistrationProvider, useRegistration } from './registration-context';

// Stable instance: a fresh object per render would re-run the hydrate effect forever.
const params = new URLSearchParams();
vi.mock('next/navigation', () => ({ useSearchParams: () => params }));

function draftKeys(): string[] {
  return Object.keys(window.sessionStorage).filter((k) => k.startsWith('registration-draft:'));
}

let api: ReturnType<typeof useRegistration> | null = null;
function Probe() {
  api = useRegistration();
  return <span data-testid="name">{api.draft.firstName}</span>;
}

afterEach(() => {
  window.sessionStorage.clear();
  api = null;
});

describe('PRC-M054 registration draft hygiene', () => {
  it('reset() after submit leaves no registration-draft:* key and an empty form', async () => {
    render(
      <RegistrationProvider institutionType="primary">
        <Probe />
      </RegistrationProvider>,
    );
    await act(async () => {
      api!.update({ firstName: 'Child', guardianPhone: '+910000000000' });
    });
    expect(draftKeys()).toEqual(['registration-draft:primary']);
    const keyBefore = api!.draft.submissionKey;
    await act(async () => {
      api!.reset();
    });
    expect(draftKeys()).toEqual([]);
    expect(screen.getByTestId('name').textContent).toBe('');
    expect(api!.draft.submissionKey).not.toBe(keyBefore);
  });

  it('a pristine draft is never persisted', async () => {
    render(
      <RegistrationProvider institutionType="secondary">
        <Probe />
      </RegistrationProvider>,
    );
    await act(async () => {});
    expect(draftKeys()).toEqual([]);
  });

  it('clearRegistrationDrafts removes every draft key only', () => {
    window.sessionStorage.setItem('registration-draft:a', '{}');
    window.sessionStorage.setItem('registration-draft:b', '{}');
    window.sessionStorage.setItem('other', 'x');
    clearRegistrationDrafts(window.sessionStorage);
    expect(draftKeys()).toEqual([]);
    expect(window.sessionStorage.getItem('other')).toBe('x');
  });

  it('hasApplicantData detects any typed PII', () => {
    const base = {
      institutionType: 'p',
      institutionId: '',
      formConfigurationId: '',
      formConfigurationVersion: null,
      submissionKey: 'k',
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      gender: '' as const,
      guardianName: '',
      guardianPhone: '',
      guardianEmail: '',
      customFields: {},
      documents: [],
    };
    expect(hasApplicantData(base)).toBe(false);
    expect(hasApplicantData({ ...base, guardianEmail: 'a@b.c' })).toBe(true);
  });
});
