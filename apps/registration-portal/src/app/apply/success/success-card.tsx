'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, ClipboardCopy } from 'lucide-react';

/**
 * Client-side success card. Reads the tracking number that
 * `<ReviewStep>` stored in sessionStorage on a successful submit.
 */
export function SuccessCard() {
  const t = useTranslations('registration');
  const [trackingNumber, setTrackingNumber] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setTrackingNumber(window.sessionStorage.getItem('registration:lastTrackingNumber'));
  }, []);

  function handleCopy() {
    if (!trackingNumber || typeof navigator === 'undefined') return;
    void navigator.clipboard.writeText(trackingNumber).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="card text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-100">
        <CheckCircle2 className="h-9 w-9 text-accent-600" aria-hidden="true" />
      </div>
      <h1 className="mt-4 text-2xl font-bold text-gray-900">{t('submitSuccess')}</h1>

      {trackingNumber ? (
        <div className="mt-6 rounded-md border border-primary-100 bg-primary-50 p-4">
          <p className="text-xs uppercase tracking-wide text-primary-700">
            {t('trackingNumberLabel')}
          </p>
          <div className="mt-2 flex items-center justify-center gap-2">
            <p className="font-mono text-lg font-semibold text-primary-700">{trackingNumber}</p>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded-md border border-primary-200 bg-white px-2 py-1 text-xs text-primary-700 hover:bg-primary-100"
              aria-label="Copy tracking number"
            >
              <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
              {copied ? '✓' : ''}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-6 text-sm text-gray-500">—</p>
      )}

      <p className="mt-6 text-sm text-gray-600">{t('keepTrackingNumber')}</p>

      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        {trackingNumber && (
          <Link href={`/track/${encodeURIComponent(trackingNumber)}`} className="btn-primary">
            Track this application
          </Link>
        )}
        <Link href="/" className="btn-secondary">
          Home
        </Link>
      </div>
    </div>
  );
}
