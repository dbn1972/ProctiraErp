'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShieldCheck, Loader2 } from 'lucide-react';

import { Alert, AlertDescription, Button, MfaCodeInput } from '@proctira/ui/components';
import { sanitizeReturnTo, verifyMfa } from '@/lib/auth';

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

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

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

      <form onSubmit={handleSubmit} className="mt-7 space-y-6">
        <MfaCodeInput
          value={code}
          onChange={setCode}
          disabled={isSubmitting}
          autoFocus
          ariaLabel={t('verificationCode')}
          digitLabel={(n) => t('digitNumber', { number: n })}
        />

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {isSubmitting ? t('verifying') : t('verify')}
        </Button>
      </form>

      <div className="mt-6 space-y-3 text-sm">
        <p className="text-muted-foreground">
          {t('didntReceiveCode')}{' '}
          <button
            type="button"
            className="inline-flex min-h-12 items-center font-medium text-primary hover:underline"
            disabled={isSubmitting}
          >
            {t('resend')}
          </button>
        </p>
        <p>
          <Link href="/login" className="inline-flex min-h-12 items-center text-muted-foreground hover:text-foreground">
            {t('backToSignIn')}
          </Link>
        </p>
      </div>
    </div>
  );
}
