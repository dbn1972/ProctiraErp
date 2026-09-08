/**
 * apps/web/src/features/registration/useRegistrationWizard.ts —
 * Multi-step wizard state machine (Task 51.1, Requirements 16.1, 16.2,
 * 16.7, 16.8, 38.8, Design §F)
 * =====================================================================
 *
 * The public registration wizard is a finite state machine over five
 * steps:
 *
 *   personal-info → contact → school-selection → documents → review
 *
 * Design §F summarises the contract this hook implements:
 *
 *   • "Each step has its own Zod schema; submitting a step runs the
 *     schema and refuses to advance on any error. The error summary
 *     at the top of the step lists field-level errors for screen
 *     readers."
 *   • "Back navigation preserves answers. When the user clicks Back,
 *     the previous step rehydrates from the draft store. Step state
 *     lives in a single `RegistrationDraft` object held in a
 *     wizard-scoped React context, with autosave to `localStorage`
 *     on every change."
 *
 * Public surface:
 *
 *   const w = useRegistrationWizard();
 *   w.currentStep         // 'personal-info' | … | 'review'
 *   w.currentStepIndex    // 0..4
 *   w.totalSteps          // 5
 *   w.draft               // current RegistrationDraft snapshot
 *   w.errors              // FieldError[] for the current step (after validate)
 *   w.canGoNext           // true iff at least one validate call has succeeded
 *                         //   for the current step (UI disables the button
 *                         //   between edits to avoid stale enables)
 *   w.canGoBack           // false on the first step
 *
 *   // Step state setters — pass the full step shape; validation runs lazily
 *   // on `goNext()` so the user can type freely without flicker.
 *   w.setPersonalInfo(values)
 *   w.setContact(values)
 *   w.setSchoolSelection(values)
 *   w.setDocuments(values)
 *   w.setReview(values)
 *
 *   // Navigation primitives. `goNext()` returns `false` and exposes
 *   // `errors` if the step's Zod schema rejects the current slice.
 *   w.goNext(): boolean
 *   w.goBack(): boolean
 *   w.goTo(step): boolean   // only allowed when the step is at or before currentStep
 *   w.reset(): void          // wipes the draft + clears autosave
 *
 *   // Diagnostic — lets pages run validation without advancing.
 *   w.validate(): { ok: true } | { ok: false; errors: FieldError[] }
 *
 * Persistence. The hook wires `useDraftAutosave('registration-draft',
 * 30_000)` so partially completed applications survive browser
 * close. On mount, if a saved draft exists we hydrate the wizard
 * with it and resume on the most-advanced incomplete step.
 *
 * The hook is intentionally headless — it does not render UI. The
 * `<RegistrationWizard>` component composes this hook with the
 * step-specific forms.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ZodTypeAny } from 'zod';

import { useDraftAutosave } from '@/lib/draft/useDraftAutosave';

import {
  DEFAULT_CONTACT,
  DEFAULT_DOCUMENTS,
  DEFAULT_PERSONAL_INFO,
  DEFAULT_REVIEW,
  DEFAULT_SCHOOL_SELECTION,
  contactSchema,
  documentsSchema,
  personalInfoSchema,
  reviewSchema,
  schoolSelectionSchema,
  type ContactValues,
  type DocumentsValues,
  type PersonalInfoValues,
  type RegistrationDraft,
  type ReviewDraft,
  type SchoolSelectionValues,
} from './schemas';

// ─── Step model ──────────────────────────────────────────────────────────────

/** The ordered list of wizard steps. The order is the state machine. */
export const WIZARD_STEPS = [
  'personal-info',
  'contact',
  'school-selection',
  'documents',
  'review',
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Total number of steps. Exposed so `<WizardProgress>` (task 51.2) can label "Step n of N". */
export const WIZARD_TOTAL_STEPS = WIZARD_STEPS.length;

// ─── Field-level errors ──────────────────────────────────────────────────────

/**
 * Field-level error reported by `validate()` / `goNext()`. The path
 * mirrors Zod's issue path so consumers can map errors to fields.
 */
export interface FieldError {
  /** Dotted field path, e.g. `"firstName"` or `"preferences.0.rank"`. */
  path: string;
  /** Localized message from the step's Zod schema. */
  message: string;
}

/** Result of `validate()`. */
export type ValidateResult = { ok: true } | { ok: false; errors: FieldError[] };

// ─── Persistence key ─────────────────────────────────────────────────────────

/** The autosave slot used by the wizard. */
export const REGISTRATION_DRAFT_FORM_ID = 'registration-draft';

/** Autosave debounce (Requirement 38 AC 8 ceiling). */
export const REGISTRATION_DRAFT_INTERVAL_MS = 30_000;

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Map a wizard step to its Zod schema and the slice of `RegistrationDraft`
 * that should be validated against it.
 */
function getStepSchema(step: WizardStep): ZodTypeAny {
  switch (step) {
    case 'personal-info':
      return personalInfoSchema;
    case 'contact':
      return contactSchema;
    case 'school-selection':
      return schoolSelectionSchema;
    case 'documents':
      return documentsSchema;
    case 'review':
      return reviewSchema;
  }
}

function getStepSlice(step: WizardStep, draft: RegistrationDraft): unknown {
  switch (step) {
    case 'personal-info':
      return draft.personalInfo;
    case 'contact':
      return draft.contact;
    case 'school-selection':
      return draft.schoolSelection;
    case 'documents':
      return draft.documents;
    case 'review':
      return draft.review;
  }
}

/** Convert a Zod issue path (an array of strings/numbers) to a dotted string. */
function pathToString(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((segment) => (typeof segment === 'number' ? String(segment) : String(segment)))
    .join('.');
}

/**
 * Run a step schema and normalise the result. We treat `undefined`
 * slices as "not yet filled" and return a single high-level error so
 * the UI can flag the step instead of crashing on `parse(undefined)`.
 */
function runStepValidation(step: WizardStep, draft: RegistrationDraft): ValidateResult {
  const slice = getStepSlice(step, draft);
  if (slice === undefined) {
    return {
      ok: false,
      errors: [{ path: '', message: 'Please complete this step before continuing' }],
    };
  }
  const schema = getStepSchema(step);
  const result = schema.safeParse(slice);
  if (result.success) return { ok: true };
  const errors = result.error.issues.map((issue) => ({
    path: pathToString(issue.path),
    message: issue.message,
  }));
  return { ok: false, errors };
}

/**
 * Pick the resume step from a hydrated draft: the first step that
 * fails its schema, falling back to `review` when every prior step
 * passes (so the user lands on the submit screen).
 */
function pickResumeStep(draft: RegistrationDraft): WizardStep {
  for (const step of WIZARD_STEPS) {
    const r = runStepValidation(step, draft);
    if (!r.ok) return step;
  }
  return 'review';
}

// ─── Public hook ─────────────────────────────────────────────────────────────

/** Optional initial state — useful for tests and for a future "edit application" flow. */
export interface UseRegistrationWizardOptions {
  /**
   * Seed the wizard with a draft (e.g. from a saved server-side
   * application). Overrides any value rehydrated from `localStorage`.
   */
  initialDraft?: RegistrationDraft;
  /**
   * Force a starting step. Defaults to `'personal-info'` for empty
   * drafts, and to the first incomplete step when a draft is present.
   */
  initialStep?: WizardStep;
}

export interface RegistrationWizard {
  // Step model
  currentStep: WizardStep;
  currentStepIndex: number;
  totalSteps: number;
  steps: typeof WIZARD_STEPS;

  // Draft state
  draft: RegistrationDraft;
  errors: FieldError[];

  // Setters
  setPersonalInfo: (values: PersonalInfoValues) => void;
  setContact: (values: ContactValues) => void;
  setSchoolSelection: (values: SchoolSelectionValues) => void;
  setDocuments: (values: DocumentsValues) => void;
  setReview: (values: ReviewDraft) => void;

  // Navigation
  goNext: () => boolean;
  goBack: () => boolean;
  goTo: (step: WizardStep) => boolean;
  reset: () => void;
  validate: () => ValidateResult;

  // Submission helpers
  /** Snapshot used by the review screen and the submit endpoint. */
  getSubmitSnapshot: () =>
    | { ok: true; values: Required<RegistrationDraft> }
    | { ok: false; errors: FieldError[]; failedStep: WizardStep };
  /** Clear the autosave slot — call after a successful submit. */
  clearDraft: () => void;
  /** True when the persisted draft has been read on mount. */
  isHydrated: boolean;
  /** ISO timestamp of the last persisted draft, when present. */
  draftSavedAt: string | null;
}

/**
 * The headless registration wizard. See module docs for the full
 * contract.
 */
export function useRegistrationWizard(
  options: UseRegistrationWizardOptions = {},
): RegistrationWizard {
  const autosave = useDraftAutosave<RegistrationDraft>(
    REGISTRATION_DRAFT_FORM_ID,
    REGISTRATION_DRAFT_INTERVAL_MS,
  );

  // Decide the initial draft on first render. Priority:
  //   1. options.initialDraft (explicit caller seed)
  //   2. autosave.values       (rehydrated from localStorage)
  //   3. {}                    (fresh wizard)
  const initialDraft = useMemo<RegistrationDraft>(
    () => options.initialDraft ?? autosave.values ?? {},
    // Intentionally evaluated once — we cannot allow autosave updates
    // to clobber the user's in-memory edits. Subsequent rehydration
    // requests go through `restore()` (out of scope here).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [draft, setDraft] = useState<RegistrationDraft>(initialDraft);
  // Mirror the latest draft in a ref so navigation callbacks see
  // edits made earlier in the same React tick. Without this,
  // sequential `setSlice() → goNext()` calls inside one `act()`
  // would close over the previous render's draft.
  const draftRef = useRef<RegistrationDraft>(initialDraft);

  const [currentStep, setCurrentStep] = useState<WizardStep>(
    () => options.initialStep ?? pickResumeStep(initialDraft),
  );
  const currentStepRef = useRef<WizardStep>(currentStep);

  const [errors, setErrors] = useState<FieldError[]>([]);

  // Keep refs in sync after every render. The refs are read by
  // `goNext` / `validate` / `getSubmitSnapshot`, never written to
  // directly outside of a state-setter wrapper.
  draftRef.current = draft;
  currentStepRef.current = currentStep;

  // Track whether the autosave layer has reported its initial read.
  // The hook's `useState` initializer runs synchronously with `null`
  // in SSR / first render; the hook then re-reads in an effect. We
  // expose this so a parent component can render a "Loading…"
  // placeholder during the brief window before hydration completes.
  const [isHydrated, setIsHydrated] = useState<boolean>(
    () => options.initialDraft !== undefined || autosave.values !== null,
  );
  const hydratedOnceRef = useRef<boolean>(isHydrated);

  // If the autosave layer reports a draft after first mount (the
  // common case in the browser), absorb it — but only once, so we
  // never clobber edits the user has made since. The wizard is the
  // source of truth from this point onward; future writes flow
  // through the `useEffect` below.
  useEffect(() => {
    if (hydratedOnceRef.current) return;
    if (options.initialDraft !== undefined) {
      hydratedOnceRef.current = true;
      setIsHydrated(true);
      return;
    }
    if (autosave.values !== null) {
      const seeded = autosave.values;
      setDraft(seeded);
      setCurrentStep(options.initialStep ?? pickResumeStep(seeded));
      hydratedOnceRef.current = true;
      setIsHydrated(true);
    } else {
      // No persisted draft — mark hydrated so the UI can render the empty form.
      hydratedOnceRef.current = true;
      setIsHydrated(true);
    }
  }, [autosave.values, options.initialDraft, options.initialStep]);

  // Auto-save on every draft change. The hook itself debounces to
  // 30 s, so frequent React renders are cheap. We skip the very
  // first effect run because the `initialDraft` came from storage —
  // re-saving it would be a no-op churn.
  const isFirstSaveRef = useRef<boolean>(true);
  useEffect(() => {
    if (isFirstSaveRef.current) {
      isFirstSaveRef.current = false;
      return;
    }
    autosave.save(draft);
  }, [draft, autosave]);

  // ─── Setters ────────────────────────────────────────────────────────────────

  const updateSlice = useCallback(
    <K extends keyof RegistrationDraft>(key: K, values: RegistrationDraft[K]) => {
      // Update the ref synchronously so subsequent `goNext` calls in
      // the same React tick observe the new slice. The ref + state
      // pair is the standard "latest" pattern.
      draftRef.current = { ...draftRef.current, [key]: values };
      setDraft(draftRef.current);
      // Clear any prior error display the moment the user edits the
      // step. The next `goNext()` re-runs validation.
      setErrors([]);
    },
    [],
  );

  const setPersonalInfo = useCallback(
    (values: PersonalInfoValues) => updateSlice('personalInfo', values),
    [updateSlice],
  );
  const setContact = useCallback(
    (values: ContactValues) => updateSlice('contact', values),
    [updateSlice],
  );
  const setSchoolSelection = useCallback(
    (values: SchoolSelectionValues) => updateSlice('schoolSelection', values),
    [updateSlice],
  );
  const setDocuments = useCallback(
    (values: DocumentsValues) => updateSlice('documents', values),
    [updateSlice],
  );
  const setReview = useCallback(
    (values: ReviewDraft) => updateSlice('review', values),
    [updateSlice],
  );

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const validate = useCallback((): ValidateResult => {
    const result = runStepValidation(currentStepRef.current, draftRef.current);
    setErrors(result.ok ? [] : result.errors);
    return result;
  }, []);

  const goNext = useCallback((): boolean => {
    const step = currentStepRef.current;
    const result = runStepValidation(step, draftRef.current);
    if (!result.ok) {
      setErrors(result.errors);
      return false;
    }
    setErrors([]);
    const idx = WIZARD_STEPS.indexOf(step);
    // The `review` step is terminal — `goNext` from review is a
    // submit gesture handled by the page, not a step transition.
    if (idx < WIZARD_STEPS.length - 1) {
      const next = WIZARD_STEPS[idx + 1]!;
      currentStepRef.current = next;
      setCurrentStep(next);
      // Flush autosave on step transitions so a refresh between
      // steps lands the user on the new step rather than the prior.
      autosave.flush(draftRef.current);
    }
    return true;
  }, [autosave]);

  const goBack = useCallback((): boolean => {
    const step = currentStepRef.current;
    const idx = WIZARD_STEPS.indexOf(step);
    if (idx <= 0) return false;
    setErrors([]);
    const prev = WIZARD_STEPS[idx - 1]!;
    currentStepRef.current = prev;
    setCurrentStep(prev);
    return true;
  }, []);

  const goTo = useCallback((step: WizardStep): boolean => {
    const target = WIZARD_STEPS.indexOf(step);
    const cur = WIZARD_STEPS.indexOf(currentStepRef.current);
    // Only allow jumps to a step at or before the current step.
    // Forward jumps would skip validation gates.
    if (target === -1 || target > cur) return false;
    setErrors([]);
    currentStepRef.current = step;
    setCurrentStep(step);
    return true;
  }, []);

  const reset = useCallback((): void => {
    draftRef.current = {};
    currentStepRef.current = WIZARD_STEPS[0];
    setDraft({});
    setCurrentStep(WIZARD_STEPS[0]);
    setErrors([]);
    autosave.clear();
    isFirstSaveRef.current = true;
  }, [autosave]);

  // ─── Submission helper ──────────────────────────────────────────────────────

  const getSubmitSnapshot = useCallback((): ReturnType<RegistrationWizard['getSubmitSnapshot']> => {
    const snap = draftRef.current;
    // Validate every step in order; the first failure becomes the
    // page-level error report so we can navigate the user back to it.
    for (const step of WIZARD_STEPS) {
      const r = runStepValidation(step, snap);
      if (!r.ok) return { ok: false, errors: r.errors, failedStep: step };
    }
    return {
      ok: true,
      values: {
        personalInfo: snap.personalInfo!,
        contact: snap.contact!,
        schoolSelection: snap.schoolSelection!,
        documents: snap.documents!,
        review: snap.review!,
      },
    };
  }, []);

  const clearDraft = useCallback((): void => {
    autosave.clear();
  }, [autosave]);

  const currentStepIndex = WIZARD_STEPS.indexOf(currentStep);

  return {
    currentStep,
    currentStepIndex,
    totalSteps: WIZARD_TOTAL_STEPS,
    steps: WIZARD_STEPS,

    draft,
    errors,

    setPersonalInfo,
    setContact,
    setSchoolSelection,
    setDocuments,
    setReview,

    goNext,
    goBack,
    goTo,
    reset,
    validate,

    getSubmitSnapshot,
    clearDraft,
    isHydrated,
    draftSavedAt: autosave.savedAt,
  };
}

// ─── Test seam ───────────────────────────────────────────────────────────────

/**
 * Pure helpers exported for unit tests so the state-machine logic
 * can be exercised without rendering React components.
 */
export const _internals = {
  pickResumeStep,
  runStepValidation,
  getStepSchema,
  pathToString,
  // Default slices so tests can build a complete draft without
  // re-deriving the shapes.
  DEFAULT_PERSONAL_INFO,
  DEFAULT_CONTACT,
  DEFAULT_SCHOOL_SELECTION,
  DEFAULT_DOCUMENTS,
  DEFAULT_REVIEW,
};
