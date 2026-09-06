'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FormFieldDefinition } from '@/lib/api';
import {
  isValidDateOfBirth,
  isValidEmail,
  isValidPhone,
  validateRequiredFields,
} from '@/lib/validation';
import { useRegistration } from './registration-context';

interface PersonalInfoFormProps {
  institutionType: string;
  /** Configurable fields per institution type (loaded server-side and passed in) */
  customFields: FormFieldDefinition[];
}

/**
 * Step 1 — Personal information form.
 *
 * Collects the standard applicant fields required by the backend
 * SubmitRegistrationSchema, plus any configurable fields supplied per
 * institution type. Validates client-side and persists to the registration
 * draft before navigating to /apply/{type}/documents.
 */
export function PersonalInfoForm({ institutionType, customFields }: PersonalInfoFormProps) {
  const t = useTranslations();
  const router = useRouter();
  const { draft, update, setCustomField } = useRegistration();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const fieldErrors = validateRequiredFields(
      {
        firstName: draft.firstName,
        lastName: draft.lastName,
        dateOfBirth: draft.dateOfBirth,
        gender: draft.gender,
        guardianName: draft.guardianName,
        guardianPhone: draft.guardianPhone,
      },
      ['firstName', 'lastName', 'dateOfBirth', 'gender', 'guardianName', 'guardianPhone'],
    );

    if (draft.dateOfBirth && !isValidDateOfBirth(draft.dateOfBirth)) {
      fieldErrors['dateOfBirth'] = 'invalid_date';
    }

    if (draft.guardianEmail && !isValidEmail(draft.guardianEmail)) {
      fieldErrors['guardianEmail'] = 'invalid_email';
    }
    if (draft.guardianPhone && !isValidPhone(draft.guardianPhone)) {
      fieldErrors['guardianPhone'] = 'invalid_phone';
    }

    // Required custom fields
    for (const field of customFields) {
      if (field.required) {
        const value = draft.customFields[field.id];
        if (!value || value.trim().length === 0) {
          fieldErrors[`custom:${field.id}`] = 'required';
        }
      }
    }

    setErrors(fieldErrors);
    return Object.keys(fieldErrors).length === 0;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (validate()) {
      router.push(`/apply/${encodeURIComponent(institutionType)}/documents`);
    }
  }

  function errorMessage(key: string): string | undefined {
    const code = errors[key];
    if (!code) return undefined;
    if (code === 'required') return t('common.required');
    return code;
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-6" noValidate>
      <h2 className="text-lg font-bold tracking-tight text-gray-900">
        {t('registration.personalInfo')}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="firstName"
          label={t('registration.firstName')}
          required
          value={draft.firstName}
          onChange={(v) => update({ firstName: v })}
          error={errorMessage('firstName')}
          autoComplete="given-name"
        />
        <Field
          id="lastName"
          label={t('registration.lastName')}
          required
          value={draft.lastName}
          onChange={(v) => update({ lastName: v })}
          error={errorMessage('lastName')}
          autoComplete="family-name"
        />
        <Field
          id="dateOfBirth"
          label={t('registration.dateOfBirth')}
          type="date"
          required
          value={draft.dateOfBirth}
          onChange={(v) => update({ dateOfBirth: v })}
          error={errorMessage('dateOfBirth')}
          autoComplete="bday"
        />
        <div>
          <label htmlFor="gender" className="input-label">
            {t('registration.gender')}{' '}
            <span className="text-red-500" aria-hidden="true">
              *
            </span>
          </label>
          <select
            id="gender"
            value={draft.gender}
            onChange={(e) => update({ gender: e.target.value as 'male' | 'female' | 'other' | '' })}
            className="input-field"
            aria-required="true"
            aria-invalid={Boolean(errors['gender'])}
          >
            <option value="">{t('registration.gender')}</option>
            <option value="male">{t('registration.male')}</option>
            <option value="female">{t('registration.female')}</option>
            <option value="other">{t('registration.other')}</option>
          </select>
          {errorMessage('gender') && (
            <p className="input-error" role="alert">
              {errorMessage('gender')}
            </p>
          )}
        </div>
        <Field
          id="guardianName"
          label={t('registration.guardianName')}
          required
          value={draft.guardianName}
          onChange={(v) => update({ guardianName: v })}
          error={errorMessage('guardianName')}
        />
        <Field
          id="guardianPhone"
          label={t('registration.guardianPhone')}
          type="tel"
          required
          value={draft.guardianPhone}
          onChange={(v) => update({ guardianPhone: v })}
          error={errorMessage('guardianPhone')}
          autoComplete="tel"
        />
        <Field
          id="guardianEmail"
          label={t('registration.guardianEmail')}
          type="email"
          value={draft.guardianEmail}
          onChange={(v) => update({ guardianEmail: v })}
          error={errorMessage('guardianEmail')}
          autoComplete="email"
        />
      </div>

      {customFields.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {customFields.map((field) => (
            <CustomField
              key={field.id}
              field={field}
              value={draft.customFields[field.id] ?? ''}
              onChange={(v) => setCustomField(field.id, v)}
              error={errorMessage(`custom:${field.id}`)}
            />
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" className="btn-primary">
          {t('common.next')}
        </button>
      </div>
    </form>
  );
}

interface FieldProps {
  id: string;
  label: string;
  type?: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoComplete?: string;
}

function Field({
  id,
  label,
  type = 'text',
  required,
  value,
  onChange,
  error,
  autoComplete,
}: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="input-label">
        {label}
        {required && (
          <span className="text-red-500" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field"
        aria-required={required}
        aria-invalid={Boolean(error)}
      />
      {error && (
        <p className="input-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface CustomFieldProps {
  field: FormFieldDefinition;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

function CustomField({ field, value, onChange, error }: CustomFieldProps) {
  const id = `custom-${field.id}`;
  return (
    <div className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
      <label htmlFor={id} className="input-label">
        {field.label}
        {field.required && (
          <span className="text-red-500" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {field.type === 'select' && field.options ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-field"
          aria-required={field.required}
        >
          <option value="">--</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-field min-h-[96px]"
          aria-required={field.required}
        />
      ) : field.type === 'checkbox' ? (
        <label className="inline-flex items-center gap-2">
          <input
            id={id}
            type="checkbox"
            checked={value === 'true'}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          />
          <span className="text-sm text-gray-700">{field.label}</span>
        </label>
      ) : (
        <input
          id={id}
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-field"
          aria-required={field.required}
          minLength={field.validation?.minLength}
          maxLength={field.validation?.maxLength}
          pattern={field.validation?.pattern}
        />
      )}
      {error && (
        <p className="input-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
