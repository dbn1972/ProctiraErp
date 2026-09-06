/**
 * Helpers for registration draft persistence.
 * Document bytes must never be written to sessionStorage — only metadata.
 */
import type { DocumentUploadMetadata } from './api';

export interface PersistedRegistrationDraft {
  institutionType: string;
  institutionId: string;
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
