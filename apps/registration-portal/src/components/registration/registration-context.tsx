'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'next/navigation';
import type { DocumentUploadMetadata } from '@/lib/api';
import { isValidInstitutionId } from '@/lib/validation';
import { stripDocumentContent, toPersistedDraft } from '@/lib/registration-draft';

export { stripDocumentContent, toPersistedDraft } from '@/lib/registration-draft';

/**
 * Multi-step registration form state, persisted in `sessionStorage` so the
 * applicant can move between `/apply/[type]`, `/apply/[type]/documents`, and
 * `/apply/[type]/review` without losing data. The state is namespaced by
 * institution type so concurrent tabs for different types don't collide.
 *
 * Document **bytes** are kept in memory only (never written to sessionStorage).
 * Persisted drafts store metadata (name/type/size/documentType) without `content`.
 */
export interface RegistrationDraft {
  institutionType: string;
  /** Selected target institution UUID */
  institutionId: string;
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  gender: 'male' | 'female' | 'other' | '';
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  /** Configurable field values keyed by fieldId */
  customFields: Record<string, string>;
  /** Metadata only in the draft; file bytes live in the in-memory file map */
  documents: DocumentUploadMetadata[];
  /** Tracking number returned after a successful submission */
  trackingNumber?: string;
}

const initialDraft = (institutionType: string): RegistrationDraft => ({
  institutionType,
  institutionId: '',
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: '',
  guardianName: '',
  guardianPhone: '',
  guardianEmail: '',
  customFields: {},
  documents: [],
});

interface RegistrationContextValue {
  draft: RegistrationDraft;
  update: (patch: Partial<RegistrationDraft>) => void;
  setCustomField: (fieldId: string, value: string) => void;
  addDocument: (doc: DocumentUploadMetadata, file?: File) => void;
  removeDocument: (documentType: string) => void;
  /** In-memory File for a document type (undefined after refresh / tab close) */
  getDocumentFile: (documentType: string) => File | undefined;
  reset: () => void;
}

const RegistrationContext = createContext<RegistrationContextValue | null>(null);

const storageKey = (institutionType: string) => `registration-draft:${institutionType}`;

/**
 * Provides the multi-step registration form state.
 * The draft is persisted to `sessionStorage` so refreshing or moving between
 * pages keeps the user's progress (document metadata only).
 */
export function RegistrationProvider({
  institutionType,
  children,
}: {
  institutionType: string;
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<RegistrationDraft>(() => initialDraft(institutionType));
  const fileMapRef = useRef<Map<string, File>>(new Map());

  // Hydrate from sessionStorage after mount (avoids SSR mismatch), then apply
  // any `?institutionId=` query from the school-finder Apply CTA.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const queryInstitutionId = searchParams?.get('institutionId') ?? '';
    const queryId = isValidInstitutionId(queryInstitutionId) ? queryInstitutionId : '';
    try {
      const raw = window.sessionStorage.getItem(storageKey(institutionType));
      if (raw) {
        const parsed = JSON.parse(raw) as RegistrationDraft;
        setDraft({
          ...initialDraft(institutionType),
          ...parsed,
          institutionType,
          institutionId: queryId || parsed.institutionId || '',
          // Drop any legacy base64 content from older drafts.
          documents: stripDocumentContent(parsed.documents ?? []),
        });
      } else if (queryId) {
        setDraft({ ...initialDraft(institutionType), institutionId: queryId });
      }
    } catch {
      setDraft({ ...initialDraft(institutionType), institutionId: queryId });
    }
  }, [institutionType, searchParams]);

  // Persist on every change — metadata only (never document bytes).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(
        storageKey(institutionType),
        JSON.stringify(toPersistedDraft(draft)),
      );
    } catch {
      // Quota exceeded — not fatal for a multi-step form.
    }
  }, [draft, institutionType]);

  const update = useCallback((patch: Partial<RegistrationDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const setCustomField = useCallback((fieldId: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      customFields: { ...prev.customFields, [fieldId]: value },
    }));
  }, []);

  const addDocument = useCallback((doc: DocumentUploadMetadata, file?: File) => {
    const { content: _content, ...meta } = doc;
    if (file) {
      fileMapRef.current.set(meta.documentType, file);
    } else {
      fileMapRef.current.delete(meta.documentType);
    }
    setDraft((prev) => ({
      ...prev,
      documents: [
        ...prev.documents.filter((d) => d.documentType !== meta.documentType),
        meta,
      ],
    }));
  }, []);

  const removeDocument = useCallback((documentType: string) => {
    fileMapRef.current.delete(documentType);
    setDraft((prev) => ({
      ...prev,
      documents: prev.documents.filter((d) => d.documentType !== documentType),
    }));
  }, []);

  const getDocumentFile = useCallback((documentType: string) => {
    return fileMapRef.current.get(documentType);
  }, []);

  const reset = useCallback(() => {
    fileMapRef.current.clear();
    setDraft(initialDraft(institutionType));
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(storageKey(institutionType));
    }
  }, [institutionType]);

  const value = useMemo<RegistrationContextValue>(
    () => ({
      draft,
      update,
      setCustomField,
      addDocument,
      removeDocument,
      getDocumentFile,
      reset,
    }),
    [draft, update, setCustomField, addDocument, removeDocument, getDocumentFile, reset],
  );

  return <RegistrationContext.Provider value={value}>{children}</RegistrationContext.Provider>;
}

/**
 * Hook to access the registration draft. Must be used inside a
 * `<RegistrationProvider>`.
 */
export function useRegistration(): RegistrationContextValue {
  const ctx = useContext(RegistrationContext);
  if (!ctx) {
    throw new Error('useRegistration must be used inside <RegistrationProvider>');
  }
  return ctx;
}
