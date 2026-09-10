/**
 * SignUp — federated registration screen (Task 49.2).
 *
 * Mounted by the federated `RootRouter` at `/auth/signup` via
 * `featureRegistry.ts`. Renders the personal-information fields, the
 * tenant-driven `<RolePicker>` (Task 49.2 / Requirement 4 AC 17), the
 * shared `<PasswordStrengthMeter>` (Task 49.2 / Requirement 4 AC 14), the
 * required Terms of Service / Privacy Policy acceptance checkbox, and
 * the same Google / Microsoft / Apple federated buttons used by SignIn
 * (Task 49.1) so a user can create their account through any supported
 * channel.
 *
 * Wiring:
 *   • Roles loaded from `GET /api/tenant/signup-roles` (proxied to the
 *     upstream `/api/v1/tenant/signup-roles` per Requirement 4 AC 17)
 *     via `fetchSignupRoles()` from `@/lib/api/auth`.
 *   • Submit posts to `POST /api/auth/signup` via `signUp()` from the
 *     same module. The terms-acceptance audit row required by
 *     Requirement 4 AC 15 is persisted in the same call — the request
 *     body carries `termsAcceptance: { acceptedAt, termsVersion,
 *     privacyVersion }` so the Auth Service writes the canonical
 *     `auth_terms_acceptances` row keyed by the new user identifier
 *     (Design §D).
 *   • Federated buttons reuse `buildOAuthHref()` from SignIn so the
 *     credential bridge stays a single component (Task 49.1 / Req 4.16).
 *
 * Internationalization:
 *   • All copy is sourced through `useLanguage().t()` so RTL pilot
 *     locales and tenant overrides work without source edits
 *     (Requirement 18).
 *
 * Branding:
 *   • `<DocumentTitle pageTitle={t('auth.signUp')} />` binds the browser
 *     tab title to the active brand template via `useBrand()`
 *     (Requirement 43.5).
 *
 * Password strength scoring:
 *   • Uses the canonical `scorePassword()` /
 *     `scorePasswordDetails()` helpers from `@proctira/auth`
 *     (Task 49.6, Requirement 4 AC 14). The same algorithm runs
 *     server-side on `POST /api/v1/auth/signup` so a hand-rolled HTTP
 *     client cannot bypass the meter.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { scorePasswordDetails, type PasswordScoreDetails } from '@proctira/auth';
import { OAuthIcon } from '@/components/auth/oauth-icon';
import { DocumentTitle } from '@/components/DocumentTitle';
import { useLanguage } from '@/providers/LanguageProvider';
import { useBrand } from '@/providers/BrandConfigProvider';
import {
  DEFAULT_PRIVACY_VERSION,
  DEFAULT_TERMS_VERSION,
  fetchSignupRoles,
  signUp,
  type SignupRole,
} from '@/lib/api/auth';
import { buildOAuthHref } from './SignIn';

// ─── Federated provider catalog ─────────────────────────────────────────────

type FederatedProviderId = 'google' | 'microsoft' | 'apple';

interface FederatedProvider {
  id: FederatedProviderId;
  name: string;
  icon: FederatedProviderId;
}

const FEDERATED_PROVIDERS: readonly FederatedProvider[] = [
  { id: 'google', name: 'Google', icon: 'google' },
  { id: 'microsoft', name: 'Microsoft', icon: 'microsoft' },
  { id: 'apple', name: 'Apple', icon: 'apple' },
] as const;

// ─── Password scoring ───────────────────────────────────────────────────────

/**
 * UI rule presented in the `<PasswordStrengthMeter>` checklist. The
 * underlying scoring is delegated to `scorePasswordDetails()` from
 * `@proctira/auth` (Task 49.6); this list only describes the
 * checklist labels and which `checks.*` flag each row reflects.
 */
interface PasswordRule {
  /** Translation key (under `auth.*`) describing the rule. */
  labelKey: string;
  /** Selector returning whether the rule is satisfied for a given score. */
  satisfied: (details: PasswordScoreDetails) => boolean;
}

const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    labelKey: 'auth.passwordRuleLength',
    satisfied: (d) => d.checks.length8,
  },
  {
    labelKey: 'auth.passwordRuleUppercase',
    satisfied: (d) => d.checks.uppercase,
  },
  {
    labelKey: 'auth.passwordRuleLowercase',
    satisfied: (d) => d.checks.lowercase,
  },
  {
    labelKey: 'auth.passwordRuleNumber',
    satisfied: (d) => d.checks.digit,
  },
  {
    labelKey: 'auth.passwordRuleSymbol',
    satisfied: (d) => d.checks.symbol,
  },
] as const;

/**
 * Adapts the canonical `scorePasswordDetails()` output to the
 * `<PasswordStrengthMeter>` `PasswordGrade` shape (rating + satisfied
 * rule count + meter percent). The meter is presentational; the
 * actual scoring lives in `@proctira/auth` so the same algorithm
 * runs server-side on `POST /api/v1/auth/signup` (Requirement 4 AC 14).
 */
export function gradePassword(password: string): PasswordGrade {
  if (!password) {
    return { rating: 'weak', satisfied: 0, percent: 0 };
  }
  const details = scorePasswordDetails(password);
  const satisfied = PASSWORD_RULES.reduce((n, rule) => (rule.satisfied(details) ? n + 1 : n), 0);
  const percent = Math.round((satisfied / PASSWORD_RULES.length) * 100);
  return { rating: details.rating, satisfied, percent };
}

// ─── SignUp page ────────────────────────────────────────────────────────────

interface FieldErrors {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  institution?: string;
  role?: string;
  terms?: string;
}

export default function SignUp(): ReactElement {
  const { t } = useLanguage();
  const { name: brandName } = useBrand();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo') ?? '/app/dashboard';

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
  // tenant requires email verification (`requiresApproval` may also be set).
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);

  // Role catalog.
  const [roles, setRoles] = useState<SignupRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);

  // Stable id prefix so the password meter can describe the password input
  // and the rule list without DOM collisions when multiple SignUp pages
  // render in tests / Storybook.
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
  // reflects the moment the user actually consented (Requirement 4 AC 15).
  // Cleared on uncheck so a stale timestamp can never be submitted.
  const termsAcceptedAtRef = useRef<string | null>(null);

  // ─── Role catalog fetch ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setRolesLoading(true);
    setRolesError(null);
    void fetchSignupRoles(controller.signal).then((result) => {
      if (cancelled) return;
      if (result.error && result.error !== 'aborted') {
        setRolesError(t('auth.rolesUnavailable'));
      }
      setRoles(result.roles);
      setRolesLoading(false);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // We deliberately only fetch on mount; the role catalog rarely changes
    // and is cached on the proxy for 60s. We exclude `t` from the deps so
    // a locale change does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grade = gradePassword(password);
  const passwordDetails = useMemo(() => scorePasswordDetails(password), [password]);

  function ratingLabel(rating: PasswordRating): string {
    switch (rating) {
      case 'strong':
        return t('auth.passwordStrengthStrong');
      case 'good':
        return t('auth.passwordStrengthGood');
      case 'fair':
        return t('auth.passwordStrengthFair');
      default:
        return t('auth.passwordStrengthWeak');
    }
  }

  // Rule list passed to the shared `<PasswordStrengthMeter>` — translated
  // labels + per-rule satisfaction so the meter stays locale-agnostic.
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
    if (!fullName.trim()) next.fullName = t('auth.fullNameRequired');
    if (!email.trim()) next.email = t('auth.emailRequired');
    else if (!isLikelyEmail(email)) next.email = t('auth.emailInvalid');
    if (!institutionName.trim()) next.institution = t('auth.institutionNameRequired');
    if (!roleId) next.role = t('auth.roleRequired');
    if (!password) next.password = t('auth.passwordRequired');
    else if (grade.rating === 'weak') next.password = t('auth.passwordTooWeak');
    if (!confirmPassword) next.confirmPassword = t('auth.confirmPasswordRequired');
    else if (password && confirmPassword !== password)
      next.confirmPassword = t('auth.passwordsDoNotMatch');
    if (!agreedToTerms) next.terms = t('auth.termsRequired');
    return next;
  }

  function handleTermsToggle(checked: boolean): void {
    setAgreedToTerms(checked);
    termsAcceptedAtRef.current = checked ? new Date().toISOString() : null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    const acceptedAt = termsAcceptedAtRef.current ?? new Date().toISOString();

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
      // When the tenant flow returns an email-verification confirmation
      // (or the new account requires admin approval) we surface a
      // success screen rather than redirecting straight into the app.
      if (result.requiresApproval || result.message) {
        setConfirmedEmail(result.email ?? email);
        setIsSubmitting(false);
        return;
      }
      // Otherwise navigate to the post-signup destination via a hard
      // navigation so middleware re-evaluates with any new cookies.
      if (typeof window !== 'undefined') {
        window.location.href = returnTo;
      } else {
        navigate(returnTo);
      }
      return;
    }

    setFormError(result.message ?? t('auth.signUpFailed'));
    setIsSubmitting(false);
  }

  // ─── Confirmation screen ────────────────────────────────────────────────
  if (confirmedEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <DocumentTitle pageTitle={t('auth.signUp')} />
        <Card className="w-full max-w-md border-none shadow-sm">
          <CardContent className="p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <MailCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-primary">
              {t('auth.accountCreatedTitle')}
            </h1>
            <p
              className="mt-2 text-sm text-muted-foreground"
              data-testid="signup-confirmation-message"
            >
              {t('auth.checkYourEmailToActivate', { email: confirmedEmail })}
            </p>
            <Button asChild variant="link" className="mt-6" data-testid="signup-confirmation-back">
              <Link to="/auth/signin">{t('auth.backToSignIn')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Sign-up form ───────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <DocumentTitle pageTitle={t('auth.signUp')} />

      <Card className="w-full max-w-2xl border-none shadow-sm">
        <CardContent className="p-8">
          <header className="mb-6 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-primary">
              {t('auth.signUpHeading')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('auth.signUpSubtitle', { brand: brandName })}
            </p>
          </header>

          {formError && (
            <Alert variant="destructive" className="mb-4" data-testid="signup-form-error">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          {rolesError && !formError && (
            <Alert variant="warning" className="mb-4" data-testid="signup-roles-error">
              <AlertDescription>{rolesError}</AlertDescription>
            </Alert>
          )}

          <form
            onSubmit={handleSubmit}
            noValidate
            aria-label={t('auth.signUp')}
            className="space-y-5"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={fieldIds.fullName}>{t('auth.fullName')}</Label>
                <Input
                  id={fieldIds.fullName}
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  disabled={isSubmitting}
                  placeholder={t('auth.fullNamePlaceholder')}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  aria-invalid={errors.fullName ? 'true' : undefined}
                  aria-describedby={errors.fullName ? `${fieldIds.fullName}-error` : undefined}
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
                <Label htmlFor={fieldIds.email}>{t('auth.emailAddress')}</Label>
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
                  aria-describedby={errors.email ? `${fieldIds.email}-error` : undefined}
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
                <Label htmlFor={fieldIds.institution}>{t('auth.institutionName')}</Label>
                <Input
                  id={fieldIds.institution}
                  name="institutionName"
                  type="text"
                  autoComplete="organization"
                  required
                  disabled={isSubmitting}
                  placeholder={t('auth.institutionNamePlaceholder')}
                  value={institutionName}
                  onChange={(e) => setInstitutionName(e.target.value)}
                  aria-invalid={errors.institution ? 'true' : undefined}
                  aria-describedby={
                    errors.institution ? `${fieldIds.institution}-error` : undefined
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
                <Label htmlFor={fieldIds.role}>{t('auth.yourRole')}</Label>
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
                  placeholder={t('auth.selectRole')}
                  loadingPlaceholder={t('common.loading')}
                  ariaLabel={t('auth.yourRole')}
                  ariaInvalid={Boolean(errors.role)}
                  ariaDescribedBy={errors.role ? `${fieldIds.role}-error` : undefined}
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
                <Label htmlFor={fieldIds.password}>{t('auth.password')}</Label>
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
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
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
                <Label htmlFor={fieldIds.confirmPassword}>{t('auth.confirmPassword')}</Label>
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
                      errors.confirmPassword ? `${fieldIds.confirmPassword}-error` : undefined
                    }
                    className="pe-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute end-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                    aria-label={
                      showConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')
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

            {/* Shared `<PasswordStrengthMeter>` (Requirement 4 AC 14).
                Driven by `scorePasswordDetails()` from `@proctira/auth`
                — the same algorithm runs server-side on
                `POST /api/v1/auth/signup` so submitting a `weak`
                password returns 422 even if the meter is bypassed. */}
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
                  aria-describedby={errors.terms ? `${fieldIds.terms}-error` : undefined}
                  data-testid="signup-terms"
                />
                <span className="text-foreground">
                  {t('auth.agreeToTerms', {
                    /* The ICU template renders these tokens verbatim; we
                       restore the link styling by post-processing the
                       output below via a manual split so there is no XSS
                       surface. The translated string is expected to use
                       literal `{terms}` and `{privacy}` placeholders. */
                    terms: '__TERMS__',
                    privacy: '__PRIVACY__',
                  })
                    .split(/(__TERMS__|__PRIVACY__)/)
                    .map((segment, index) => {
                      if (segment === '__TERMS__') {
                        return (
                          <Link
                            key={`terms-${index}`}
                            to="/legal/terms"
                            className="font-medium text-accent hover:underline"
                          >
                            {t('auth.termsLinkLabel')}
                          </Link>
                        );
                      }
                      if (segment === '__PRIVACY__') {
                        return (
                          <Link
                            key={`privacy-${index}`}
                            to="/legal/privacy"
                            className="font-medium text-accent hover:underline"
                          >
                            {t('auth.privacyLinkLabel')}
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
              {isSubmitting && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {isSubmitting ? t('auth.creatingAccount') : t('auth.signUp')}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">{t('auth.orSignUpWith')}</span>
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
                  data-testid={`signup-oauth-${provider.id}`}
                >
                  <OAuthIcon provider={provider.icon} />
                  <span>{t('auth.continueWith', { provider: provider.name })}</span>
                </a>
              </Button>
            ))}
          </div>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            {t('auth.alreadyHaveAccount')}{' '}
            <Link to="/auth/signin" className="font-medium text-accent hover:underline">
              {t('auth.signInLink')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Cheap email shape check. We deliberately mirror the helper in
 * `<SignIn>` rather than import it (the SignIn version is a private
 * helper) so the two screens never accidentally diverge on what counts
 * as a syntactically plausible address.
 */
function isLikelyEmail(value: string): boolean {
  const trimmed = value.trim();
  const at = trimmed.indexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return false;
  const dotInDomain = trimmed.indexOf('.', at + 1);
  return dotInDomain > at + 1 && dotInDomain < trimmed.length - 1;
}
