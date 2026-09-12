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
import { OAuthIcon } from '@/components/auth/oauth-icon';
import { AuthDemoModeBanner } from '@/components/auth/auth-demo-mode-banner';
import {
  AUTH_ENDPOINTS,
  OAUTH_PROVIDERS,
  getOAuthAuthorizeUrl,
  sanitizeReturnTo,
  signIn,
} from '@/lib/auth';

/**
 * Client component for the login form. Submits credentials to
 * /api/auth/login and either:
 *  - navigates to `returnTo` on a successful login, or
 *  - navigates to /mfa with the challenge token when MFA is required.
 */
export function LoginForm(): JSX.Element {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));
  const wasExpired = searchParams.get('expired') === 'true';
  const oauthError = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
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
      // Use a hard navigation so middleware re-evaluates with new cookies.
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
          <p className="text-sm text-muted-foreground">{t('signInSubtitle')}</p>
        </header>

        <AuthDemoModeBanner />

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

        <div className="mb-4">
          <Button variant="outline" className="w-full justify-center gap-2" asChild>
            <a
              href={`${AUTH_ENDPOINTS.KEYCLOAK}?returnTo=${encodeURIComponent(returnTo)}`}
              data-testid="keycloak-sso"
              aria-label="Sign in with Keycloak SSO"
            >
              Sign in with SSO (Keycloak)
            </a>
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('emailAddress')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={isSubmitting}
              placeholder="admin@school.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 min-h-12"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">{t('password')}</Label>
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
                className="h-12 min-h-12 pe-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute end-0 top-0 inline-flex h-12 w-12 min-h-12 min-w-12 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label className="flex min-h-12 items-center gap-3 text-sm text-foreground">
              <Checkbox
                checked={rememberMe}
                onCheckedChange={(value) => setRememberMe(value === true)}
                aria-label={t('rememberMe')}
                className="h-12 w-12 min-h-12 min-w-12"
              />
              <span>{t('rememberMe')}</span>
            </label>
            <Link
              href="/forgot-password"
              className="inline-flex min-h-12 items-center text-sm font-medium text-primary hover:underline"
            >
              {t('forgotPassword')}
            </Link>
          </div>

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {isSubmitting ? t('signingIn') : t('signIn')}
          </Button>
        </form>

        {OAUTH_PROVIDERS.length > 0 && (
          <>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">{t('orContinueWith')}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {OAUTH_PROVIDERS.map((provider) => (
                <Button
                  key={provider.id}
                  variant="outline"
                  className="w-full justify-center gap-2"
                  asChild
                >
                  <a
                    href={getOAuthAuthorizeUrl(provider.id, returnTo)}
                    aria-label={t('continueWith', { provider: provider.name })}
                  >
                    <OAuthIcon provider={provider.icon} />
                    <span>{provider.name}</span>
                  </a>
                </Button>
              ))}
            </div>
          </>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">{t('contactAdmin')}</p>
      </CardContent>
    </Card>
  );
}
