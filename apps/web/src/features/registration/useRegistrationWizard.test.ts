/**
 * @vitest-environment jsdom
 *
 * useRegistrationWizard tests — Task 51.1 / Requirements 16.1, 16.2,
 * 16.7, 16.8, 38.8 / Design §F.
 *
 * Covers:
 *   • Step transitions (`personal-info → contact → school-selection
 *     → documents → review`) only proceed when the current step's
 *     Zod schema accepts the slice.
 *   • Backward navigation retains all previously entered step state
 *     (Requirement 16 AC 8 / Design §F).
 *   • Per-step Zod validation surfaces field-level errors via the
 *     `errors` array.
 *   • Autosave on mount: the wizard rehydrates from a persisted
 *     `registration-draft` (Requirement 38 AC 8) and resumes on the
 *     first incomplete step.
 *   • `reset()` wipes both in-memory state and the persisted draft.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { buildDraftKey } from '@/lib/draft/useDraftAutosave';

import {
  type ContactValues,
  type DocumentsValues,
  type PersonalInfoValues,
  type SchoolSelectionValues,
} from './schemas';
import {
  REGISTRATION_DRAFT_FORM_ID,
  WIZARD_STEPS,
  useRegistrationWizard,
} from './useRegistrationWizard';

// ─── Test fixtures ───────────────────────────────────────────────────────────

const validPersonalInfo: PersonalInfoValues = {
  firstName: 'Jordan',
  lastName: 'Lee',
  dateOfBirth: '2010-05-12',
  gender: 'female',
  nationalId: '',
  photoRef: '',
};

const validContact: ContactValues = {
  guardianFirstName: 'Sam',
  guardianLastName: 'Lee',
  guardianRelationship: 'parent',
  phone: '+1 555 123 4567',
  email: 'sam@example.com',
  addressLine1: '1 Main Street',
  addressLine2: '',
  city: 'Springfield',
  postalCode: '',
  country: 'India',
};

const validSchoolSelection: SchoolSelectionValues = {
  preferences: [
    { schoolId: 'sch-1', schoolName: 'Hilltop High', rank: 1 },
    { schoolId: 'sch-2', schoolName: 'Riverdale Academy', rank: 2 },
  ],
};

const validDocuments: DocumentsValues = {
  documents: [
    {
      type: 'birth_certificate',
      documentId: 'doc-1',
      fileName: 'birth.pdf',
      sizeBytes: 1234,
    },
  ],
};

beforeEach(() => {
  // Force a stable route so `buildDraftKey` is deterministic.
  window.history.replaceState(null, '', '/registration/form');
  window.localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  window.localStorage.clear();
});

// ─── Step ordering ───────────────────────────────────────────────────────────

describe('useRegistrationWizard — step ordering', () => {
  it('declares the five steps in the documented order', () => {
    expect(WIZARD_STEPS).toEqual([
      'personal-info',
      'contact',
      'school-selection',
      'documents',
      'review',
    ]);
  });

  it('starts on the first step for an empty draft', () => {
    const { result } = renderHook(() => useRegistrationWizard());
    expect(result.current.currentStep).toBe('personal-info');
    expect(result.current.currentStepIndex).toBe(0);
    expect(result.current.totalSteps).toBe(5);
  });
});

// ─── Validation gating ───────────────────────────────────────────────────────

describe('useRegistrationWizard — Zod validation gates advancement', () => {
  it('refuses to advance when the current step has no slice', () => {
    const { result } = renderHook(() => useRegistrationWizard());

    let advanced: boolean | undefined;
    act(() => {
      advanced = result.current.goNext();
    });
    expect(advanced).toBe(false);
    expect(result.current.currentStep).toBe('personal-info');
    expect(result.current.errors.length).toBeGreaterThan(0);
  });

  it('surfaces field-level errors when fields are missing', () => {
    const { result } = renderHook(() => useRegistrationWizard());

    act(() => {
      result.current.setPersonalInfo({
        ...validPersonalInfo,
        firstName: '',
        dateOfBirth: '',
      });
    });

    let advanced: boolean | undefined;
    act(() => {
      advanced = result.current.goNext();
    });
    expect(advanced).toBe(false);

    const paths = result.current.errors.map((e) => e.path);
    expect(paths).toContain('firstName');
    expect(paths).toContain('dateOfBirth');
    expect(result.current.currentStep).toBe('personal-info');
  });

  it('advances when the current step validates', () => {
    const { result } = renderHook(() => useRegistrationWizard());

    act(() => {
      result.current.setPersonalInfo(validPersonalInfo);
    });

    let advanced: boolean | undefined;
    act(() => {
      advanced = result.current.goNext();
    });

    expect(advanced).toBe(true);
    expect(result.current.currentStep).toBe('contact');
    expect(result.current.errors).toEqual([]);
  });

  it('rejects email with invalid format on the contact step', () => {
    const { result } = renderHook(() => useRegistrationWizard());

    act(() => {
      result.current.setPersonalInfo(validPersonalInfo);
    });
    act(() => {
      result.current.goNext();
    });
    act(() => {
      result.current.setContact({ ...validContact, email: 'not-an-email' });
    });

    let advanced: boolean | undefined;
    act(() => {
      advanced = result.current.goNext();
    });
    expect(advanced).toBe(false);
    const emailError = result.current.errors.find((e) => e.path === 'email');
    expect(emailError).toBeDefined();
    expect(result.current.currentStep).toBe('contact');
  });

  it('rejects duplicate ranks in school-selection', () => {
    const { result } = renderHook(() => useRegistrationWizard());

    act(() => {
      result.current.setPersonalInfo(validPersonalInfo);
      result.current.goNext();
    });
    act(() => {
      result.current.setContact(validContact);
      result.current.goNext();
    });
    act(() => {
      result.current.setSchoolSelection({
        preferences: [
          { schoolId: 'sch-1', schoolName: 'A', rank: 1 },
          { schoolId: 'sch-2', schoolName: 'B', rank: 1 },
        ],
      });
    });

    let advanced: boolean | undefined;
    act(() => {
      advanced = result.current.goNext();
    });
    expect(advanced).toBe(false);
    expect(
      result.current.errors.some((e) => e.path.endsWith('rank')),
    ).toBe(true);
  });

  it('rejects more than 3 ranked preferences (Requirement 16 AC 10)', () => {
    const { result } = renderHook(() => useRegistrationWizard());

    act(() => {
      result.current.setPersonalInfo(validPersonalInfo);
      result.current.goNext();
      result.current.setContact(validContact);
      result.current.goNext();
      result.current.setSchoolSelection({
        preferences: [
          { schoolId: 'sch-1', schoolName: 'A', rank: 1 },
          { schoolId: 'sch-2', schoolName: 'B', rank: 2 },
          { schoolId: 'sch-3', schoolName: 'C', rank: 3 },
          // 4th preference — Zod max(3) should reject.
          { schoolId: 'sch-4', schoolName: 'D', rank: 3 },
        ],
      });
    });

    let advanced: boolean | undefined;
    act(() => {
      advanced = result.current.goNext();
    });
    expect(advanced).toBe(false);
  });

  it('requires both consent boxes on review', () => {
    const { result } = renderHook(() => useRegistrationWizard());
    // Fast-forward through the prior steps.
    act(() => {
      result.current.setPersonalInfo(validPersonalInfo);
      result.current.goNext();
      result.current.setContact(validContact);
      result.current.goNext();
      result.current.setSchoolSelection(validSchoolSelection);
      result.current.goNext();
      result.current.setDocuments(validDocuments);
      result.current.goNext();
    });
    expect(result.current.currentStep).toBe('review');

    // Default review draft has both flags = false.
    act(() => {
      result.current.setReview({ confirmAccurate: false, acceptTerms: false });
    });

    const snapshot = result.current.getSubmitSnapshot();
    expect(snapshot.ok).toBe(false);
    if (!snapshot.ok) {
      expect(snapshot.failedStep).toBe('review');
    }

    // Approving both flips it to a clean snapshot.
    act(() => {
      result.current.setReview({ confirmAccurate: true, acceptTerms: true });
    });
    const snapshot2 = result.current.getSubmitSnapshot();
    expect(snapshot2.ok).toBe(true);
  });
});

// ─── Backward navigation ─────────────────────────────────────────────────────

describe('useRegistrationWizard — backward navigation retains step state', () => {
  it('preserves the personal-info slice when going back from contact', () => {
    const { result } = renderHook(() => useRegistrationWizard());

    act(() => {
      result.current.setPersonalInfo(validPersonalInfo);
      result.current.goNext();
    });
    expect(result.current.currentStep).toBe('contact');

    let backed: boolean | undefined;
    act(() => {
      backed = result.current.goBack();
    });
    expect(backed).toBe(true);
    expect(result.current.currentStep).toBe('personal-info');
    // The original slice is intact (Requirement 16 AC 8).
    expect(result.current.draft.personalInfo).toEqual(validPersonalInfo);
  });

  it('refuses to go back from the first step', () => {
    const { result } = renderHook(() => useRegistrationWizard());
    let backed: boolean | undefined;
    act(() => {
      backed = result.current.goBack();
    });
    expect(backed).toBe(false);
    expect(result.current.currentStep).toBe('personal-info');
  });

  it('clears the error display on goBack so the prior step starts clean', () => {
    const { result } = renderHook(() => useRegistrationWizard());
    act(() => {
      // Trigger an error on personal-info.
      result.current.goNext();
    });
    expect(result.current.errors.length).toBeGreaterThan(0);
    act(() => {
      // From the same step, fix it and advance.
      result.current.setPersonalInfo(validPersonalInfo);
      result.current.goNext();
    });
    expect(result.current.currentStep).toBe('contact');

    // Force errors on contact too.
    act(() => {
      result.current.goNext();
    });
    expect(result.current.errors.length).toBeGreaterThan(0);

    // goBack clears them.
    act(() => {
      result.current.goBack();
    });
    expect(result.current.errors).toEqual([]);
  });

  it('goTo only allows jumping to a previous step', () => {
    const { result } = renderHook(() => useRegistrationWizard());
    act(() => {
      result.current.setPersonalInfo(validPersonalInfo);
      result.current.goNext();
    });
    // Forward jump rejected.
    let jumped: boolean | undefined;
    act(() => {
      jumped = result.current.goTo('documents');
    });
    expect(jumped).toBe(false);
    expect(result.current.currentStep).toBe('contact');

    // Backward jump permitted.
    act(() => {
      jumped = result.current.goTo('personal-info');
    });
    expect(jumped).toBe(true);
    expect(result.current.currentStep).toBe('personal-info');
  });
});

// ─── Autosave integration ────────────────────────────────────────────────────

describe('useRegistrationWizard — autosave restore on mount', () => {
  it('rehydrates a persisted draft and resumes on the first incomplete step', () => {
    // Pre-seed localStorage with a draft that has steps 1–2 complete.
    const key = buildDraftKey(REGISTRATION_DRAFT_FORM_ID);
    const persisted = {
      v: 1,
      savedAt: new Date().toISOString(),
      values: {
        personalInfo: validPersonalInfo,
        contact: validContact,
      },
    };
    window.localStorage.setItem(key, JSON.stringify(persisted));

    const { result } = renderHook(() => useRegistrationWizard());

    // Wizard picks up the saved slices.
    expect(result.current.draft.personalInfo).toEqual(validPersonalInfo);
    expect(result.current.draft.contact).toEqual(validContact);
    // Resumes on the first incomplete step (school-selection).
    expect(result.current.currentStep).toBe('school-selection');
    expect(result.current.isHydrated).toBe(true);
  });

  it('starts fresh when no draft is persisted', () => {
    const { result } = renderHook(() => useRegistrationWizard());
    expect(result.current.draft).toEqual({});
    expect(result.current.currentStep).toBe('personal-info');
  });

  it('reset() wipes both the in-memory draft and the persisted slot', () => {
    const { result } = renderHook(() => useRegistrationWizard());
    act(() => {
      result.current.setPersonalInfo(validPersonalInfo);
      // Force a flush so localStorage has the entry.
      result.current.goNext();
    });
    const key = buildDraftKey(REGISTRATION_DRAFT_FORM_ID);
    expect(window.localStorage.getItem(key)).not.toBeNull();

    act(() => {
      result.current.reset();
    });
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(result.current.draft).toEqual({});
    expect(result.current.currentStep).toBe('personal-info');
  });

  it('honours an explicit initialDraft over the persisted draft', () => {
    const key = buildDraftKey(REGISTRATION_DRAFT_FORM_ID);
    window.localStorage.setItem(
      key,
      JSON.stringify({
        v: 1,
        savedAt: new Date().toISOString(),
        values: { personalInfo: validPersonalInfo },
      }),
    );

    const { result } = renderHook(() =>
      useRegistrationWizard({ initialDraft: { contact: validContact } }),
    );
    expect(result.current.draft).toEqual({ contact: validContact });
    // The contact step is filled; the wizard resumes on the first
    // incomplete step (personal-info, since it was overridden out).
    expect(result.current.currentStep).toBe('personal-info');
  });
});

// ─── Submit snapshot ─────────────────────────────────────────────────────────

describe('useRegistrationWizard — getSubmitSnapshot', () => {
  it('returns the validated bundle when every step passes', () => {
    const { result } = renderHook(() => useRegistrationWizard());
    act(() => {
      result.current.setPersonalInfo(validPersonalInfo);
      result.current.goNext();
      result.current.setContact(validContact);
      result.current.goNext();
      result.current.setSchoolSelection(validSchoolSelection);
      result.current.goNext();
      result.current.setDocuments(validDocuments);
      result.current.goNext();
      result.current.setReview({ confirmAccurate: true, acceptTerms: true });
    });

    const snapshot = result.current.getSubmitSnapshot();
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) {
      expect(snapshot.values.personalInfo).toEqual(validPersonalInfo);
      expect(snapshot.values.contact).toEqual(validContact);
      expect(snapshot.values.schoolSelection).toEqual(validSchoolSelection);
      expect(snapshot.values.documents).toEqual(validDocuments);
      expect(snapshot.values.review).toEqual({
        confirmAccurate: true,
        acceptTerms: true,
      });
    }
  });

  it('reports the first failing step when the bundle is incomplete', () => {
    const { result } = renderHook(() => useRegistrationWizard());
    act(() => {
      result.current.setPersonalInfo(validPersonalInfo);
      result.current.setSchoolSelection(validSchoolSelection);
      // contact + documents intentionally missing
    });

    const snapshot = result.current.getSubmitSnapshot();
    expect(snapshot.ok).toBe(false);
    if (!snapshot.ok) {
      expect(snapshot.failedStep).toBe('contact');
    }
  });
});
