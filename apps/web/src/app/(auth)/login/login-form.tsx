'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Label,
} from '@proctira/ui/components';
import { signIn } from '@/lib/auth';

/**
 * Proctira auth form matching redesign/web/auth-login.html.
 * Passwords are verified by Keycloak via the gateway; the browser stays
 * on this Proctira page (no Keycloak UI). Mobile + OTP will plug in here later.
 */
export function LoginForm(): JSX.Element {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo') || '/';
  const wasExpired = searchParams.get('expired') === 'true';
  const oauthError = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const result = await signIn(email, password);

    if (result.success) {
      if (result.requiresMfa && result.mfaToken) {
        const mfaUrl = new URL('/mfa', window.location.origin);
        mfaUrl.searchParams.set('token', result.mfaToken);
        if (returnTo) mfaUrl.searchParams.set('returnTo', returnTo);
        router.push(`${mfaUrl.pathname}${mfaUrl.search}`);
        return;
      }
      window.location.href = returnTo;
      return;
    }

    setError(result.message ?? t('invalidCredentials'));
    setIsSubmitting(false);
  }

  return (
    <Card className="w-full max-w-[400px] border-none bg-transparent shadow-none">
      <CardContent className="p-0">
        <header className="mb-7 space-y-1.5">
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            {t('welcomeBack')}
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in to your ProctiraERP workspace.
          </p>
        </header>

        {wasExpired && (
          <Alert variant="warning" className="mb-4">
            <AlertDescription>{t('sessionExpired')}</AlertDescription>
          </Alert>
        )}

        {oauthError && !error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{t('oauthFailed')}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('emailAddress')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              disabled={isSubmitting}
              placeholder="admin@proctira.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t('password')}</Label>
              <Link
                href="/forgot-password"
                className="text-xs font-semibold text-accent hover:underline"
              >
                {t('forgotPassword')}
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                disabled={isSubmitting}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pe-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute end-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={rememberMe}
              onCheckedChange={(value) => setRememberMe(value === true)}
              aria-label={t('rememberMe')}
            />
            <span>{t('rememberMe')}</span>
          </label>

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting && (
              <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {isSubmitting ? t('signingIn') : t('signIn')}
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          {t('contactAdmin')}
        </p>
      </CardContent>
    </Card>
  );
}
