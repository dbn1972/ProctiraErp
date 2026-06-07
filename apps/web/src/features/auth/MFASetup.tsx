/**
 * MFASetup — first-time TOTP enrolment with backup codes (Task 49.4).
 *
 * Mounted by the federated `RootRouter` at `/auth/mfa-setup` via
 * `featureRegistry.ts`. Implements the full enrolment loop described in
 * design.md §D — MFA Setup flow:
 *
 *   1. POST /api/v1/auth/mfa/setup → { otpauth_uri, secret, backup_codes[10] }
 *      (Today this is mocked client-side via `setupMfa()` until the route
 *      handler is deployed; see `lib/api/auth.ts`.)
 *   2. Render the QR canvas, plain-text fallback secret, and the backup
 *      codes panel exactly once. The codes are never re-fetched after the
 *      initial render — that's the point of "one-time" backup codes
 *      (Requirement 4 AC 12).
 *   3. Offer download (.txt) + print (`window.print()`) actions for the
 *      backup codes, and gate the "Finish setup" CTA behind an explicit
 *      acknowledgement checkbox so the user can't dismiss the panel
 *      without confirming they have stored the codes safely.
 *
 * Internationalization:
 *   • All copy is sourced through `useLanguage().t()` so RTL pilot
 *     locales and tenant overrides work without source edits
 *     (Requirement 18).
 *
 * Branding:
 *   • `<DocumentTitle pageTitle={t('auth.mfaSetupTitle')} />` binds the
 *     browser tab title to the active brand template via `useBrand()`
 *     (Requirement 43.5).
 *
 * Requirements: 4.11 (TOTP enrolment + QR rendering), 4.12 (one-time
 * backup codes for account recovery).
 */

import {
  useEffect,
  useId,
  useState,
  type ReactElement,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Download, Loader2, Printer, ShieldCheck } from 'lucide-react';

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Checkbox,
  Label,
} from '@proctira/ui/components';
import { DocumentTitle } from '@/components/DocumentTitle';
import { useLanguage } from '@/providers/LanguageProvider';
import { useBrand } from '@/providers/BrandConfigProvider';
import {
  setupMfa,
  type MfaSetupSuccess,
} from '@/lib/api/auth';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Renders a printable plain-text document for the backup codes. The
 * format is intentionally plain (no markup, no styling) so users can
 * archive the file in any password manager / secret store without
 * depending on a specific viewer.
 */
export function formatBackupCodesDocument(
  codes: readonly string[],
  options: { brandName: string; generatedAt?: Date } = {
    brandName: 'ProctiraERP',
  },
): string {
  const generated = options.generatedAt ?? new Date();
  const header = [
    `${options.brandName} — Multi-factor Authentication`,
    `Backup Codes — generated ${generated.toISOString()}`,
    '',
    'Each code may be used exactly once. Store this document somewhere safe.',
    '',
  ];
  const body = codes.map((code, index) => `${index + 1}.  ${code}`);
  return [...header, ...body, ''].join('\n');
}

/**
 * Triggers a browser-side download of the supplied text under
 * `filename`. No-ops on the server. Exported so the screen and any
 * future "regenerate codes" surface share the same plumbing.
 */
export function downloadTextFile(text: string, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Defer revocation so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

// ─── Page ───────────────────────────────────────────────────────────────────

type EnrolmentState =
  | { status: 'loading' }
  | { status: 'ready'; data: MfaSetupSuccess }
  | { status: 'error'; message: string };

export default function MFASetup(): ReactElement {
  const { t } = useLanguage();
  const { name: brandName } = useBrand();
  const navigate = useNavigate();

  const [enrolment, setEnrolment] = useState<EnrolmentState>({
    status: 'loading',
  });
  const [acknowledged, setAcknowledged] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  const reactId = useId();
  const ackId = `${reactId}-ack`;
  const secretId = `${reactId}-secret`;

  // ─── Enrolment fetch (runs exactly once on mount) ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void setupMfa({ signal: controller.signal }).then((result) => {
      if (cancelled) return;
      if (result.kind === 'ok') {
        setEnrolment({ status: 'ready', data: result.data });
      } else if (result.message !== 'aborted') {
        setEnrolment({ status: 'error', message: result.message });
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  // ─── Render: loading ──────────────────────────────────────────────────────
  if (enrolment.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <DocumentTitle pageTitle={t('auth.mfaSetupTitle')} />
        <Card className="w-full max-w-md border-none shadow-sm">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <Loader2
              className="h-8 w-8 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">
              {t('auth.mfaSetupLoading')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Render: error ────────────────────────────────────────────────────────
  if (enrolment.status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <DocumentTitle pageTitle={t('auth.mfaSetupTitle')} />
        <Card className="w-full max-w-md border-none shadow-sm">
          <CardContent className="space-y-4 p-8">
            <h1 className="text-xl font-semibold tracking-tight text-primary">
              {t('auth.mfaSetupTitle')}
            </h1>
            <Alert variant="destructive" data-testid="mfa-setup-error">
              <AlertDescription>{t('auth.mfaSetupFailed')}</AlertDescription>
            </Alert>
            <div className="flex justify-between">
              <Button variant="outline" asChild>
                <Link to="/auth/signin">{t('auth.backToSignIn')}</Link>
              </Button>
              <Button
                onClick={() => {
                  setEnrolment({ status: 'loading' });
                  void setupMfa().then((result) => {
                    if (result.kind === 'ok') {
                      setEnrolment({ status: 'ready', data: result.data });
                    } else {
                      setEnrolment({
                        status: 'error',
                        message: result.message,
                      });
                    }
                  });
                }}
              >
                {t('auth.tryAgain')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Render: ready ────────────────────────────────────────────────────────
  const { otpauthUri, secret, backupCodes } = enrolment.data;

  function handleDownload(): void {
    const document = formatBackupCodesDocument(backupCodes, { brandName });
    const filename = `${brandName.toLowerCase().replace(/\s+/g, '-')}-mfa-backup-codes.txt`;
    downloadTextFile(document, filename);
  }

  function handlePrint(): void {
    if (typeof window === 'undefined') return;
    window.print();
  }

  async function handleFinish(): Promise<void> {
    if (!acknowledged || isFinishing) return;
    setIsFinishing(true);
    // The auth-service confirms enrolment via a separate `verify` call
    // that is owned by `<MFAVerify>` (Task 49.5). After the user
    // acknowledges they have stored the backup codes we route them to
    // the verification step where they enter their first 6-digit code.
    navigate('/auth/mfa-verify');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 print:bg-white print:py-0">
      <DocumentTitle pageTitle={t('auth.mfaSetupTitle')} />

      <Card className="w-full max-w-2xl border-none shadow-sm print:shadow-none">
        <CardContent className="space-y-8 p-8">
          <header className="space-y-3 text-center">
            <span
              className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <ShieldCheck className="h-6 w-6" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-primary">
              {t('auth.mfaSetupTitle')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('auth.mfaSetupSubtitle')}
            </p>
          </header>

          {/* ─── QR + secret ───────────────────────────────────────────── */}
          <section
            aria-labelledby={`${reactId}-qr-heading`}
            className="space-y-4 rounded-lg border border-border bg-card p-6"
          >
            <div className="space-y-1">
              <h2
                id={`${reactId}-qr-heading`}
                className="text-base font-semibold text-foreground"
              >
                {t('auth.mfaScanHeading')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('auth.mfaScanDescription')}
              </p>
            </div>

            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div
                className="rounded-md border border-border bg-white p-3"
                data-testid="mfa-setup-qr"
                aria-label={t('auth.mfaQrAlt')}
              >
                <QRCodeSVG
                  value={otpauthUri}
                  size={192}
                  level="M"
                  includeMargin={false}
                />
              </div>

              <div className="flex-1 space-y-3">
                <div className="space-y-1">
                  <Label htmlFor={secretId}>{t('auth.mfaSecretLabel')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('auth.mfaSecretHelp')}
                  </p>
                  <code
                    id={secretId}
                    data-testid="mfa-setup-secret"
                    className="block break-all rounded-md bg-muted p-3 text-sm font-mono tracking-wide text-foreground"
                  >
                    {secret}
                  </code>
                </div>
              </div>
            </div>
          </section>

          {/* ─── Backup codes ─────────────────────────────────────────── */}
          <section
            aria-labelledby={`${reactId}-codes-heading`}
            className="space-y-4 rounded-lg border border-amber-300 bg-amber-50 p-6 print:border-border print:bg-card"
          >
            <div className="space-y-1">
              <h2
                id={`${reactId}-codes-heading`}
                className="text-base font-semibold text-foreground"
              >
                {t('auth.mfaBackupCodesHeading')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('auth.mfaBackupCodesDescription')}
              </p>
            </div>

            <ul
              data-testid="mfa-setup-backup-codes"
              className="grid grid-cols-2 gap-2 rounded-md bg-white p-4 font-mono text-sm tracking-wider text-foreground sm:grid-cols-2"
            >
              {backupCodes.map((code, index) => (
                <li
                  key={code}
                  className="flex items-baseline gap-2"
                  data-testid={`mfa-setup-backup-code-${index}`}
                >
                  <span
                    aria-hidden="true"
                    className="w-6 shrink-0 text-right text-xs text-muted-foreground"
                  >
                    {index + 1}.
                  </span>
                  <span>{code}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-2 sm:flex-row print:hidden">
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={handleDownload}
                data-testid="mfa-setup-download"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {t('auth.mfaDownloadCodes')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={handlePrint}
                data-testid="mfa-setup-print"
              >
                <Printer className="h-4 w-4" aria-hidden="true" />
                {t('auth.mfaPrintCodes')}
              </Button>
            </div>
          </section>

          {/* ─── Acknowledgement + finish ─────────────────────────────── */}
          <section className="space-y-4 print:hidden">
            <label
              htmlFor={ackId}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-card p-4 text-sm text-foreground"
            >
              <Checkbox
                id={ackId}
                checked={acknowledged}
                onCheckedChange={(value) => setAcknowledged(value === true)}
                data-testid="mfa-setup-ack"
                aria-describedby={`${ackId}-help`}
              />
              <span className="space-y-1">
                <span className="font-medium">
                  {t('auth.mfaAcknowledgement')}
                </span>
                <span
                  id={`${ackId}-help`}
                  className="block text-xs text-muted-foreground"
                >
                  {t('auth.mfaAcknowledgementHelp')}
                </span>
              </span>
            </label>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" asChild>
                <Link to="/auth/signin">{t('auth.backToSignIn')}</Link>
              </Button>
              <Button
                type="button"
                disabled={!acknowledged || isFinishing}
                onClick={handleFinish}
                data-testid="mfa-setup-finish"
              >
                {isFinishing && (
                  <Loader2
                    className="me-2 h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                )}
                {t('auth.mfaFinishSetup')}
              </Button>
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
