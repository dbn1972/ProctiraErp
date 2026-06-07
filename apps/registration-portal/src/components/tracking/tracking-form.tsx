'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { isValidDateOfBirth, isValidTrackingNumber } from '@/lib/validation';

/**
 * Tracking lookup form: tracking number + student date of birth.
 *
 * Both values are required (no authentication is used to view a status).
 * On submit the user is routed to `/track/[trackingNumber]?dob=YYYY-MM-DD`,
 * where the detail page does the actual API call and DOB verification.
 */
export function TrackingForm() {
  const t = useTranslations('tracking');
  const router = useRouter();
  const [trackingNumber, setTrackingNumber] = useState('');
  const [dob, setDob] = useState('');
  const [errors, setErrors] = useState<{ trackingNumber?: string; dob?: string }>({});

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const nextErrors: typeof errors = {};
    if (!isValidTrackingNumber(trackingNumber)) {
      nextErrors.trackingNumber = t('invalidTrackingNumber');
    }
    if (!isValidDateOfBirth(dob)) {
      nextErrors.dob = t('invalidDob');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const params = new URLSearchParams({ dob });
    router.push(
      `/track/${encodeURIComponent(trackingNumber.trim().toUpperCase())}?${params.toString()}`,
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-5" noValidate>
      <div>
        <label htmlFor="trackingNumber" className="input-label">
          {t('trackingNumber')} <span className="text-red-500" aria-hidden="true">*</span>
        </label>
        <input
          id="trackingNumber"
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
          {t('dobLabel')} <span className="text-red-500" aria-hidden="true">*</span>
        </label>
        <input
          id="dob"
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          placeholder={t('dobPlaceholder')}
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

      <button type="submit" className="btn-primary inline-flex w-full items-center justify-center gap-2">
        <Search className="h-4 w-4" aria-hidden="true" />
        {t('checkStatus')}
      </button>
    </form>
  );
}
