/**
 * apps/web/src/features/registration/schemas.ts — Zod schemas per wizard step
 * (Task 51.1, Requirements 16.1, 16.2, 16.7, 16.8, Design §F)
 * =====================================================================
 *
 * The public registration wizard is a five-step finite state machine
 * (`personal-info → contact → school-selection → documents → review`).
 * Each step owns a Zod schema that gates advancement and surfaces
 * field-level errors to the screen-reader summary at the top of the
 * step.
 *
 * Design references:
 *
 *   • Design §F (Per-step validation) — "Each step has its own Zod
 *     schema; submitting a step runs the schema and refuses to
 *     advance on any error. The error summary at the top of the step
 *     lists field-level errors for screen readers."
 *   • Design §F (State machine) — describes the step contents that
 *     each schema below validates.
 *
 * Each schema's `.parse` output is captured in a step-scoped slice
 * of `RegistrationDraft` (see `useRegistrationWizard.ts`). The whole
 * draft is what `useDraftAutosave('registration-draft', 30_000)`
 * persists between sessions (Requirement 38 AC 8).
 *
 * The `reviewSchema` is the cross-step gate that confirms the
 * applicant has accepted the consent boxes before submission. It is
 * intentionally separate from the per-step schemas above it because
 * the review screen is read-only over fields validated earlier.
 */
import { z } from 'zod';

// ─── Reusable primitives ─────────────────────────────────────────────────────

const isoDate = z
  .string()
  .min(1, 'Date is required')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD date format');

const trimmedNonEmpty = (max: number, msg: string) =>
  z.string().trim().min(1, msg).max(max);

// Phone is intentionally permissive here. The Authentication service
// runs the strict E.164 / national-format check on submit; the
// wizard only enforces "looks like a phone number" so applicants are
// not blocked by spaces or hyphens during entry.
const phone = z
  .string()
  .trim()
  .min(7, 'Phone number is too short')
  .max(20, 'Phone number is too long')
  .regex(
    /^[+0-9\s\-()]+$/,
    'Phone number may only contain digits and the symbols + ( ) - and spaces',
  );

const email = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .max(254)
  .email('Enter a valid email address');

// ─── Step 1: personal-info ───────────────────────────────────────────────────

/**
 * Step 1 captures the applicant's identity. Fields mirror the
 * placeholder student form so a future "import from registration"
 * flow can copy the data over without remapping.
 */
export const personalInfoSchema = z.object({
  firstName: trimmedNonEmpty(100, 'First name is required'),
  lastName: trimmedNonEmpty(100, 'Last name is required'),
  dateOfBirth: isoDate,
  gender: z
    .enum(['male', 'female', 'other'], {
      message: 'Select a gender',
    }),
  /**
   * National identifier (Aadhaar / SSN / equivalent). Optional at
   * the wizard level — some institutions require it, others do not,
   * and the per-tenant configuration runs in the backend on submit.
   */
  nationalId: z.string().trim().max(50).optional().default(''),
  /** Optional photo upload reference (stored as a server-side URL or a draft id). */
  photoRef: z.string().trim().max(255).optional().default(''),
});

export type PersonalInfoValues = z.infer<typeof personalInfoSchema>;

// ─── Step 2: contact ─────────────────────────────────────────────────────────

/**
 * Step 2 captures the guardian / applicant contact details. The
 * guardian block is the primary path for under-18 applicants; the
 * applicant block is filled when the registrant is the student
 * themselves.
 */
export const contactSchema = z.object({
  guardianFirstName: trimmedNonEmpty(100, 'Guardian first name is required'),
  guardianLastName: trimmedNonEmpty(100, 'Guardian last name is required'),
  guardianRelationship: trimmedNonEmpty(50, 'Relationship is required'),
  phone,
  email,
  addressLine1: trimmedNonEmpty(255, 'Address is required'),
  addressLine2: z.string().trim().max(255).optional().default(''),
  city: trimmedNonEmpty(120, 'City is required'),
  postalCode: z.string().trim().max(20).optional().default(''),
  country: trimmedNonEmpty(100, 'Country is required'),
});

export type ContactValues = z.infer<typeof contactSchema>;

// ─── Step 3: school-selection ────────────────────────────────────────────────

/**
 * One ranked preference slot. Rank is 1, 2, or 3 and corresponds to
 * 1st / 2nd / 3rd choice. Requirement 16 AC 10 caps the list at 3.
 */
const schoolPreferenceSchema = z.object({
  schoolId: z.string().min(1, 'Select a school'),
  schoolName: z.string().min(1).max(255),
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export type SchoolPreference = z.infer<typeof schoolPreferenceSchema>;

/**
 * Step 3 captures up to three ranked school preferences. The schema
 * enforces:
 *
 *   • At least one preference is selected.
 *   • No more than three preferences (Requirement 16 AC 10).
 *   • Ranks are unique within the array (no two 1st choices).
 *   • Schools are unique within the array (a single school cannot
 *     appear twice with different ranks).
 */
export const schoolSelectionSchema = z
  .object({
    preferences: z
      .array(schoolPreferenceSchema)
      .min(1, 'Select at least one school')
      .max(3, 'You can rank at most three schools'),
  })
  .superRefine((value, ctx) => {
    const seenRanks = new Set<number>();
    const seenSchools = new Set<string>();
    for (let i = 0; i < value.preferences.length; i += 1) {
      const pref = value.preferences[i]!;
      if (seenRanks.has(pref.rank)) {
        ctx.addIssue({
          code: 'custom',
          path: ['preferences', i, 'rank'],
          message: 'Each preference must have a unique rank',
        });
      }
      if (seenSchools.has(pref.schoolId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['preferences', i, 'schoolId'],
          message: 'A school can only be selected once',
        });
      }
      seenRanks.add(pref.rank);
      seenSchools.add(pref.schoolId);
    }
  });

export type SchoolSelectionValues = z.infer<typeof schoolSelectionSchema>;

// ─── Step 4: documents ───────────────────────────────────────────────────────

/**
 * Document upload reference. The wizard stores the `documentId`
 * returned by the upload endpoint; the actual file blob lives on the
 * server. A failed upload leaves the slot un-filled and the schema
 * below refuses to advance.
 */
const documentRefSchema = z.object({
  /** Logical document type (`birth_certificate`, `transfer_certificate`, etc.). */
  type: z.string().min(1, 'Document type is required').max(50),
  /** Server-side identifier returned by the upload endpoint. */
  documentId: z.string().min(1, 'Upload incomplete — try again').max(120),
  /** Original filename for display. */
  fileName: z.string().min(1).max(255),
  /** Size in bytes. Useful for the review screen and audit trail. */
  sizeBytes: z.number().int().nonnegative(),
});

export type DocumentRef = z.infer<typeof documentRefSchema>;

/**
 * Step 4 requires the applicant to attach the institution's required
 * documents. The schema enforces:
 *
 *   • At least one document is attached. (The exact list of required
 *     types is configurable per institution and validated on submit
 *     by the backend; the wizard only blocks an empty list.)
 *   • Document types within the array are unique — re-uploading
 *     replaces the prior reference rather than duplicating it.
 */
export const documentsSchema = z
  .object({
    documents: z
      .array(documentRefSchema)
      .min(1, 'Attach at least one supporting document'),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < value.documents.length; i += 1) {
      const doc = value.documents[i]!;
      if (seen.has(doc.type)) {
        ctx.addIssue({
          code: 'custom',
          path: ['documents', i, 'type'],
          message: 'A document of this type is already attached',
        });
      }
      seen.add(doc.type);
    }
  });

export type DocumentsValues = z.infer<typeof documentsSchema>;

// ─── Step 5: review ──────────────────────────────────────────────────────────

/**
 * Step 5 is read-only over the data captured in steps 1–4 plus a
 * pair of consent checkboxes. The user must explicitly affirm both
 * before the wizard issues `submit`.
 */
export const reviewSchema = z.object({
  /** "I confirm the information above is accurate." */
  confirmAccurate: z.literal(true, {
    message: 'You must confirm that the information is accurate',
  }),
  /** "I have read and accept the privacy policy and terms of service." */
  acceptTerms: z.literal(true, {
    message: 'You must accept the terms of service to submit',
  }),
});

export type ReviewValues = z.infer<typeof reviewSchema>;

/**
 * Draft shape for the review step. The validated shape (above)
 * narrows both consent flags to `true`, which would force the
 * default state to be already-accepted. The draft shape allows
 * either boolean so the checkboxes start unchecked and the user
 * must explicitly affirm them.
 */
export interface ReviewDraft {
  confirmAccurate: boolean;
  acceptTerms: boolean;
}

// ─── Aggregate ───────────────────────────────────────────────────────────────

/**
 * The full draft shape persisted by `useDraftAutosave`. Each slice
 * is optional because steps fill them in incrementally; the wizard
 * only requires the prior slice to be present and valid before
 * advancing.
 */
export interface RegistrationDraft {
  personalInfo?: PersonalInfoValues;
  contact?: ContactValues;
  schoolSelection?: SchoolSelectionValues;
  documents?: DocumentsValues;
  review?: ReviewDraft;
}

/**
 * Default empty step values. The wizard seeds React state with these
 * when there is no persisted draft to rehydrate.
 */
export const DEFAULT_PERSONAL_INFO: PersonalInfoValues = {
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: 'other',
  nationalId: '',
  photoRef: '',
};

export const DEFAULT_CONTACT: ContactValues = {
  guardianFirstName: '',
  guardianLastName: '',
  guardianRelationship: '',
  phone: '',
  email: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  postalCode: '',
  country: '',
};

export const DEFAULT_SCHOOL_SELECTION: SchoolSelectionValues = {
  preferences: [],
};

export const DEFAULT_DOCUMENTS: DocumentsValues = {
  documents: [],
};

export const DEFAULT_REVIEW: ReviewDraft = {
  confirmAccurate: false,
  acceptTerms: false,
};
