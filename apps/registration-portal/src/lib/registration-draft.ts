/**
 * Helpers for registration draft persistence.
 * Document bytes must never be written to sessionStorage — only metadata.
 */
import type { DocumentUploadMetadata } from './api';

export interface PersistedRegistrationDraft {
  institutionType: string;
  institutionId: string;
  formConfigurationId: string;
  formConfigurationVersion: number | null;
  submissionKey: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'male' | 'female' | 'other' | '';
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  customFields: Record<string, string>;
  documents: DocumentUploadMetadata[];
  trackingNumber?: string;
}

/** Create the browser-owned key used to converge uncertain/retried submits. */
export function createSubmissionKey(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Secure submission key generation is unavailable');
  }
  return globalThis.crypto.randomUUID();
}

/** Strip base64 `content` so sessionStorage never holds document bytes. */
export function stripDocumentContent(
  documents: DocumentUploadMetadata[],
): DocumentUploadMetadata[] {
  return documents.map(({ content: _content, ...meta }) => meta);
}

/** Build a sessionStorage-safe draft (metadata only for documents). */
export function toPersistedDraft<T extends PersistedRegistrationDraft>(draft: T): T {
  return {
    ...draft,
    documents: stripDocumentContent(draft.documents),
  };
}

/** sessionStorage key prefix for in-progress drafts (one per institution type). */
export const DRAFT_STORAGE_PREFIX = 'registration-draft:';
/** sessionStorage key holding the tracking number for the success page. */
export const LAST_TRACKING_NUMBER_KEY = 'registration:lastTrackingNumber';

/**
 * PRC-M054: true once the applicant has typed anything. Pristine drafts are
 * never persisted, so a reset after submit leaves no `registration-draft:*` key.
 */
export function hasApplicantData(draft: PersistedRegistrationDraft): boolean {
  return Boolean(
    draft.firstName ||
    draft.lastName ||
    draft.dateOfBirth ||
    draft.gender ||
    draft.guardianName ||
    draft.guardianPhone ||
    draft.guardianEmail ||
    Object.keys(draft.customFields).length > 0 ||
    draft.documents.length > 0,
  );
}

/** PRC-M054: remove every registration draft (child + guardian PII) from storage. */
export function clearRegistrationDrafts(storage: Storage): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(DRAFT_STORAGE_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
