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
  const tCommon = useTranslations('common');
  const tLanding = useTranslations('landing');
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
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-accent-50 ring-8 ring-accent-50/40">
        <CheckCircle2 className="h-10 w-10 text-accent-600" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-gray-900">{t('submitSuccess')}</h1>

      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-gray-600">
        {t('keepTrackingNumber')}
      </p>

      {trackingNumber ? (
        <div className="mt-6 inline-flex items-center gap-3 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-3">
          <div className="text-start">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">
              {t('trackingNumberLabel')}
            </p>
            <p className="mt-0.5 font-mono text-lg font-semibold tracking-wide text-gray-900">
              {trackingNumber}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
            aria-label="Copy tracking number"
          >
            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
            {copied ? '✓' : ''}
          </button>
        </div>
      ) : (
        <p className="mt-6 text-sm text-gray-500">—</p>
      )}

      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        {trackingNumber && (
          <Link
            href={`/track/${encodeURIComponent(trackingNumber)}`}
            className="btn-primary h-11 px-6 text-base"
          >
            {tLanding('trackCta')}
          </Link>
        )}
        <Link href="/" className="btn-secondary h-11 px-6 text-base">
          {tCommon('home')}
        </Link>
      </div>
    </div>
  );
}
