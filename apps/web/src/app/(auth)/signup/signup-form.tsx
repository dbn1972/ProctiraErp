'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff, Loader2, MailCheck } from 'lucide-react';

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Label,
  PasswordStrengthMeter,
  RolePicker,
  type PasswordGrade,
  type PasswordRating,
  type PasswordStrengthRule,
} from '@proctira/ui/components';
import {
  scorePasswordDetails,
  type PasswordScoreDetails,
} from '@proctira/auth';
import { OAuthIcon } from '@/components/auth/oauth-icon';
import {
  DEFAULT_PRIVACY_VERSION,
  DEFAULT_TERMS_VERSION,
  fetchSignupRoles,
  signUp,
  type SignupRole,
} from '@/lib/api/auth';
import { OAUTH_PROVIDERS, getOAuthAuthorizeUrl } from '@/lib/auth';

/**
 * `<SignUpForm>` — Next.js client component that renders the sign-up
 * surface for the `/signup` page (Task 49.2).
 *
 * Mirrors the login form layout (`./login-form.tsx`) but adds the four
 * elements required by Task 49.2:
 *
 *   1. Personal information fields (full name, email, institution).
 *   2. The shared `<RolePicker>` (loaded from
 *      `GET /api/v1/tenant/signup-roles` via `fetchSignupRoles()`).
 *   3. The shared `<PasswordStrengthMeter>` driven by
 *      `scorePasswordDetails()` from `@proctira/auth` (Task 49.6).
 *      The same algorithm runs server-side on
 *      `POST /api/v1/auth/signup` so a `weak` password is rejected
 *      with 422 even if the meter is bypassed (Requirement 4 AC 14).
 *   4. The Terms-of-Service / Privacy-Policy acceptance checkbox.
 *
 * On submit the form posts to `POST /api/auth/signup` (the Next.js route
 * handler that proxies the upstream `/api/v1/auth/signup` contract). The
 * `auth_terms_acceptances` audit row required by Requirement 4 AC 15 is
 * persisted in the same call — the request body carries
 * `termsAcceptance: { acceptedAt, termsVersion, privacyVersion }` so the
 * Auth Service writes the canonical row keyed by the new user identifier
 * (Design §D).
 *
 * Federated sign-up uses the Google / Microsoft / Apple buttons from
 * Task 49.1, sharing the credential bridge `OAUTH_PROVIDERS` /
 * `getOAuthAuthorizeUrl()` so a user can complete sign-up through any
 * supported channel.
 *
 * Internationalization:
 *   • All copy is sourced through `useTranslations('auth')` so RTL pilot
 *     locales and tenant overrides work without source edits
 *     (Requirement 18).
 */

// ─── Password scoring (delegated to `@proctira/auth`) ──────────────────────

interface PasswordRule {
  /** Translation key (under `auth.*`) describing the rule. */
  labelKey: string;
  /** Selector returning whether the rule is satisfied for a given score. */
  satisfied: (details: PasswordScoreDetails) => boolean;
}

const PASSWORD_RULES: readonly PasswordRule[] = [
  { labelKey: 'passwordRuleLength', satisfied: (d) => d.checks.length8 },
  { labelKey: 'passwordRuleUppercase', satisfied: (d) => d.checks.uppercase },
  { labelKey: 'passwordRuleLowercase', satisfied: (d) => d.checks.lowercase },
  { labelKey: 'passwordRuleNumber', satisfied: (d) => d.checks.digit },
  { labelKey: 'passwordRuleSymbol', satisfied: (d) => d.checks.symbol },
] as const;

function gradePassword(password: string): PasswordGrade {
  if (!password) return { rating: 'weak', satisfied: 0, percent: 0 };
  const details = scorePasswordDetails(password);
  const satisfied = PASSWORD_RULES.reduce(
    (n, rule) => (rule.satisfied(details) ? n + 1 : n),
    0,
  );
  return {
    rating: details.rating,
    satisfied,
    percent: Math.round((satisfied / PASSWORD_RULES.length) * 100),
  };
}

// ─── Field validation ───────────────────────────────────────────────────────

interface FieldErrors {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  institution?: string;
  role?: string;
  terms?: string;
}

function isLikelyEmail(value: string): boolean {
  const trimmed = value.trim();
  const at = trimmed.indexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return false;
  const dotInDomain = trimmed.indexOf('.', at + 1);
  return dotInDomain > at + 1 && dotInDomain < trimmed.length - 1;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SignUpForm(): JSX.Element {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo') || '/';

  // Personal information + role + password fields.
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Validation + submission state.
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Confirmation-screen state surfaced after a successful submit when the
  // tenant requires email verification.
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);

  // Role catalog.
  const [roles, setRoles] = useState<SignupRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);

  const reactId = useId();
  const fieldIds = useMemo(
    () => ({
      fullName: `${reactId}-full-name`,
      email: `${reactId}-email`,
      institution: `${reactId}-institution`,
      role: `${reactId}-role`,
      password: `${reactId}-password`,
      confirmPassword: `${reactId}-confirm-password`,
      terms: `${reactId}-terms`,
      meter: `${reactId}-password-meter`,
    }),
    [reactId],
  );

  // Capture the click timestamp on the terms checkbox so the audit row
  // reflects the moment the user actually consented (Req 4 AC 15).
  const termsAcceptedAtRef = useRef<string | null>(null);

  // Role catalog fetch.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setRolesLoading(true);
    setRolesError(null);
    void fetchSignupRoles(controller.signal).then((result) => {
      if (cancelled) return;
      if (result.error && result.error !== 'aborted') {
        setRolesError(t('rolesUnavailable'));
      }
      setRoles(result.roles);
      setRolesLoading(false);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [t]);

  const grade = gradePassword(password);
  const passwordDetails = useMemo(
    () => scorePasswordDetails(password),
    [password],
  );

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

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!fullName.trim()) next.fullName = t('fullNameRequired');
    if (!email.trim()) next.email = t('emailRequired');
    else if (!isLikelyEmail(email)) next.email = t('emailInvalid');
    if (!institutionName.trim())
      next.institution = t('institutionNameRequired');
    if (!roleId) next.role = t('roleRequired');
    if (!password) next.password = t('passwordRequired');
    else if (grade.rating === 'weak') next.password = t('passwordTooWeak');
    if (!confirmPassword) next.confirmPassword = t('confirmPasswordRequired');
    else if (password && confirmPassword !== password)
      next.confirmPassword = t('passwordsDoNotMatch');
    if (!agreedToTerms) next.terms = t('termsRequired');
    return next;
  }

  function handleTermsToggle(checked: boolean): void {
    setAgreedToTerms(checked);
    termsAcceptedAtRef.current = checked ? new Date().toISOString() : null;
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setFormError(null);
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    const acceptedAt =
      termsAcceptedAtRef.current ?? new Date().toISOString();

    const result = await signUp({
      fullName: fullName.trim(),
      email: email.trim(),
      password,
      institutionName: institutionName.trim(),
      roleId,
      termsAcceptance: {
        acceptedAt,
        termsVersion: DEFAULT_TERMS_VERSION,
        privacyVersion: DEFAULT_PRIVACY_VERSION,
      },
    });

    if (result.success) {
      if (result.requiresApproval || result.message) {
        setConfirmedEmail(result.email ?? email);
        setIsSubmitting(false);
        return;
      }
      // Hard navigation so middleware re-evaluates with new cookies.
      window.location.href = returnTo;
      return;
    }

    setFormError(result.message ?? t('signUpFailed'));
    setIsSubmitting(false);
  }

  // ─── Confirmation screen ────────────────────────────────────────────────
  if (confirmedEmail) {
    return (
      <Card className="w-full max-w-[400px] border-none bg-transparent shadow-none">
        <CardContent className="p-0 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <MailCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground">
            {t('accountCreatedTitle')}
          </h1>
          <p
            className="mt-2 text-sm text-muted-foreground"
            data-testid="signup-confirmation-message"
          >
            {t('checkYourEmailToActivate', { email: confirmedEmail })}
          </p>
          <Button
            asChild
            variant="link"
            className="mt-6"
            data-testid="signup-confirmation-back"
          >
            <Link href="/login">{t('backToSignIn')}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ─── Sign-up form ───────────────────────────────────────────────────────
  return (
    <Card className="w-full max-w-2xl border-none bg-transparent shadow-none">
      <CardContent className="p-0">
        <header className="mb-7 space-y-1.5">
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            {t('signUpHeading')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('signUpSubtitle', { brand: 'ProctiraERP' })}
          </p>
        </header>

        {formError && (
          <Alert
            variant="destructive"
            className="mb-4"
            data-testid="signup-form-error"
          >
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        {rolesError && !formError && (
          <Alert
            variant="warning"
            className="mb-4"
            data-testid="signup-roles-error"
          >
            <AlertDescription>{rolesError}</AlertDescription>
          </Alert>
        )}

        <form
          onSubmit={handleSubmit}
          noValidate
          aria-label={t('signUp')}
          className="space-y-5"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={fieldIds.fullName}>{t('fullName')}</Label>
              <Input
                id={fieldIds.fullName}
                name="fullName"
                type="text"
                autoComplete="name"
                required
                disabled={isSubmitting}
                placeholder={t('fullNamePlaceholder')}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                aria-invalid={errors.fullName ? 'true' : undefined}
                aria-describedby={
                  errors.fullName ? `${fieldIds.fullName}-error` : undefined
                }
              />
              {errors.fullName && (
                <p
                  id={`${fieldIds.fullName}-error`}
                  data-testid="signup-fullName-error"
                  className="text-xs text-destructive"
                >
                  {errors.fullName}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={fieldIds.email}>{t('emailAddress')}</Label>
              <Input
                id={fieldIds.email}
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={isSubmitting}
                placeholder="you@example.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={
                  errors.email ? `${fieldIds.email}-error` : undefined
                }
              />
              {errors.email && (
                <p
                  id={`${fieldIds.email}-error`}
                  data-testid="signup-email-error"
                  className="text-xs text-destructive"
                >
                  {errors.email}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={fieldIds.institution}>
                {t('institutionName')}
              </Label>
              <Input
                id={fieldIds.institution}
                name="institutionName"
                type="text"
                autoComplete="organization"
                required
                disabled={isSubmitting}
                placeholder={t('institutionNamePlaceholder')}
                value={institutionName}
                onChange={(e) => setInstitutionName(e.target.value)}
                aria-invalid={errors.institution ? 'true' : undefined}
                aria-describedby={
                  errors.institution
                    ? `${fieldIds.institution}-error`
                    : undefined
                }
              />
              {errors.institution && (
                <p
                  id={`${fieldIds.institution}-error`}
                  data-testid="signup-institution-error"
                  className="text-xs text-destructive"
                >
                  {errors.institution}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={fieldIds.role}>{t('yourRole')}</Label>
              <RolePicker
                id={fieldIds.role}
                value={roleId}
                onValueChange={(value) => {
                  setRoleId(value);
                  setErrors((e) => ({ ...e, role: undefined }));
                }}
                roles={roles}
                loading={rolesLoading}
                disabled={isSubmitting}
                placeholder={t('selectRole')}
                loadingPlaceholder={tCommon('loading')}
                ariaLabel={t('yourRole')}
                ariaInvalid={Boolean(errors.role)}
                ariaDescribedBy={
                  errors.role ? `${fieldIds.role}-error` : undefined
                }
                data-testid="signup-role-trigger"
              />
              {errors.role && (
                <p
                  id={`${fieldIds.role}-error`}
                  data-testid="signup-role-error"
                  className="text-xs text-destructive"
                >
                  {errors.role}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={fieldIds.password}>{t('password')}</Label>
              <div className="relative">
                <Input
                  id={fieldIds.password}
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  disabled={isSubmitting}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={errors.password ? 'true' : undefined}
                  aria-describedby={`${fieldIds.meter} ${
                    errors.password ? `${fieldIds.password}-error` : ''
                  }`.trim()}
                  className="pe-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute end-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  aria-label={
                    showPassword ? t('hidePassword') : t('showPassword')
                  }
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p
                  id={`${fieldIds.password}-error`}
                  data-testid="signup-password-error"
                  className="text-xs text-destructive"
                >
                  {errors.password}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={fieldIds.confirmPassword}>
                {t('confirmPassword')}
              </Label>
              <div className="relative">
                <Input
                  id={fieldIds.confirmPassword}
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  disabled={isSubmitting}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={errors.confirmPassword ? 'true' : undefined}
                  aria-describedby={
                    errors.confirmPassword
                      ? `${fieldIds.confirmPassword}-error`
                      : undefined
                  }
                  className="pe-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute end-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  aria-label={
                    showConfirmPassword
                      ? t('hidePassword')
                      : t('showPassword')
                  }
                  tabIndex={-1}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {errors.confirmPassword && (
                <p
                  id={`${fieldIds.confirmPassword}-error`}
                  data-testid="signup-confirm-password-error"
                  className="text-xs text-destructive"
                >
                  {errors.confirmPassword}
                </p>
              )}
            </div>
          </div>

          {password && (
            <PasswordStrengthMeter
              id={fieldIds.meter}
              grade={grade}
              rules={meterRules}
              ratingLabel={ratingLabel(grade.rating)}
              data-testid="signup-password-meter"
            />
          )}

          <div className="space-y-2">
            <label
              className="flex items-start gap-3 text-sm leading-relaxed"
              htmlFor={fieldIds.terms}
            >
              <Checkbox
                id={fieldIds.terms}
                checked={agreedToTerms}
                onCheckedChange={(value) => handleTermsToggle(value === true)}
                aria-describedby={
                  errors.terms ? `${fieldIds.terms}-error` : undefined
                }
                data-testid="signup-terms"
              />
              <span className="text-foreground">
                {t('agreeToTerms', { terms: '__TERMS__', privacy: '__PRIVACY__' })
                  .split(/(__TERMS__|__PRIVACY__)/)
                  .map((segment, index) => {
                    if (segment === '__TERMS__') {
                      return (
                        <Link
                          key={`terms-${index}`}
                          href="/legal/terms"
                          className="font-medium text-accent hover:underline"
                        >
                          {t('termsLinkLabel')}
                        </Link>
                      );
                    }
                    if (segment === '__PRIVACY__') {
                      return (
                        <Link
                          key={`privacy-${index}`}
                          href="/legal/privacy"
                          className="font-medium text-accent hover:underline"
                        >
                          {t('privacyLinkLabel')}
                        </Link>
                      );
                    }
                    return <span key={`text-${index}`}>{segment}</span>;
                  })}
              </span>
            </label>
            {errors.terms && (
              <p
                id={`${fieldIds.terms}-error`}
                data-testid="signup-terms-error"
                className="text-xs text-destructive"
              >
                {errors.terms}
              </p>
            )}
          </div>

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full"
            data-testid="signup-submit"
          >
            {isSubmitting && (
              <Loader2
                className="me-2 h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            )}
            {isSubmitting ? t('creatingAccount') : t('signUp')}
          </Button>
        </form>

        {OAUTH_PROVIDERS.length > 0 && (
          <>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  {t('orSignUpWith')}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {OAUTH_PROVIDERS.map((provider) => (
                <Button
                  key={provider.id}
                  variant="outline"
                  className="w-full justify-center gap-2"
                  asChild
                  disabled={isSubmitting}
                >
                  <a
                    href={getOAuthAuthorizeUrl(provider.id, returnTo)}
                    data-testid={`signup-oauth-${provider.id}`}
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

        <p className="mt-8 text-center text-sm text-muted-foreground">
          {t('alreadyHaveAccount')}{' '}
          <Link
            href={`/login${returnTo !== '/' ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`}
            className="font-medium text-accent hover:underline"
          >
            {t('signInLink')}
          </Link>
        </p>
        {/* Reference router so unused-var doesn't fire — preserved for
            future post-success client-side navigation parity with the
            login form. */}
        <span hidden aria-hidden="true">{router ? '' : ''}</span>
      </CardContent>
    </Card>
  );
}
