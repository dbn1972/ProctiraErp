/**
 * SignIn — federated authentication entry screen (Task 49.1).
 *
 * Mounted by the federated `RootRouter` at `/auth/signin` via
 * `featureRegistry.ts`. Renders the local credential form, federated
 * provider buttons (Google, Microsoft, Apple) with brand-accurate logos,
 * and routes to the MFA challenge step when the auth-service signals it.
 *
 * Wiring:
 *   • Submits to `POST /api/auth/login` (the Next.js route handler that
 *     proxies the upstream Auth Service `/api/v1/auth/login` contract from
 *     task 4.1) via the existing `signIn()` helper in `@/lib/auth`.
 *   • OAuth/OIDC buttons redirect to `/api/auth/oauth/authorize?provider=…`
 *     which forwards to `/api/v1/auth/oauth/authorize` upstream.
 *
 * Internationalization:
 *   • All copy is sourced through `useLanguage().t()` so RTL pilot locales
 *     and tenant-specific overrides work without source edits
 *     (Requirement 18).
 *
 * Branding:
 *   • `<DocumentTitle pageTitle={t('auth.signIn')} />` binds the browser
 *     tab title to the active brand template via `useBrand().name`
 *     (Requirement 43.5).
 */

import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { DocumentTitle } from '@/components/DocumentTitle';
import { useLanguage } from '@/providers/LanguageProvider';
import { useBrand } from '@/providers/BrandConfigProvider';
import { signIn } from '@/lib/auth/session';

// ─── Federated provider catalog ─────────────────────────────────────────────

/**
 * Provider list rendered by the SignIn page. The federated catalog is a
 * superset of `OAUTH_PROVIDERS` from `@/lib/auth/session` so we can include
 * Apple (Sign-in with Apple) without changing the upstream auth contract
 * type signature. The handler routes this to the same authorize endpoint.
 */
type FederatedProviderId = 'google' | 'microsoft' | 'apple';

interface FederatedProvider {
  id: FederatedProviderId;
  /** Brand label used by the `auth.continueWith` ICU template. */
  name: string;
  /** Icon key consumed by `<OAuthIcon>`. */
  icon: FederatedProviderId;
}

const FEDERATED_PROVIDERS: readonly FederatedProvider[] = [
  { id: 'google', name: 'Google', icon: 'google' },
  { id: 'microsoft', name: 'Microsoft', icon: 'microsoft' },
  { id: 'apple', name: 'Apple', icon: 'apple' },
] as const;

/** Builds the OAuth authorize URL the federated buttons redirect to. */
export function buildOAuthHref(provider: FederatedProviderId, returnTo: string): string {
  const params = new URLSearchParams({ provider });
  if (returnTo) params.set('returnTo', returnTo);
  return `/api/auth/oauth/authorize?${params.toString()}`;
}

// ─── SignIn page ────────────────────────────────────────────────────────────

export default function SignIn(): ReactElement {
  const { t } = useLanguage();
  const { name: brandName } = useBrand();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const returnTo = searchParams.get('returnTo') ?? '/app/dashboard';
  const wasExpired = searchParams.get('expired') === 'true';
  const oauthError = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): boolean {
    let ok = true;
    if (!email.trim()) {
      setEmailError(t('auth.emailRequired'));
      ok = false;
    } else if (!isLikelyEmail(email)) {
      setEmailError(t('auth.emailInvalid'));
      ok = false;
    } else {
      setEmailError(null);
    }

    if (!password) {
      setPasswordError(t('auth.passwordRequired'));
      ok = false;
    } else {
      setPasswordError(null);
    }

    return ok;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    if (!validate()) return;

    setIsSubmitting(true);
    const result = await signIn(email, password);

    if (result.success) {
      if (result.requiresMfa && result.mfaToken) {
        const params = new URLSearchParams({ token: result.mfaToken });
        if (returnTo) params.set('returnTo', returnTo);
        navigate(`/auth/mfa-verify?${params.toString()}`);
        return;
      }
      // Cookies were just set by the API route; bounce through a hard
      // navigation so middleware re-evaluates with the new session.
      if (typeof window !== 'undefined') {
        window.location.href = returnTo;
      }
      return;
    }

    setFormError(result.message ?? t('auth.invalidCredentials'));
    setIsSubmitting(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      {/* Browser tab title is derived from the tenant brand name (Req 43.5). */}
      <DocumentTitle pageTitle={t('auth.signIn')} />

      <Card className="w-full max-w-md border-none shadow-sm">
        <CardContent className="p-8">
          <header className="mb-6 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-primary">
              {t('auth.welcomeBack')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('auth.signInToBrand', { brand: brandName })}
            </p>
          </header>

          {wasExpired && (
            <Alert variant="warning" className="mb-4" data-testid="signin-session-expired">
              <AlertDescription>{t('auth.sessionExpired')}</AlertDescription>
            </Alert>
          )}

          {oauthError && !formError && (
            <Alert variant="destructive" className="mb-4" data-testid="signin-oauth-error">
              <AlertDescription>{t('auth.oauthFailed')}</AlertDescription>
            </Alert>
          )}

          {formError && (
            <Alert variant="destructive" className="mb-4" data-testid="signin-form-error">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <form
            onSubmit={handleSubmit}
            className="space-y-4"
            noValidate
            aria-label={t('auth.signIn')}
          >
            <div className="space-y-1.5">
              <Label htmlFor="signin-email">{t('auth.emailAddress')}</Label>
              <Input
                id="signin-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={isSubmitting}
                placeholder="you@example.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={emailError ? 'true' : undefined}
                aria-describedby={emailError ? 'signin-email-error' : undefined}
              />
              {emailError && (
                <p
                  id="signin-email-error"
                  data-testid="signin-email-error"
                  className="text-xs text-destructive"
                >
                  {emailError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="signin-password">{t('auth.password')}</Label>
              <div className="relative">
                <Input
                  id="signin-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  disabled={isSubmitting}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={passwordError ? 'true' : undefined}
                  aria-describedby={passwordError ? 'signin-password-error' : undefined}
                  className="pe-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute end-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {passwordError && (
                <p
                  id="signin-password-error"
                  data-testid="signin-password-error"
                  className="text-xs text-destructive"
                >
                  {passwordError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={rememberMe}
                  onCheckedChange={(value) => setRememberMe(value === true)}
                  aria-label={t('auth.rememberMe')}
                />
                <span>{t('auth.rememberMe')}</span>
              </label>
              <Link
                to="/auth/forgot-password"
                className="text-sm font-medium text-accent hover:underline"
              >
                {t('auth.forgotPassword')}
              </Link>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full"
              data-testid="signin-submit"
            >
              {isSubmitting && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">{t('auth.orContinueWith')}</span>
            </div>
          </div>

          <div className="space-y-2">
            {FEDERATED_PROVIDERS.map((provider) => (
              <Button
                key={provider.id}
                variant="outline"
                className="w-full justify-center gap-3"
                disabled={isSubmitting}
                asChild
              >
                <a
                  href={buildOAuthHref(provider.id, returnTo)}
                  data-testid={`signin-oauth-${provider.id}`}
                >
                  <OAuthIcon provider={provider.icon} />
                  <span>{t('auth.continueWith', { provider: provider.name })}</span>
                </a>
              </Button>
            ))}
          </div>

          <p className="mt-8 text-center text-xs text-muted-foreground">{t('auth.contactAdmin')}</p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Cheap email shape check. We deliberately avoid a heavyweight regex —
 * the auth service performs the canonical validation, this guard is just
 * to surface user errors before round-tripping the credential.
 */
function isLikelyEmail(value: string): boolean {
  const trimmed = value.trim();
  const at = trimmed.indexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return false;
  const dotInDomain = trimmed.indexOf('.', at + 1);
  return dotInDomain > at + 1 && dotInDomain < trimmed.length - 1;
}
