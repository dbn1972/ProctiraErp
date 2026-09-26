'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  RegistrationApiError,
  submitRegistration,
  type FieldError,
  type FormConfiguration,
  type RegistrationSubmissionInput,
} from '@/lib/api';
import { registrationErrorMessage } from '@/lib/error-messages';
import { createSubmissionKey } from '@/lib/registration-draft';
import {
  isValidDateOfBirth,
  isValidEmail,
  isValidInstitutionId,
  isValidPhone,
} from '@/lib/validation';
import { useRegistration } from './registration-context';

/**
 * Step 3 — Review and submit.
 *
 * Shows the collected applicant information and uploaded documents, then
 * POSTs to the backend `/registrations` endpoint. Document bytes are read from
 * the in-memory file map at submit time (base64), never from sessionStorage.
 * On success the tracking number is stored in `sessionStorage` and the user is
 * sent to `/apply/success`.
 */
export function ReviewStep({
  institutionType,
  configuration,
  institutionName,
}: {
  institutionType: string;
  configuration: FormConfiguration;
  institutionName?: string | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const { draft, update, getDocumentFile } = useRegistration();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);

  useEffect(() => {
    update({
      institutionId: configuration.institutionId,
      formConfigurationId: configuration.id,
      formConfigurationVersion: configuration.version,
    });
  }, [configuration.id, configuration.institutionId, configuration.version, update]);

  async function handleSubmit() {
    if (!draft.gender) return; // type-narrowed below

    if (
      !isValidInstitutionId(draft.institutionId) ||
      draft.institutionId !== configuration.institutionId
    ) {
      setError(t('registration.institutionRequired'));
      return;
    }
    if (!isValidDateOfBirth(draft.dateOfBirth)) {
      setError(t('registration.invalidDateOfBirth'));
      return;
    }
    if (!isValidPhone(draft.guardianPhone)) {
      setError(t('registration.invalidPhone'));
      return;
    }
    if (draft.guardianEmail && !isValidEmail(draft.guardianEmail)) {
      setError(t('registration.invalidEmail'));
      return;
    }

    const missingConfiguredFields: FieldError[] = [];
    for (const field of configuration.fields) {
      const present =
        field.type === 'file'
          ? draft.documents.some((document) => document.documentType === field.id)
          : Boolean(draft.customFields[field.id]?.trim());
      if (field.required && !present) {
        missingConfiguredFields.push({
          field: field.type === 'file' ? `documents.${field.id}` : `customFields.${field.id}`,
          rule: 'required',
          message: `${field.label}: ${t('common.required')}`,
        });
      }
    }
    if (missingConfiguredFields.length > 0) {
      setFieldErrors(missingConfiguredFields);
      setError(t('registration.fixFieldErrors'));
      return;
    }

    setSubmitting(true);
    setError(null);
    setFieldErrors([]);

    try {
      const documents = await Promise.all(
        draft.documents.map(async (doc) => {
          const file = getDocumentFile(doc.documentType);
          if (!file) {
            // Metadata survived a refresh but bytes did not — ask to re-upload.
            throw new Error(t('documents.reuploadRequired', { fileName: doc.fileName }));
          }
          const content = await fileToBase64(file);
          return { ...doc, content };
        }),
      );

      const payload: RegistrationSubmissionInput = {
        institutionId: configuration.institutionId,
        formConfigurationId: configuration.id,
        formConfigurationVersion: configuration.version,
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
        documents,
        preferredLanguage: locale,
      };

      const submissionKey = draft.submissionKey || createSubmissionKey();
      if (!draft.submissionKey) update({ submissionKey });
      const result = await submitRegistration(payload, submissionKey);
      update({ trackingNumber: result.trackingNumber });
      // Persist tracking number for the success page (sessionStorage scoped to this draft)
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('registration:lastTrackingNumber', result.trackingNumber);
      }
      router.push('/apply/success');
    } catch (err) {
      if (err instanceof RegistrationApiError) {
        setFieldErrors(err.fieldErrors);
      }
      setError(
        err instanceof RegistrationApiError
          ? registrationErrorMessage(t as (key: string) => string, {
              code: err.code,
              message: err.message,
            })
          : err instanceof Error
            ? registrationErrorMessage(t as (key: string) => string, err.message)
            : t('submissionFailed'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleBack() {
    router.push(
      `/apply/${encodeURIComponent(institutionType)}/documents?institutionId=${encodeURIComponent(configuration.institutionId)}`,
    );
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="mb-4 text-lg font-bold tracking-tight text-gray-900">
          {t('registration.review')}
        </h2>
        <dl className="grid gap-y-3 text-sm sm:grid-cols-2 sm:gap-x-6">
          <Row label={t('registration.firstName')} value={draft.firstName} />
          <Row label={t('registration.lastName')} value={draft.lastName} />
          <Row label={t('registration.dateOfBirth')} value={draft.dateOfBirth} />
          <Row label={t('registration.gender')} value={draft.gender} />
          <Row label={t('registration.guardianName')} value={draft.guardianName} />
          <Row label={t('registration.guardianPhone')} value={draft.guardianPhone} />
          <Row
            label={t('registration.institution')}
            value={institutionName?.trim() || t('registration.schoolNameUnavailable')}
          />
          {draft.guardianEmail && (
            <Row label={t('registration.guardianEmail')} value={draft.guardianEmail} />
          )}
          {Object.entries(draft.customFields).map(([fieldId, value]) => (
            <Row
              key={fieldId}
              label={configuration.fields.find((field) => field.id === fieldId)?.label ?? fieldId}
              value={value}
            />
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
                  {!getDocumentFile(doc.documentType) ? (
                    <span className="ms-2 text-amber-700">({t('documents.reuploadHint')})</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && (
        <div
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          role="alert"
        >
          <p>{error}</p>
          {fieldErrors.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 ps-5">
              {fieldErrors.map((fieldError, index) => (
                <li key={`${fieldError.field}-${index}`}>
                  {registrationErrorMessage(t as (key: string) => string, fieldError)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button type="button" onClick={handleBack} className="btn-secondary" disabled={submitting}>
          {t('common.back')}
        </button>
        <button
          type="button"
          onClick={() => {
            void handleSubmit();
          }}
          className="btn-primary"
          disabled={submitting}
        >
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

/** Reads a `File` as a base64-encoded string (without the `data:` prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unexpected reader result'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}
