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
  // PRC-L020: copy outcome announced through a polite live region.
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setTrackingNumber(window.sessionStorage.getItem('registration:lastTrackingNumber'));
  }, []);

  function handleCopy() {
    if (!trackingNumber) return;
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard?.writeText) {
      setCopyStatus('failed');
      return;
    }
    clipboard.writeText(trackingNumber).then(
      () => {
        setCopyStatus('copied');
        setTimeout(() => setCopyStatus('idle'), 2000);
      },
      () => setCopyStatus('failed'),
    );
  }

  return (
    <div className="card text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-accent-50 ring-8 ring-accent-50/40">
        <CheckCircle2 className="h-10 w-10 text-accent-600" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-gray-900">
        {t('submitSuccess')}
      </h1>

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
            aria-label={t('copyTrackingNumber')}
          >
            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
            {copyStatus === 'copied' ? <span aria-hidden="true">✓</span> : null}
          </button>
          <span className="sr-only" role="status" aria-live="polite">
            {copyStatus === 'copied' ? t('trackingNumberCopied') : ''}
          </span>
        </div>
      ) : (
        <div className="mx-auto mt-6 max-w-md rounded-md border border-amber-200 bg-amber-50 p-4 text-start text-sm text-amber-950">
          <p className="font-semibold">{t('trackingMissingTitle')}</p>
          <p className="mt-2 leading-relaxed">{t('trackingMissingBody')}</p>
        </div>
      )}

      {copyStatus === 'failed' ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {t('copyFailed')}
        </p>
      ) : null}
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link href="/track" className="btn-primary h-11 px-6 text-base">
          {tLanding('trackCta')}
        </Link>
        <Link href="/" className="btn-secondary h-11 px-6 text-base">
          {tCommon('home')}
        </Link>
      </div>
    </div>
  );
}
