'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { isValidDateOfBirth, isValidTrackingNumber } from '@/lib/validation';

/**
 * Tracking lookup form: tracking number + student date of birth.
 *
 * Both values are required. Submit POSTs to `/track/lookup`, which stores
 * the date of birth in an httpOnly cookie and redirects without putting it
 * on the query string.
 */
export function TrackingForm({ invalidSubmission = false }: { invalidSubmission?: boolean }) {
  const t = useTranslations('tracking');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [dob, setDob] = useState('');
  const [errors, setErrors] = useState<{ trackingNumber?: string; dob?: string }>({});

  function handleSubmit(event: React.FormEvent) {
    const nextErrors: typeof errors = {};
    if (!isValidTrackingNumber(trackingNumber)) {
      nextErrors.trackingNumber = t('invalidTrackingNumber');
    }
    if (!isValidDateOfBirth(dob)) {
      nextErrors.dob = t('invalidDob');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      event.preventDefault();
    }
  }

  return (
    <form
      action="/track/lookup"
      method="post"
      onSubmit={handleSubmit}
      className="card space-y-5"
      noValidate
    >
      {invalidSubmission ? (
        <p
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          role="alert"
        >
          {t('invalidTrackingNumber')} {t('invalidDob')}
        </p>
      ) : null}
      <div>
        <label htmlFor="trackingNumber" className="input-label">
          {t('trackingNumber')}{' '}
          <span className="text-red-500" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="trackingNumber"
          name="trackingNumber"
          type="text"
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
          placeholder={t('trackingPlaceholder')}
          className="input-field font-mono"
          autoComplete="off"
          autoCapitalize="characters"
          required
          aria-required="true"
          aria-invalid={Boolean(errors.trackingNumber)}
        />
        {errors.trackingNumber && (
          <p className="input-error" role="alert">
            {errors.trackingNumber}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="dob" className="input-label">
          {t('dobLabel')}{' '}
          <span className="text-red-500" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="dob"
          name="dob"
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          className="input-field"
          required
          aria-required="true"
          aria-invalid={Boolean(errors.dob)}
        />
        <p className="mt-1 text-xs text-gray-500">{t('dobHelp')}</p>
        {errors.dob && (
          <p className="input-error" role="alert">
            {errors.dob}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="btn-primary inline-flex w-full items-center justify-center gap-2"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        {t('checkStatus')}
      </button>
    </form>
  );
}
