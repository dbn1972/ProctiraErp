'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'next/navigation';
import type { DocumentUploadMetadata } from '@/lib/api';
import { isValidInstitutionId } from '@/lib/validation';

/**
 * Multi-step registration form state, persisted in `sessionStorage` so the
 * applicant can move between `/apply/[type]`, `/apply/[type]/documents`, and
 * `/apply/[type]/review` without losing data. The state is namespaced by
 * institution type so concurrent tabs for different types don't collide.
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
  addDocument: (doc: DocumentUploadMetadata) => void;
  removeDocument: (documentType: string) => void;
  reset: () => void;
}

const RegistrationContext = createContext<RegistrationContextValue | null>(null);

const storageKey = (institutionType: string) => `registration-draft:${institutionType}`;

/**
 * Provides the multi-step registration form state.
 * The draft is persisted to `sessionStorage` so refreshing or moving between
 * pages keeps the user's progress.
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
        });
      } else if (queryId) {
        setDraft({ ...initialDraft(institutionType), institutionId: queryId });
      }
    } catch {
      setDraft({ ...initialDraft(institutionType), institutionId: queryId });
    }
  }, [institutionType, searchParams]);

  // Persist on every change
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(storageKey(institutionType), JSON.stringify(draft));
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

  const addDocument = useCallback((doc: DocumentUploadMetadata) => {
    setDraft((prev) => ({
      ...prev,
      documents: [...prev.documents.filter((d) => d.documentType !== doc.documentType), doc],
    }));
  }, []);

  const removeDocument = useCallback((documentType: string) => {
    setDraft((prev) => ({
      ...prev,
      documents: prev.documents.filter((d) => d.documentType !== documentType),
    }));
  }, []);

  const reset = useCallback(() => {
    setDraft(initialDraft(institutionType));
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(storageKey(institutionType));
    }
  }, [institutionType]);

  const value = useMemo<RegistrationContextValue>(
    () => ({ draft, update, setCustomField, addDocument, removeDocument, reset }),
    [draft, update, setCustomField, addDocument, removeDocument, reset],
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
