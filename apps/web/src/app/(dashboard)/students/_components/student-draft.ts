/**
 * PRC-M119 — what the student form may persist as a local draft.
 *
 * Identity numbers (national ID, document numbers) and contact details
 * (student contacts, guardian phone/email) are never written to
 * localStorage; the user re-enters them after restoring a draft.
 */
import type { StudentFormValues } from '@/lib/validation/student-schema';

export function sanitizeStudentDraft(values: StudentFormValues): StudentFormValues {
  return {
    ...values,
    nationalId: '',
    contacts: (values.contacts ?? []).map((c) => ({ ...c, value: '' })),
    guardians: (values.guardians ?? []).map((g) => ({
      ...g,
      contactPhone: '',
      contactEmail: '',
    })),
    identityDocuments: (values.identityDocuments ?? []).map((d) => ({ ...d, number: '' })),
  };
}

/**
 * A draft saved before the record was last updated is stale (someone else
 * saved newer data) and must not be offered for restore.
 */
export function isDraftStale(
  savedAt: string | null,
  recordUpdatedAt: string | null | undefined,
): boolean {
  if (!savedAt) return true;
  if (!recordUpdatedAt) return false;
  const saved = Date.parse(savedAt);
  const updated = Date.parse(recordUpdatedAt);
  if (!Number.isFinite(saved)) return true;
  if (!Number.isFinite(updated)) return false;
  return saved <= updated;
}

/**
 * Apply a restored (sanitized) draft over the record's current values: the
 * blanked sensitive fields fall back to the record's value at the same
 * position so an edit-mode restore never wipes a stored national ID.
 */
export function mergeDraftOverRecord(
  record: StudentFormValues,
  draft: StudentFormValues,
): StudentFormValues {
  const pick = (a: string | undefined, b: string | undefined) => (a ? a : (b ?? ''));
  return {
    ...record,
    ...draft,
    nationalId: pick(draft.nationalId, record.nationalId),
    contacts: (draft.contacts ?? []).map((c, i) => ({
      ...c,
      value: pick(c.value, record.contacts?.[i]?.value),
    })),
    guardians: (draft.guardians ?? []).map((g, i) => ({
      ...g,
      contactPhone: pick(g.contactPhone, record.guardians?.[i]?.contactPhone),
      contactEmail: pick(g.contactEmail, record.guardians?.[i]?.contactEmail),
    })),
    identityDocuments: (draft.identityDocuments ?? []).map((d, i) => ({
      ...d,
      number: pick(d.number, record.identityDocuments?.[i]?.number),
    })),
  };
}
