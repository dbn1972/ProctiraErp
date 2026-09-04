'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Lock, MailCheck, Loader2 } from 'lucide-react';

import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
} from '@proctira/ui/components';
import { requestPasswordReset } from '@/lib/auth';

/**
 * Forgot-password form. Two-step UI: email entry → confirmation that a
 * reset link was sent. Rendered inside the shared {@link AuthShell}.
 */
export function ForgotPasswordForm(): JSX.Element {
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const result = await requestPasswordReset(email);
    setIsSubmitting(false);
    if (result.success) {
      setSubmitted(true);
    } else {
      setError(result.message ?? t('passwordResetFailed'));
    }
  }

  return (
    <div className="w-full max-w-[400px]">
      <Link
        href="/login"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        {t('backToSignIn')}
      </Link>

      {!submitted ? (
        <>
          <div className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            {t('forgotYourPassword')}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t('forgotPasswordSubtitle')}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            {t('forgotPasswordKeycloakNote')}
          </p>

          {error && (
            <Alert variant="destructive" className="mt-5">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('emailAddress')}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={isSubmitting}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('enterRegisteredEmail')}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {isSubmitting ? t('sending') : t('sendResetLink')}
            </Button>
          </form>
        </>
      ) : (
        <div className="text-center">
          <div className="mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
            <MailCheck className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">
            {t('checkYourEmail')}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t('resetLinkSentTo', { email })}
          </p>
          <Button
            onClick={() => {
              setSubmitted(false);
              setEmail('');
            }}
            variant="link"
            className="mt-5"
          >
            {t('resendEmail')}
          </Button>
        </div>
      )}
    </div>
  );
}
