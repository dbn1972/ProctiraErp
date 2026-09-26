'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShieldCheck, Loader2 } from 'lucide-react';

import { Alert, AlertDescription, Button, MfaCodeInput } from '@proctira/ui/components';
import { resendMfa, sanitizeReturnTo, verifyMfa } from '@/lib/auth';

const CODE_LENGTH = 6;

/**
 * Multi-factor authentication code entry form.
 * Six individual input boxes per the Figma 08-mfa-verification.md spec.
 */
export function MfaForm(): JSX.Element {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));
  const method = (searchParams.get('method') ?? searchParams.get('channel') ?? '').toLowerCase();
  const smsResend = method === 'sms';

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);

    if (!token) {
      setError(t('mfaTokenMissing'));
      return;
    }

    if (code.length !== CODE_LENGTH) {
      setError(t('mfaIncomplete'));
      return;
    }

    setIsSubmitting(true);
    const result = await verifyMfa(token, code);
    setIsSubmitting(false);

    if (result.success) {
      window.location.href = returnTo;
      return;
    }
    setError(result.message ?? t('mfaInvalid'));
    setCode('');
  }

  async function handleResend() {
    setError(null);
    setStatus(null);
    if (!token) {
      setError(t('mfaTokenMissing'));
      return;
    }
    setIsResending(true);
    const result = await resendMfa(token);
    setIsResending(false);
    if (result.success) {
      setStatus(result.message ?? t('resend'));
      return;
    }
    setError(result.message ?? t('mfaInvalid'));
  }

  return (
    <div className="w-full max-w-[400px]">
      <div className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <ShieldCheck className="h-6 w-6" />
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
        {t('twoFactorAuthentication')}
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{t('mfaSubtitle')}</p>

      {error && (
        <Alert variant="destructive" className="mt-5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {status && !error ? (
        <Alert className="mt-5">
          <AlertDescription>{status}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-7 space-y-6">
        <MfaCodeInput
          value={code}
          onChange={setCode}
          disabled={isSubmitting || isResending}
          autoFocus
          ariaLabel={t('verificationCode')}
          digitLabel={(n) => t('digitNumber', { number: n })}
        />

        <Button type="submit" className="w-full" disabled={isSubmitting || isResending}>
          {isSubmitting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {isSubmitting ? t('verifying') : t('verify')}
        </Button>
      </form>

      <div className="mt-6 space-y-3 text-sm">
        {smsResend ? (
          <p className="text-muted-foreground">
            {t('didntReceiveCode')}{' '}
            <button
              type="button"
              className="inline-flex min-h-12 items-center font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting || isResending || !token}
              onClick={() => {
                void handleResend();
              }}
            >
              {isResending ? t('verifying') : t('resend')}
            </button>
          </p>
        ) : (
          <p className="text-muted-foreground">
            {t('didntReceiveCode')} {t('mfaSubtitle')}
          </p>
        )}
        <p>
          <Link
            href="/login"
            className="inline-flex min-h-12 items-center text-muted-foreground hover:text-foreground"
          >
            {t('backToSignIn')}
          </Link>
        </p>
      </div>
    </div>
  );
}
