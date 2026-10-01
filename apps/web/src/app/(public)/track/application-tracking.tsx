'use client';

import * as React from 'react';
import { useCallback, useId, useState } from 'react';
import { Loader2, Search } from 'lucide-react';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
} from '@proctira/ui/components';

import { useLanguage } from '@/providers/LanguageProvider';
import {
  type ApplicationStatus,
  type ApplicationTrackingResult,
  type GetApplicationByTrackingNumberResult,
  getApplicationByTrackingNumber,
} from '@/lib/api/registration';

/**
 * Public Application Tracking client (Requirement 16.6, 16.11 / Task 51.4).
 *
 * Renders the tracking-number + date-of-birth entry form and the results view
 * (status, institution, reviewer remarks, waitlist position, booked interviews).
 * PRC-H029: the backend requires the applicant's DOB so a tracking number alone
 * cannot disclose applicant data.
 * All copy is routed through `useLanguage().t()` so RTL locales and tenant
 * branding work without source edits.
 *
 * The page deliberately keeps a single component holding both the form
 * and result so the user can iterate (search → not_found → search again)
 * without unmounting the form.
 */

/** Fetcher signature exposed for tests. */
export type TrackingFetcher = (
  trackingNumber: string,
  dateOfBirth: string,
) => Promise<GetApplicationByTrackingNumberResult>;

export interface ApplicationTrackingProps {
  /** Override the API call (used by tests to mock the backend). */
  fetcher?: TrackingFetcher;
  /** Pre-fill the input (useful for shareable links). */
  initialTrackingNumber?: string;
}

/** Tagged UI state. Drives which view is visible. */
type ViewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'result'; data: ApplicationTrackingResult }
  | { kind: 'not_found'; trackingNumber: string }
  | { kind: 'error'; trackingNumber: string };

export function ApplicationTracking({
  fetcher,
  initialTrackingNumber = '',
}: ApplicationTrackingProps): JSX.Element {
  const { t } = useLanguage();
  const inputId = useId();
  const dobId = useId();

  const [trackingNumber, setTrackingNumber] = useState(initialTrackingNumber);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [dobError, setDobError] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ kind: 'idle' });

  const lookup = useCallback(
    async (raw: string, rawDob: string) => {
      const trimmed = raw.trim();
      const dob = rawDob.trim();
      const numberMissing = trimmed.length === 0;
      const dobMissing = !/^\d{4}-\d{2}-\d{2}$/.test(dob);
      setValidationError(numberMissing ? t('tracking.trackingNumberRequired') : null);
      setDobError(dobMissing ? t('tracking.dateOfBirthRequired') : null);
      if (numberMissing || dobMissing) return;
      setView({ kind: 'loading' });

      const call = fetcher ? fetcher(trimmed, dob) : getApplicationByTrackingNumber(trimmed, dob);
      const result = await call;

      if (result.kind === 'ok') {
        setView({ kind: 'result', data: result.data });
      } else if (result.kind === 'not_found') {
        setView({ kind: 'not_found', trackingNumber: trimmed });
      } else {
        setView({ kind: 'error', trackingNumber: trimmed });
      }
    },
    [fetcher, t],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void lookup(trackingNumber, dateOfBirth);
    },
    [lookup, trackingNumber, dateOfBirth],
  );

  const handleReset = useCallback(() => {
    setView({ kind: 'idle' });
    setValidationError(null);
    setDobError(null);
  }, []);

  const isLoading = view.kind === 'loading';

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <form
            onSubmit={handleSubmit}
            noValidate
            aria-busy={isLoading}
            data-testid="tracking-form"
          >
            <div className="space-y-2">
              <Label htmlFor={inputId}>{t('tracking.trackingNumberLabel')}</Label>
              <Input
                id={inputId}
                name="trackingNumber"
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder={t('tracking.trackingNumberPlaceholder')}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                required
                aria-required="true"
                aria-invalid={validationError !== null}
                aria-describedby={validationError ? `${inputId}-error` : undefined}
                disabled={isLoading}
                className="h-12 min-h-12"
              />
              {validationError !== null && (
                <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">
                  {validationError}
                </p>
              )}
            </div>

            <div className="mt-4 space-y-2">
              <Label htmlFor={dobId}>{t('tracking.dateOfBirthLabel')}</Label>
              <Input
                id={dobId}
                name="dateOfBirth"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                autoComplete="bday"
                required
                aria-required="true"
                aria-invalid={dobError !== null}
                aria-describedby={dobError ? `${dobId}-error` : `${dobId}-hint`}
                disabled={isLoading}
                className="h-12 min-h-12"
              />
              <p id={`${dobId}-hint`} className="text-xs text-muted-foreground">
                {t('tracking.dateOfBirthHint')}
              </p>
              {dobError !== null && (
                <p id={`${dobId}-error`} role="alert" className="text-sm text-destructive">
                  {dobError}
                </p>
              )}
            </div>

            <Button type="submit" className="mt-4 w-full" disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="me-2 h-4 w-4" aria-hidden="true" />
              )}
              {isLoading ? t('tracking.checking') : t('tracking.checkStatus')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {view.kind === 'not_found' && (
        <NotFoundView trackingNumber={view.trackingNumber} onReset={handleReset} />
      )}

      {view.kind === 'error' && (
        <ErrorView
          onRetry={() => {
            void lookup(view.trackingNumber, dateOfBirth);
          }}
        />
      )}

      {view.kind === 'result' && <ResultView data={view.data} />}
    </div>
  );
}

// ─── Result view ───────────────────────────────────────────────────────────

function ResultView({ data }: { data: ApplicationTrackingResult }): JSX.Element {
  const { t } = useLanguage();

  return (
    <Card data-testid="tracking-result">
      <CardContent className="space-y-6 p-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-xs text-muted-foreground">#{data.trackingNumber}</p>
            <h2 className="mt-1 text-xl font-semibold text-foreground">
              {t('tracking.currentStatus')}
            </h2>
          </div>
          <StatusBadge status={data.status} />
        </header>

        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          {data.institutionName && (
            <Field label={t('tracking.institution')} value={data.institutionName} />
          )}
          {data.submittedAt && (
            <Field label={t('tracking.submittedAt')} value={formatTimestamp(data.submittedAt)} />
          )}
          {data.updatedAt && (
            <Field label={t('tracking.lastUpdated')} value={formatTimestamp(data.updatedAt)} />
          )}
          {data.waitlistPosition !== undefined && (
            <Field label={t('tracking.waitlistPosition')} value={String(data.waitlistPosition)} />
          )}
        </dl>

        {data.remarks && (
          <Section title={t('tracking.remarks')}>
            <p className="text-sm text-foreground" data-testid="tracking-remarks">
              {data.remarks}
            </p>
          </Section>
        )}

        <Section title={t('tracking.interviews')}>
          {data.interviewBookings.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="interviews-empty">
              {t('tracking.interviewsEmpty')}
            </p>
          ) : (
            <p className="text-sm text-foreground" data-testid="interviews-booked">
              {t('tracking.interviewsBooked', { count: data.interviewBookings.length })}
            </p>
          )}
        </Section>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{value}</dd>
    </div>
  );
}

// ─── Status badge ──────────────────────────────────────────────────────────

interface StatusVariant {
  variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive';
  labelKey: string;
}

const STATUS_VARIANTS: Record<string, StatusVariant> = {
  pending: { variant: 'secondary', labelKey: 'tracking.statusPending' },
  under_review: { variant: 'warning', labelKey: 'tracking.statusUnderReview' },
  approved: { variant: 'success', labelKey: 'tracking.statusApproved' },
  rejected: { variant: 'destructive', labelKey: 'tracking.statusRejected' },
  waitlisted: { variant: 'warning', labelKey: 'tracking.statusWaitlisted' },
};

function StatusBadge({ status }: { status: ApplicationStatus }): JSX.Element {
  const { t } = useLanguage();
  const variant = STATUS_VARIANTS[status];
  const label = variant ? t(variant.labelKey) : t('tracking.statusUnknown', { status });
  return (
    <Badge variant={variant?.variant ?? 'outline'} data-testid="status-badge">
      {label}
    </Badge>
  );
}

// ─── Empty / error views ───────────────────────────────────────────────────

function NotFoundView({
  trackingNumber,
  onReset,
}: {
  trackingNumber: string;
  onReset: () => void;
}): JSX.Element {
  const { t } = useLanguage();
  return (
    <Alert variant="warning" data-testid="tracking-not-found">
      <AlertTitle>{t('tracking.notFoundTitle')}</AlertTitle>
      <AlertDescription className="mt-2 space-y-3">
        <p>{t('tracking.notFound')}</p>
        <p className="font-mono text-xs">#{trackingNumber}</p>
        <Button variant="outline" size="sm" onClick={onReset}>
          {t('tracking.newSearch')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function ErrorView({ onRetry }: { onRetry: () => void }): JSX.Element {
  const { t } = useLanguage();
  return (
    <Alert variant="destructive" data-testid="tracking-error">
      <AlertTitle>{t('tracking.errorTitle')}</AlertTitle>
      <AlertDescription className="mt-2 space-y-3">
        <p>{t('tracking.errorMessage')}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('tracking.retry')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  // Locale-aware formatting handled by the browser; the active locale is
  // already on `<html lang>` so this matches the i18n state.
  return parsed.toLocaleString();
}
