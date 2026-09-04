'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShieldCheck, Loader2, Smartphone, MessageSquare } from 'lucide-react';

import {
  Alert,
  AlertDescription,
  Button,
} from '@proctira/ui/components';
import { resendMfa, verifyMfa } from '@/lib/auth';
import { cn } from '@/lib/utils';

const CODE_LENGTH = 6;

/**
 * Multi-factor authentication code entry form.
 * Six individual input boxes per the Figma 08-mfa-verification.md spec.
 * When `?method=sms`, uses the SMS OTP verify/resend path.
 */
export function MfaForm(): JSX.Element {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const returnTo = searchParams.get('returnTo') ?? '/';
  const methodParam = (searchParams.get('method') ?? 'totp').toLowerCase();
  const isSms = methodParam === 'sms';

  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [activeToken, setActiveToken] = useState(token);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    setActiveToken(token);
  }, [token]);

  // Focus the first box on mount.
  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  function handleChange(index: number, raw: string) {
    const value = raw.replace(/\D/g, '').slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });

    if (value && index < CODE_LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(
    index: number,
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData('text').replace(/\D/g, '');
    if (text.length === 0) return;
    event.preventDefault();
    const next = Array(CODE_LENGTH).fill('');
    for (let i = 0; i < CODE_LENGTH && i < text.length; i++) {
      next[i] = text[i] ?? '';
    }
    setDigits(next);
    const focusIndex = Math.min(text.length, CODE_LENGTH - 1);
    inputs.current[focusIndex]?.focus();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!activeToken) {
      setError(t('mfaTokenMissing'));
      return;
    }

    const code = digits.join('');
    if (code.length !== CODE_LENGTH) {
      setError(t('mfaIncomplete'));
      return;
    }

    setIsSubmitting(true);
    const result = await verifyMfa(
      activeToken,
      code,
      isSms ? 'sms' : 'totp',
    );
    setIsSubmitting(false);

    if (result.success) {
      window.location.href = returnTo;
      return;
    }
    setError(result.message ?? t('mfaInvalid'));
    setDigits(Array(CODE_LENGTH).fill(''));
    inputs.current[0]?.focus();
  }

  async function handleResend() {
    if (!activeToken || isResending) return;
    setIsResending(true);
    setError(null);
    const result = await resendMfa(activeToken);
    setIsResending(false);
    if (!result.success) {
      setError(result.message ?? t('mfaInvalid'));
      return;
    }
    if (result.mfaToken) {
      setActiveToken(result.mfaToken);
      const url = new URL(window.location.href);
      url.searchParams.set('token', result.mfaToken);
      url.searchParams.set('method', 'sms');
      router.replace(`${url.pathname}?${url.searchParams.toString()}`);
    }
  }

  function switchToSms() {
    const url = new URL(window.location.href);
    url.searchParams.set('method', 'sms');
    router.replace(`${url.pathname}?${url.searchParams.toString()}`);
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

      <div className="mt-5 flex items-center gap-2.5 rounded-md border border-border bg-muted/40 px-3 py-2.5">
        {isSms ? (
          <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          <b className="block text-sm font-semibold text-foreground">
            {isSms ? t('mfaSmsTitle') : t('mfaAuthenticatorApp')}
          </b>
          {isSms ? t('mfaSmsHint') : t('mfaAuthenticatorHint')}
        </div>
        {!isSms ? (
          <button
            type="button"
            className="shrink-0 text-xs font-semibold text-accent hover:underline"
            onClick={switchToSms}
          >
            {t('mfaUseSmsInstead')}
          </button>
        ) : null}
      </div>

      {error && (
        <Alert variant="destructive" className="mt-5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="mt-7 space-y-6">
        <div
          className="flex gap-2"
          role="group"
          aria-label={t('verificationCode')}
        >
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(el) => {
                  inputs.current[index] = el;
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={handlePaste}
                disabled={isSubmitting}
                aria-label={t('digitNumber', { number: index + 1 })}
                className={cn(
                  'h-14 w-12 rounded-md border-2 border-input bg-background text-center text-2xl font-semibold shadow-sm transition-colors',
                  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                  'disabled:opacity-50',
                )}
              />
            ))}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting}
          >
            {isSubmitting && (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            )}
            {isSubmitting ? t('verifying') : t('verify')}
          </Button>
        </form>

        <div className="mt-6 space-y-3 text-sm">
          <p className="text-muted-foreground">
            {t('didntReceiveCode')}{' '}
            <button
              type="button"
              className="font-medium text-accent hover:underline disabled:opacity-50"
              disabled={isSubmitting || isResending || !activeToken}
              onClick={() => {
                void handleResend();
              }}
            >
              {isResending ? t('verifying') : t('resend')}
            </button>
          </p>
          <p>
            <Link
              href="/login"
              className="text-muted-foreground hover:text-foreground"
            >
              {t('backToSignIn')}
            </Link>
          </p>
        </div>
    </div>
  );
}
