'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DocumentUpload } from './document-upload';
import { useRegistration } from './registration-context';
import type { FormFieldDefinition } from '@/lib/api';

interface DocumentsStepProps {
  institutionType: string;
  /** File-typed configurable fields per institution type */
  fileFields: FormFieldDefinition[];
}

/**
 * Step 2 — Document upload step.
 *
 * Renders one drag-and-drop slot per required document. The required
 * documents come from the institution-type form configuration (`type: 'file'`).
 * If the configuration has no file fields we fall back to a sensible default
 * (passport photo + birth certificate + ID document).
 */
export function DocumentsStep({ institutionType, fileFields }: DocumentsStepProps) {
  const t = useTranslations();
  const router = useRouter();
  const { draft } = useRegistration();

  const docFields: FormFieldDefinition[] =
    fileFields.length > 0
      ? fileFields
      : [
          { id: 'photo', label: t('documents.photo'), type: 'file', required: true },
          { id: 'birthCertificate', label: t('documents.birthCertificate'), type: 'file', required: true },
          { id: 'identityDocument', label: t('documents.identityDocument'), type: 'file', required: false },
        ];

  function handleNext() {
    router.push(`/apply/${encodeURIComponent(institutionType)}/review`);
  }

  function handleBack() {
    router.push(`/apply/${encodeURIComponent(institutionType)}`);
  }

  // Block forward navigation if any required document is missing
  const missingRequired = docFields
    .filter((f) => f.required)
    .filter((f) => !draft.documents.some((d) => d.documentType === f.id));

  return (
    <div className="space-y-6">
      <div className="card space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">{t('documents.title')}</h2>
        <p className="text-sm text-gray-600">{t('documents.subtitle')}</p>
      </div>

      <div className="card space-y-6">
        {docFields.map((field) => (
          <DocumentUpload
            key={field.id}
            documentType={field.id}
            label={field.label}
            required={field.required}
          />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button type="button" onClick={handleBack} className="btn-secondary">
          {t('common.back')}
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={missingRequired.length > 0}
          className="btn-primary"
        >
          {t('common.next')}
        </button>
      </div>
    </div>
  );
}
