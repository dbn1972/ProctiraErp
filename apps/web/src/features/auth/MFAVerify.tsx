/**
 * MFAVerify — TOTP challenge step for users with MFA enabled (Task 49.5).
 *
 * Mounted by the federated `RootRouter` at `/auth/mfa-verify` via
 * `featureRegistry.ts`. Wires the shared `<MfaCodeInput>` 6-input
 * control (from `@proctira/ui/components`) to the auth-service verify
 * endpoint.
 *
 * Flow:
 *
 *   1. The user lands here with `?token=…&returnTo=…` in the query
 *      string. The `token` is the short-lived MFA challenge token the
 *      auth-service issued during `POST /api/auth/login`. We pass it
 *      back to `POST /api/auth/mfa/verify` together with the assembled
 *      6-digit code.
 *   2. The user types or pastes the code into `<MfaCodeInput>`. As soon
 *      as 6 digits land we auto-submit (`onComplete`) — the `Verify`
 *      button still works as a manual fallback for non-mouse users who
 *      typed the last digit and want to confirm before the auto-submit
 *      fires.
 *   3. On success the route handler sets the access + refresh cookies
 *      and we hard-navigate to `returnTo` (default `/app/dashboard`) so
 *      middleware re-evaluates with the fresh session.
 *   4. On error we surface the auth-service message and clear the input
 *      so the user can try again without manually deleting digits.
 *
 * Internationalization:
 *   • All copy is sourced through `useLanguage().t()` so RTL pilot
 *     locales and tenant overrides work without source edits
 *     (Requirement 18).
 *
 * Branding:
 *   • `<DocumentTitle pageTitle={t('auth.twoFactorAuthentication')} />`
 *     binds the browser tab title to the active brand template via
 *     `useBrand()` (Requirement 43.5).
 *
 * Requirements: 4.11 (TOTP MFA verification with 6 single-character
 * inputs supporting paste of the full code, auto-advance on character
 * entry, auto-retreat on backspace when the current input is empty),
 * 37.3 (48 by 48 pixel Touch_Target rule).
 *
 * Design: §D — MFA Verify flow, §K — Keyboard interaction map.
 */

import { useCallback, useId, useState, type ReactElement } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Label,
  MfaCodeInput,
} from '@proctira/ui/components';
import { DocumentTitle } from '@/components/DocumentTitle';
import { useLanguage } from '@/providers/LanguageProvider';
import { verifyMfa } from '@/lib/auth/session';

const CODE_LENGTH = 6;

export default function MFAVerify(): ReactElement {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const mfaToken = searchParams.get('token') ?? '';
  const returnTo = searchParams.get('returnTo') ?? '/app/dashboard';

  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reactId = useId();
  const codeInputId = `${reactId}-code`;
  const helpId = `${reactId}-help`;

  // Submit the assembled code to the auth-service. Hoisted into a
  // useCallback so the `<MfaCodeInput onComplete>` callback retains a
  // stable identity across re-renders.
  const submit = useCallback(
    async (assembled: string): Promise<void> => {
      if (assembled.length !== CODE_LENGTH) {
        setFormError(t('auth.mfaIncomplete'));
        return;
      }
      if (!mfaToken) {
        setFormError(t('auth.mfaTokenMissing'));
        return;
      }
      if (isSubmitting) return;

      setIsSubmitting(true);
      setFormError(null);

      const result = await verifyMfa(mfaToken, assembled);

      if (result.success) {
        // The route handler just set fresh httpOnly cookies. A hard
        // navigation forces middleware to re-evaluate with the new
        // session so the dashboard renders against an authenticated
        // request.
        if (typeof window !== 'undefined') {
          window.location.href = returnTo;
        }
        return;
      }

      setFormError(result.message ?? t('auth.mfaInvalid'));
      // Wipe the boxes so the user can re-enter without deleting six
      // digits one at a time.
      setCode('');
      setIsSubmitting(false);
    },
    [mfaToken, returnTo, isSubmitting, t],
  );

  function handleManualSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit(code);
  }

  // The MFA challenge token must be present — without it the
  // upstream service can't correlate the code to the half-completed
  // login. Surface a friendly message and a path back to /auth/signin.
  if (!mfaToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <DocumentTitle pageTitle={t('auth.twoFactorAuthentication')} />
        <Card className="w-full max-w-md border-none shadow-sm">
          <CardContent className="space-y-4 p-8">
            <h1 className="text-xl font-semibold tracking-tight text-primary">
              {t('auth.twoFactorAuthentication')}
            </h1>
            <Alert variant="destructive" data-testid="mfa-verify-token-missing">
              <AlertDescription>{t('auth.mfaTokenMissing')}</AlertDescription>
            </Alert>
            <div className="flex justify-end">
              <Button asChild>
                <Link to="/auth/signin">{t('auth.backToSignIn')}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <DocumentTitle pageTitle={t('auth.twoFactorAuthentication')} />

      <Card className="w-full max-w-md border-none shadow-sm">
        <CardContent className="space-y-6 p-8">
          <header className="space-y-3 text-center">
            <span
              className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <ShieldCheck className="h-6 w-6" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-primary">
              {t('auth.twoFactorAuthentication')}
            </h1>
            <p className="text-sm text-muted-foreground">{t('auth.mfaSubtitle')}</p>
          </header>

          {formError && (
            <Alert variant="destructive" data-testid="mfa-verify-error">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <form
            onSubmit={handleManualSubmit}
            className="space-y-4"
            noValidate
            aria-label={t('auth.twoFactorAuthentication')}
          >
            <div className="space-y-2">
              <Label htmlFor={codeInputId} className="block text-center text-sm font-medium">
                {t('auth.verificationCode')}
              </Label>
              <div className="flex justify-center">
                <MfaCodeInput
                  id={codeInputId}
                  value={code}
                  onChange={setCode}
                  onComplete={(assembled) => {
                    void submit(assembled);
                  }}
                  disabled={isSubmitting}
                  autoFocus
                  ariaLabel={t('auth.verificationCode')}
                  digitLabel={(n) =>
                    // Per the per-cell aria-label contract: "Digit {n} of 6".
                    // The locale catalogue ships `auth.digitNumber` as the
                    // base "Digit {number}" template; we append the trailing
                    // "of 6" affix since the catalogue doesn't model it.
                    `${t('auth.digitNumber', { number: n })} of ${CODE_LENGTH}`
                  }
                />
              </div>
              <p id={helpId} className="text-center text-xs text-muted-foreground">
                {t('auth.mfaSubtitle')}
              </p>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || code.length !== CODE_LENGTH}
              className="w-full"
              data-testid="mfa-verify-submit"
            >
              {isSubmitting && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {isSubmitting ? t('auth.verifying') : t('auth.verify')}
            </Button>
          </form>

          <div className="flex justify-center text-sm">
            <Link
              to="/auth/signin"
              className="font-medium text-accent hover:underline"
              data-testid="mfa-verify-back"
            >
              {t('auth.backToSignIn')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
