/**
 * apps/web/src/features/registration/RegistrationWizard.tsx —
 * Multi-step wizard composition (Task 51.1, Requirements 16.1, 16.2,
 * 16.7, 16.8, 38.8, Design §F)
 * =====================================================================
 *
 * Composes the headless `useRegistrationWizard` state machine with
 * the per-step form panes. Each step is a small form that updates
 * the wizard slice on change; the wizard itself owns navigation
 * gating and Zod validation.
 *
 * The visual `<WizardProgress>` indicator with screen-reader
 * announcements (task 51.2) is composed at the top of the
 * `<RegistrationWizard>` container. It is a controlled view layered
 * on top of the same `useRegistrationWizard` state, so swapping it
 * does not touch the state machine.
 *
 * Step UIs are deliberately lightweight: native HTML inputs styled
 * with the existing token classes. Task 51.3 swaps the
 * school-selection block for the real `<SchoolFinder>` +
 * `<RankedPreference>` field; until then, applicants can paste
 * institution ids manually so end-to-end tests still exercise the
 * state machine.
 */

import { useCallback, useId, useMemo, useState } from 'react';

import {
  DEFAULT_CONTACT,
  DEFAULT_DOCUMENTS,
  DEFAULT_PERSONAL_INFO,
  DEFAULT_REVIEW,
  DEFAULT_SCHOOL_SELECTION,
  type ContactValues,
  type DocumentRef,
  type DocumentsValues,
  type PersonalInfoValues,
  type ReviewDraft,
  type SchoolPreference,
  type SchoolSelectionValues,
} from './schemas';
import {
  RankedPreference,
  MAX_RANKED_PREFERENCES,
} from './components/RankedPreference';
import {
  SchoolFinder,
  type SchoolFinderOption,
} from './components/SchoolFinder';
import { WizardProgress } from './components/WizardProgress';
import type { SchoolFinderResult } from '@/lib/api/registration';
import {
  WIZARD_STEPS,
  useRegistrationWizard,
  type FieldError,
  type RegistrationWizard as Wizard,
  type WizardStep,
} from './useRegistrationWizard';

// ─── Step labels ─────────────────────────────────────────────────────────────

/**
 * Localized step labels are out of scope for the state-machine task;
 * the marketing/i18n catalogues will source these via `useLanguage().t()`
 * once the registration translation keys land. We ship plain English
 * fallbacks so the wizard renders today.
 */
const STEP_LABELS: Record<WizardStep, string> = {
  'personal-info': 'Personal information',
  contact: 'Contact details',
  'school-selection': 'School preferences',
  documents: 'Supporting documents',
  review: 'Review and submit',
};

/**
 * Short labels surfaced beneath each pill in `<WizardProgress>`. The
 * full STEP_LABELS above are used for the page heading (so screen
 * readers and sighted users still hear the descriptive form name);
 * the pill labels are tighter so all five fit on a phone width.
 */
const WIZARD_PROGRESS_LABELS: Record<WizardStep, string> = {
  'personal-info': 'Personal info',
  contact: 'Contact',
  'school-selection': 'School preferences',
  documents: 'Documents',
  review: 'Review',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findError(errors: FieldError[], path: string): string | undefined {
  return errors.find((e) => e.path === path)?.message;
}

interface FieldProps {
  label: string;
  error?: string | undefined;
  htmlFor: string;
  children: React.ReactNode;
}

function Field({ label, error, htmlFor, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-destructive" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ─── Step components ─────────────────────────────────────────────────────────

function PersonalInfoStep({ wizard }: { wizard: Wizard }) {
  const id = useId();
  const values = wizard.draft.personalInfo ?? DEFAULT_PERSONAL_INFO;
  const set = useCallback(
    (patch: Partial<PersonalInfoValues>) => {
      wizard.setPersonalInfo({ ...values, ...patch });
    },
    [values, wizard],
  );
  return (
    <fieldset className="space-y-4" data-testid="step-personal-info">
      <legend className="sr-only">{STEP_LABELS['personal-info']}</legend>
      <Field
        label="First name"
        htmlFor={`${id}-firstName`}
        error={findError(wizard.errors, 'firstName')}
      >
        <input
          id={`${id}-firstName`}
          type="text"
          className="w-full rounded-md border bg-background p-2"
          value={values.firstName}
          onChange={(e) => set({ firstName: e.target.value })}
          data-testid="firstName"
        />
      </Field>
      <Field
        label="Last name"
        htmlFor={`${id}-lastName`}
        error={findError(wizard.errors, 'lastName')}
      >
        <input
          id={`${id}-lastName`}
          type="text"
          className="w-full rounded-md border bg-background p-2"
          value={values.lastName}
          onChange={(e) => set({ lastName: e.target.value })}
          data-testid="lastName"
        />
      </Field>
      <Field
        label="Date of birth"
        htmlFor={`${id}-dob`}
        error={findError(wizard.errors, 'dateOfBirth')}
      >
        <input
          id={`${id}-dob`}
          type="date"
          className="w-full rounded-md border bg-background p-2"
          value={values.dateOfBirth}
          onChange={(e) => set({ dateOfBirth: e.target.value })}
          data-testid="dateOfBirth"
        />
      </Field>
      <Field
        label="Gender"
        htmlFor={`${id}-gender`}
        error={findError(wizard.errors, 'gender')}
      >
        <select
          id={`${id}-gender`}
          className="w-full rounded-md border bg-background p-2"
          value={values.gender}
          onChange={(e) =>
            set({ gender: e.target.value as PersonalInfoValues['gender'] })
          }
          data-testid="gender"
        >
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
      </Field>
    </fieldset>
  );
}

function ContactStep({ wizard }: { wizard: Wizard }) {
  const id = useId();
  const values = wizard.draft.contact ?? DEFAULT_CONTACT;
  const set = useCallback(
    (patch: Partial<ContactValues>) => {
      wizard.setContact({ ...values, ...patch });
    },
    [values, wizard],
  );
  return (
    <fieldset className="space-y-4" data-testid="step-contact">
      <legend className="sr-only">{STEP_LABELS.contact}</legend>
      <Field
        label="Guardian first name"
        htmlFor={`${id}-gFirst`}
        error={findError(wizard.errors, 'guardianFirstName')}
      >
        <input
          id={`${id}-gFirst`}
          type="text"
          className="w-full rounded-md border bg-background p-2"
          value={values.guardianFirstName}
          onChange={(e) => set({ guardianFirstName: e.target.value })}
          data-testid="guardianFirstName"
        />
      </Field>
      <Field
        label="Guardian last name"
        htmlFor={`${id}-gLast`}
        error={findError(wizard.errors, 'guardianLastName')}
      >
        <input
          id={`${id}-gLast`}
          type="text"
          className="w-full rounded-md border bg-background p-2"
          value={values.guardianLastName}
          onChange={(e) => set({ guardianLastName: e.target.value })}
          data-testid="guardianLastName"
        />
      </Field>
      <Field
        label="Relationship"
        htmlFor={`${id}-rel`}
        error={findError(wizard.errors, 'guardianRelationship')}
      >
        <input
          id={`${id}-rel`}
          type="text"
          className="w-full rounded-md border bg-background p-2"
          value={values.guardianRelationship}
          onChange={(e) => set({ guardianRelationship: e.target.value })}
          data-testid="guardianRelationship"
        />
      </Field>
      <Field
        label="Phone"
        htmlFor={`${id}-phone`}
        error={findError(wizard.errors, 'phone')}
      >
        <input
          id={`${id}-phone`}
          type="tel"
          className="w-full rounded-md border bg-background p-2"
          value={values.phone}
          onChange={(e) => set({ phone: e.target.value })}
          data-testid="phone"
        />
      </Field>
      <Field
        label="Email"
        htmlFor={`${id}-email`}
        error={findError(wizard.errors, 'email')}
      >
        <input
          id={`${id}-email`}
          type="email"
          className="w-full rounded-md border bg-background p-2"
          value={values.email}
          onChange={(e) => set({ email: e.target.value })}
          data-testid="email"
        />
      </Field>
      <Field
        label="Address"
        htmlFor={`${id}-addr1`}
        error={findError(wizard.errors, 'addressLine1')}
      >
        <input
          id={`${id}-addr1`}
          type="text"
          className="w-full rounded-md border bg-background p-2"
          value={values.addressLine1}
          onChange={(e) => set({ addressLine1: e.target.value })}
          data-testid="addressLine1"
        />
      </Field>
      <Field
        label="City"
        htmlFor={`${id}-city`}
        error={findError(wizard.errors, 'city')}
      >
        <input
          id={`${id}-city`}
          type="text"
          className="w-full rounded-md border bg-background p-2"
          value={values.city}
          onChange={(e) => set({ city: e.target.value })}
          data-testid="city"
        />
      </Field>
      <Field
        label="Country"
        htmlFor={`${id}-country`}
        error={findError(wizard.errors, 'country')}
      >
        <input
          id={`${id}-country`}
          type="text"
          className="w-full rounded-md border bg-background p-2"
          value={values.country}
          onChange={(e) => set({ country: e.target.value })}
          data-testid="country"
        />
      </Field>
    </fieldset>
  );
}

function SchoolSelectionStep({
  wizard,
  schoolFinderProps,
}: {
  wizard: Wizard;
  schoolFinderProps?: SchoolSelectionStepConfig;
}) {
  const values = wizard.draft.schoolSelection ?? DEFAULT_SCHOOL_SELECTION;
  const set = useCallback(
    (next: SchoolSelectionValues) => {
      wizard.setSchoolSelection(next);
    },
    [wizard],
  );

  const handleAdd = useCallback(
    (school: SchoolFinderResult) => {
      if (values.preferences.some((p) => p.schoolId === school.id)) return;
      if (values.preferences.length >= MAX_RANKED_PREFERENCES) return;
      const nextPreferences = [
        ...values.preferences,
        {
          schoolId: school.id,
          schoolName: school.name,
          rank: (values.preferences.length + 1) as 1 | 2 | 3,
        },
      ];
      set({ preferences: nextPreferences });
    },
    [set, values.preferences],
  );

  const handleRemove = useCallback(
    (schoolId: string) => {
      const filtered = values.preferences.filter((p) => p.schoolId !== schoolId);
      // Re-derive ranks from order so the gap closes after a remove.
      set({
        preferences: filtered.map((p, idx) => ({
          ...p,
          rank: (idx + 1) as 1 | 2 | 3,
        })),
      });
    },
    [set, values.preferences],
  );

  const handleReorder = useCallback(
    (next: SchoolPreference[]) => {
      set({ preferences: next });
    },
    [set],
  );

  const selectedIds = useMemo(
    () => values.preferences.map((p) => p.schoolId),
    [values.preferences],
  );

  return (
    <fieldset className="space-y-4" data-testid="step-school-selection">
      <legend className="sr-only">{STEP_LABELS['school-selection']}</legend>
      <p className="text-sm text-muted-foreground">
        Search for schools by location or filter, then rank up to{' '}
        {MAX_RANKED_PREFERENCES} preferences in order.
      </p>
      <SchoolFinder
        areaOptions={schoolFinderProps?.areaOptions}
        schoolTypeOptions={schoolFinderProps?.schoolTypeOptions}
        gradeOptions={schoolFinderProps?.gradeOptions}
        selectedIds={selectedIds}
        onAddPreference={handleAdd}
        onRemovePreference={handleRemove}
        maxPreferences={MAX_RANKED_PREFERENCES}
        {...(schoolFinderProps?.fetcher ? { fetcher: schoolFinderProps.fetcher } : {})}
      />
      <RankedPreference
        preferences={values.preferences}
        onChange={handleReorder}
        heading="Your ranked preferences"
      />
      {findError(wizard.errors, 'preferences') ? (
        <p className="text-sm text-destructive" role="alert">
          {findError(wizard.errors, 'preferences')}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * Optional configuration the host page can pass to seed the School
 * Finder's filter dropdowns. Provided as a prop on the wizard so a
 * tenant-specific page can pull lookups from `useArea()` / config
 * without coupling the wizard to those services.
 */
export interface SchoolSelectionStepConfig {
  areaOptions?: SchoolFinderOption[];
  schoolTypeOptions?: SchoolFinderOption[];
  gradeOptions?: SchoolFinderOption[];
  /** Inject a fetch implementation. Used by tests. */
  fetcher?: typeof fetch;
}

function DocumentsStep({ wizard }: { wizard: Wizard }) {
  const id = useId();
  const values = wizard.draft.documents ?? DEFAULT_DOCUMENTS;
  const [pending, setPending] = useState<DocumentRef>({
    type: '',
    documentId: '',
    fileName: '',
    sizeBytes: 0,
  });

  const set = useCallback(
    (next: DocumentsValues) => {
      wizard.setDocuments(next);
    },
    [wizard],
  );

  const addDocument = (): void => {
    if (!pending.type.trim() || !pending.documentId.trim() || !pending.fileName.trim()) return;
    set({ documents: [...values.documents, pending] });
    setPending({ type: '', documentId: '', fileName: '', sizeBytes: 0 });
  };

  const removeAt = (idx: number): void => {
    set({ documents: values.documents.filter((_, i) => i !== idx) });
  };

  return (
    <fieldset className="space-y-4" data-testid="step-documents">
      <legend className="sr-only">{STEP_LABELS.documents}</legend>
      <p className="text-sm text-muted-foreground">
        Attach the required supporting documents. The full upload widget is
        wired in task 51.5; this placeholder accepts an upload reference so the
        state machine is exercised end-to-end.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr,1fr,1fr,auto]">
        <Field label="Document type" htmlFor={`${id}-type`}>
          <input
            id={`${id}-type`}
            type="text"
            className="w-full rounded-md border bg-background p-2"
            value={pending.type}
            onChange={(e) => setPending((d) => ({ ...d, type: e.target.value }))}
            data-testid="documentType-input"
          />
        </Field>
        <Field label="Document ID" htmlFor={`${id}-docId`}>
          <input
            id={`${id}-docId`}
            type="text"
            className="w-full rounded-md border bg-background p-2"
            value={pending.documentId}
            onChange={(e) =>
              setPending((d) => ({ ...d, documentId: e.target.value }))
            }
            data-testid="documentId-input"
          />
        </Field>
        <Field label="File name" htmlFor={`${id}-fileName`}>
          <input
            id={`${id}-fileName`}
            type="text"
            className="w-full rounded-md border bg-background p-2"
            value={pending.fileName}
            onChange={(e) =>
              setPending((d) => ({ ...d, fileName: e.target.value }))
            }
            data-testid="fileName-input"
          />
        </Field>
        <button
          type="button"
          className="self-end rounded-md border bg-primary p-2 text-primary-foreground"
          onClick={addDocument}
          data-testid="add-document"
        >
          Add
        </button>
      </div>
      <ul
        className="space-y-2"
        aria-label="Attached documents"
        data-testid="documents-list"
      >
        {values.documents.map((d, idx) => (
          <li
            key={`${d.type}-${d.documentId}`}
            className="flex items-center justify-between rounded-md border p-2"
            data-testid={`document-${d.type}`}
          >
            <span>
              {d.type} — {d.fileName}
            </span>
            <button
              type="button"
              className="rounded-md border p-2 text-sm"
              onClick={() => removeAt(idx)}
              aria-label={`Remove ${d.fileName}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {findError(wizard.errors, 'documents') ? (
        <p className="text-sm text-destructive" role="alert">
          {findError(wizard.errors, 'documents')}
        </p>
      ) : null}
    </fieldset>
  );
}

function ReviewStep({ wizard }: { wizard: Wizard }) {
  const id = useId();
  const values = wizard.draft.review ?? DEFAULT_REVIEW;
  const set = useCallback(
    (patch: Partial<ReviewDraft>) => {
      wizard.setReview({ ...values, ...patch });
    },
    [values, wizard],
  );
  return (
    <fieldset className="space-y-4" data-testid="step-review">
      <legend className="sr-only">{STEP_LABELS.review}</legend>
      <ReviewSummary wizard={wizard} />
      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            id={`${id}-accurate`}
            type="checkbox"
            checked={values.confirmAccurate}
            onChange={(e) => set({ confirmAccurate: e.target.checked })}
            data-testid="confirmAccurate"
          />
          <span>I confirm the information above is accurate.</span>
        </label>
        {findError(wizard.errors, 'confirmAccurate') ? (
          <p className="text-sm text-destructive" role="alert">
            {findError(wizard.errors, 'confirmAccurate')}
          </p>
        ) : null}
        <label className="flex items-start gap-2 text-sm">
          <input
            id={`${id}-terms`}
            type="checkbox"
            checked={values.acceptTerms}
            onChange={(e) => set({ acceptTerms: e.target.checked })}
            data-testid="acceptTerms"
          />
          <span>I have read and accept the privacy policy and terms of service.</span>
        </label>
        {findError(wizard.errors, 'acceptTerms') ? (
          <p className="text-sm text-destructive" role="alert">
            {findError(wizard.errors, 'acceptTerms')}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

function ReviewSummary({ wizard }: { wizard: Wizard }) {
  const { draft } = wizard;
  return (
    <dl className="space-y-2 rounded-md border p-3 text-sm" data-testid="review-summary">
      {draft.personalInfo ? (
        <div>
          <dt className="font-medium">Applicant</dt>
          <dd>
            {draft.personalInfo.firstName} {draft.personalInfo.lastName} —{' '}
            {draft.personalInfo.dateOfBirth}
          </dd>
        </div>
      ) : null}
      {draft.contact ? (
        <div>
          <dt className="font-medium">Contact</dt>
          <dd>
            {draft.contact.guardianFirstName} {draft.contact.guardianLastName} •{' '}
            {draft.contact.email}
          </dd>
        </div>
      ) : null}
      {draft.schoolSelection ? (
        <div>
          <dt className="font-medium">Preferences</dt>
          <dd>
            {draft.schoolSelection.preferences
              .slice()
              .sort((a, b) => a.rank - b.rank)
              .map((p) => `#${p.rank} ${p.schoolName}`)
              .join(', ')}
          </dd>
        </div>
      ) : null}
      {draft.documents ? (
        <div>
          <dt className="font-medium">Documents</dt>
          <dd>{draft.documents.documents.map((d) => d.type).join(', ')}</dd>
        </div>
      ) : null}
    </dl>
  );
}

// ─── Container ───────────────────────────────────────────────────────────────

export interface RegistrationWizardProps {
  /**
   * Called when the user clicks "Submit" on the review step and
   * every prior step's validation passes. Receives the snapshot
   * captured by `getSubmitSnapshot()`.
   *
   * The host page is responsible for the actual API call, which is
   * out of scope for this task (51.1) and is wired up by the next
   * task in the registration sequence.
   */
  onSubmit?: (snapshot: ReturnType<Wizard['getSubmitSnapshot']>) => void;
  /**
   * Optional configuration for the school-selection step. Lets the
   * host page seed the School Finder's filter dropdowns and inject a
   * test `fetcher`.
   */
  schoolSelectionConfig?: SchoolSelectionStepConfig;
}

/**
 * The composed wizard. Mount under `/registration/form`.
 */
export function RegistrationWizard({
  onSubmit,
  schoolSelectionConfig,
}: RegistrationWizardProps) {
  const wizard = useRegistrationWizard();

  const stepLabel = useMemo(
    () => STEP_LABELS[wizard.currentStep],
    [wizard.currentStep],
  );

  // Step descriptors for `<WizardProgress>`. The pill labels are the
  // shorter "Personal info" / "Contact" forms called out by the spec
  // (rather than the full step legends used by the form headings).
  const progressSteps = useMemo(
    () =>
      WIZARD_STEPS.map((id) => ({
        id,
        label: WIZARD_PROGRESS_LABELS[id],
      })),
    [],
  );

  const handleNext = useCallback(() => {
    if (wizard.currentStep === 'review') {
      const snapshot = wizard.getSubmitSnapshot();
      onSubmit?.(snapshot);
      return;
    }
    wizard.goNext();
  }, [onSubmit, wizard]);

  return (
    <section
      aria-labelledby="registration-wizard-heading"
      className="mx-auto max-w-2xl space-y-6 p-6"
      data-testid="registration-wizard"
    >
      <header className="space-y-4">
        <WizardProgress
          steps={progressSteps}
          currentStep={wizard.currentStep}
          currentStepIndex={wizard.currentStepIndex}
          totalSteps={wizard.totalSteps}
          onNavigate={(step) => wizard.goTo(step)}
        />
        <h1 id="registration-wizard-heading" className="text-2xl font-semibold">
          {stepLabel}
        </h1>
        {wizard.errors.length > 0 ? (
          <div
            role="alert"
            className="rounded-md border border-destructive p-3 text-sm text-destructive"
            data-testid="error-summary"
          >
            <p className="font-medium">Please fix the following before continuing:</p>
            <ul className="mt-1 list-disc ps-5">
              {wizard.errors.map((e, i) => (
                <li key={`${e.path}-${i}`}>{e.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </header>

      <div data-testid={`step-pane-${wizard.currentStep}`}>
        {wizard.currentStep === 'personal-info' ? (
          <PersonalInfoStep wizard={wizard} />
        ) : null}
        {wizard.currentStep === 'contact' ? <ContactStep wizard={wizard} /> : null}
        {wizard.currentStep === 'school-selection' ? (
          <SchoolSelectionStep
            wizard={wizard}
            {...(schoolSelectionConfig ? { schoolFinderProps: schoolSelectionConfig } : {})}
          />
        ) : null}
        {wizard.currentStep === 'documents' ? <DocumentsStep wizard={wizard} /> : null}
        {wizard.currentStep === 'review' ? <ReviewStep wizard={wizard} /> : null}
      </div>

      <footer className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="rounded-md border p-2 text-sm"
          onClick={() => wizard.goBack()}
          disabled={wizard.currentStepIndex === 0}
          data-testid="back-button"
        >
          Back
        </button>
        <button
          type="button"
          className="rounded-md border bg-primary p-3 text-sm text-primary-foreground"
          onClick={handleNext}
          data-testid="next-button"
        >
          {wizard.currentStep === 'review' ? 'Submit application' : 'Continue'}
        </button>
      </footer>
    </section>
  );
}

export default RegistrationWizard;

// Re-export the canonical step list so consumers do not need to import
// the hook module directly when they only need the metadata.
export { WIZARD_STEPS };
