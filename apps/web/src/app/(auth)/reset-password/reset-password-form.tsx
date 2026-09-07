'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';

import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
  PasswordStrengthMeter,
  type PasswordGrade,
  type PasswordRating,
  type PasswordStrengthRule,
} from '@proctira/ui/components';
import { scorePasswordDetails, type PasswordScoreDetails } from '@proctira/auth';
import { resetPassword } from '@/lib/auth';

const MIN_PASSWORD_LENGTH = 8;

const PASSWORD_RULES = [
  { labelKey: 'passwordRuleLength', satisfied: (d: PasswordScoreDetails) => d.checks.length8 },
  { labelKey: 'passwordRuleUppercase', satisfied: (d: PasswordScoreDetails) => d.checks.uppercase },
  { labelKey: 'passwordRuleLowercase', satisfied: (d: PasswordScoreDetails) => d.checks.lowercase },
  { labelKey: 'passwordRuleNumber', satisfied: (d: PasswordScoreDetails) => d.checks.digit },
  { labelKey: 'passwordRuleSymbol', satisfied: (d: PasswordScoreDetails) => d.checks.symbol },
] as const;

function gradePassword(password: string): PasswordGrade {
  if (!password) return { rating: 'weak', satisfied: 0, percent: 0 };
  const details = scorePasswordDetails(password);
  const satisfied = PASSWORD_RULES.reduce((n, rule) => (rule.satisfied(details) ? n + 1 : n), 0);
  return {
    rating: details.rating,
    satisfied,
    percent: Math.round((satisfied / PASSWORD_RULES.length) * 100),
  };
}

export function ResetPasswordForm(): JSX.Element {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const grade = gradePassword(password);
  const passwordDetails = useMemo(() => scorePasswordDetails(password), [password]);

  function ratingLabel(rating: PasswordRating): string {
    switch (rating) {
      case 'strong':
        return t('passwordStrengthStrong');
      case 'good':
        return t('passwordStrengthGood');
      case 'fair':
        return t('passwordStrengthFair');
      default:
        return t('passwordStrengthWeak');
    }
  }

  const meterRules: PasswordStrengthRule[] = useMemo(
    () =>
      PASSWORD_RULES.map((rule) => ({
        key: rule.labelKey,
        label: t(rule.labelKey),
        satisfied: rule.satisfied(passwordDetails),
      })),
    [passwordDetails, t],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError(t('resetTokenMissing'));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('passwordTooShort', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirmation) {
      setError(t('passwordsDoNotMatch'));
      return;
    }

    setIsSubmitting(true);
    const result = await resetPassword(token, password);
    setIsSubmitting(false);

    if (result.success) {
      router.push('/login?reset=true');
      return;
    }
    setError(result.message ?? t('passwordResetFailed'));
  }

  return (
    <div className="w-full max-w-[400px]">
      <div className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <KeyRound className="h-6 w-6" />
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
        {t('createNewPassword')}
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{t('createNewPasswordSubtitle')}</p>

      {error && (
        <Alert variant="destructive" className="mt-5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="mt-7 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('newPassword')}</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              disabled={isSubmitting}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              className="h-12 min-h-12 pe-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute end-0 top-0 inline-flex h-12 w-12 min-h-12 min-w-12 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? t('hidePassword') : t('showPassword')}
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          {password && (
            <PasswordStrengthMeter
              grade={grade}
              rules={meterRules}
              ratingLabel={ratingLabel(grade.rating)}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmation">{t('confirmPassword')}</Label>
          <div className="relative">
            <Input
              id="confirmation"
              name="confirmation"
              type={showConfirmation ? 'text' : 'password'}
              autoComplete="new-password"
              required
              disabled={isSubmitting}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              className="h-12 min-h-12 pe-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirmation((v) => !v)}
              className="absolute end-0 top-0 inline-flex h-12 w-12 min-h-12 min-w-12 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              aria-label={showConfirmation ? t('hidePassword') : t('showPassword')}
              tabIndex={-1}
            >
              {showConfirmation ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {isSubmitting ? t('saving') : t('updatePassword')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/login" className="inline-flex min-h-12 items-center text-primary hover:underline">
          {t('backToSignIn')}
        </Link>
      </p>
    </div>
  );
}
