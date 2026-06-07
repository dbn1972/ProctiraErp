'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { submitRegistration, type RegistrationSubmissionInput } from '@/lib/api';
import { useRegistration } from './registration-context';

/**
 * Step 3 — Review and submit.
 *
 * Shows the collected applicant information and uploaded documents, then
 * POSTs to the backend `/registrations` endpoint. On success the tracking
 * number is stored in `sessionStorage` (via the context) and the user is
 * sent to `/apply/success`.
 */
export function ReviewStep({ institutionType }: { institutionType: string }) {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const { draft, update } = useRegistration();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!draft.gender) return; // type-narrowed below
    setSubmitting(true);
    setError(null);

    const payload: RegistrationSubmissionInput = {
      institutionId: draft.institutionId,
      firstName: draft.firstName,
      lastName: draft.lastName,
      dateOfBirth: draft.dateOfBirth,
      gender: draft.gender,
      guardianName: draft.guardianName,
      guardianPhone: draft.guardianPhone,
      guardianEmail: draft.guardianEmail || undefined,
      customFields: Object.entries(draft.customFields).map(([fieldId, value]) => ({
        fieldId,
        value,
      })),
      documents: draft.documents,
      preferredLanguage: locale,
    };

    try {
      const result = await submitRegistration(payload);
      update({ trackingNumber: result.trackingNumber });
      // Persist tracking number for the success page (sessionStorage scoped to this draft)
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('registration:lastTrackingNumber', result.trackingNumber);
      }
      router.push('/apply/success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  function handleBack() {
    router.push(`/apply/${encodeURIComponent(institutionType)}/documents`);
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="mb-4 text-lg font-bold tracking-tight text-gray-900">{t('registration.review')}</h2>
        <dl className="grid gap-y-3 text-sm sm:grid-cols-2 sm:gap-x-6">
          <Row label={t('registration.firstName')} value={draft.firstName} />
          <Row label={t('registration.lastName')} value={draft.lastName} />
          <Row label={t('registration.dateOfBirth')} value={draft.dateOfBirth} />
          <Row label={t('registration.gender')} value={draft.gender} />
          <Row label={t('registration.guardianName')} value={draft.guardianName} />
          <Row label={t('registration.guardianPhone')} value={draft.guardianPhone} />
          {draft.guardianEmail && (
            <Row label={t('registration.guardianEmail')} value={draft.guardianEmail} />
          )}
          {Object.entries(draft.customFields).map(([fieldId, value]) => (
            <Row key={fieldId} label={fieldId} value={value} />
          ))}
        </dl>

        <div className="mt-6 border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-700">{t('documents.title')}</h3>
          {draft.documents.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">—</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-gray-700">
              {draft.documents.map((doc) => (
                <li key={doc.documentType}>
                  {doc.documentType}: {doc.fileName} ({(doc.fileSize / 1024).toFixed(1)} KB)
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button type="button" onClick={handleBack} className="btn-secondary" disabled={submitting}>
          {t('common.back')}
        </button>
        <button type="button" onClick={handleSubmit} className="btn-primary" disabled={submitting}>
          {submitting ? t('common.loading') : t('common.submit')}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-100 pb-2 last:border-b-0">
      <dt className="font-medium text-gray-600">{label}</dt>
      <dd className="text-gray-900">{value || '—'}</dd>
    </div>
  );
}
