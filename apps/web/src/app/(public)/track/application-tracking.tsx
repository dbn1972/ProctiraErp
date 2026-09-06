'use client';

import * as React from 'react';
import { useCallback, useId, useMemo, useState } from 'react';
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
  type ApplicationFollowUpAction,
  type ApplicationStatus,
  type ApplicationStatusHistoryEntry,
  type ApplicationTrackingResult,
  type GetApplicationByTrackingNumberResult,
  getApplicationByTrackingNumber,
} from '@/lib/api/registration';

/**
 * Public Application Tracking client (Requirement 16.6, 16.11 / Task 51.4).
 *
 * Renders the tracking-number entry form and the results view (status,
 * status history with timestamps, and any required follow-up actions).
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

  const [trackingNumber, setTrackingNumber] = useState(initialTrackingNumber);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ kind: 'idle' });

  const lookup = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        setValidationError(t('tracking.trackingNumberRequired'));
        return;
      }
      setValidationError(null);
      setView({ kind: 'loading' });

      const call = fetcher
        ? fetcher(trimmed)
        : getApplicationByTrackingNumber(trimmed);
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
      void lookup(trackingNumber);
    },
    [lookup, trackingNumber],
  );

  const handleReset = useCallback(() => {
    setView({ kind: 'idle' });
    setValidationError(null);
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
              <Label htmlFor={inputId}>
                {t('tracking.trackingNumberLabel')}
              </Label>
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
                aria-describedby={
                  validationError ? `${inputId}-error` : undefined
                }
                disabled={isLoading}
                className="h-12 min-h-12"
              />
              {validationError !== null && (
                <p
                  id={`${inputId}-error`}
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {validationError}
                </p>
              )}
            </div>

            <Button
              type="submit"
              className="mt-4 w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2
                  className="me-2 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
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
            void lookup(view.trackingNumber);
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
            <p className="font-mono text-xs text-muted-foreground">
              #{data.trackingNumber}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-foreground">
              {t('tracking.currentStatus')}
            </h2>
          </div>
          <StatusBadge status={data.status} />
        </header>

        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          {data.currentStep && (
            <Field
              label={t('tracking.currentStep')}
              value={data.currentStep}
            />
          )}
          {data.submittedAt && (
            <Field
              label={t('tracking.submittedAt')}
              value={formatTimestamp(data.submittedAt)}
            />
          )}
          {data.updatedAt && (
            <Field
              label={t('tracking.lastUpdated')}
              value={formatTimestamp(data.updatedAt)}
            />
          )}
          {data.expectedCompletionAt && (
            <Field
              label={t('tracking.expectedCompletionAt')}
              value={formatTimestamp(data.expectedCompletionAt)}
            />
          )}
        </dl>

        <Section title={t('tracking.history')}>
          <Timeline entries={data.history} />
        </Section>

        <Section title={t('tracking.followUp')}>
          <FollowUpList actions={data.followUpActions} />
        </Section>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
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
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
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
  const label = variant
    ? t(variant.labelKey)
    : t('tracking.statusUnknown', { status });
  return (
    <Badge variant={variant?.variant ?? 'outline'} data-testid="status-badge">
      {label}
    </Badge>
  );
}

// ─── Timeline ──────────────────────────────────────────────────────────────

function Timeline({
  entries,
}: {
  entries: ApplicationStatusHistoryEntry[];
}): JSX.Element {
  const { t } = useLanguage();

  // Sort newest → oldest for display so the most recent change is at top.
  // Memoized BEFORE the early return below so the hook order stays stable
  // across renders (React Hooks rule).
  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      const aTime = Date.parse(a.timestamp);
      const bTime = Date.parse(b.timestamp);
      if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
      return bTime - aTime;
    });
  }, [entries]);

  if (entries.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="history-empty"
      >
        {t('tracking.historyEmpty')}
      </p>
    );
  }

  return (
    <ol
      className="relative space-y-4 border-s border-border ps-6"
      data-testid="history-timeline"
    >
      {sorted.map((entry, index) => (
        <TimelineItem
          // Timestamp + status is sufficiently unique within an applicant's
          // own history; index disambiguates the (rare) duplicate case.
          key={`${entry.timestamp}-${entry.status}-${index}`}
          entry={entry}
        />
      ))}
    </ol>
  );
}

function TimelineItem({
  entry,
}: {
  entry: ApplicationStatusHistoryEntry;
}): JSX.Element {
  const { t } = useLanguage();
  const variant = STATUS_VARIANTS[entry.status];
  const label = variant
    ? t(variant.labelKey)
    : t('tracking.statusUnknown', { status: entry.status });

  return (
    <li className="relative" data-testid="timeline-item">
      <span
        aria-hidden="true"
        className="absolute -start-[0.42rem] top-1.5 h-3 w-3 rounded-full bg-primary"
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {entry.actor && (
            <span className="text-xs text-muted-foreground">
              · {entry.actor}
            </span>
          )}
        </div>
        <time
          dateTime={entry.timestamp}
          className="text-xs text-muted-foreground"
        >
          {formatTimestamp(entry.timestamp)}
        </time>
        {entry.note && (
          <p className="text-sm text-muted-foreground">{entry.note}</p>
        )}
      </div>
    </li>
  );
}

// ─── Follow-up actions ─────────────────────────────────────────────────────

function FollowUpList({
  actions,
}: {
  actions: ApplicationFollowUpAction[];
}): JSX.Element {
  const { t } = useLanguage();

  if (actions.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="follow-up-empty"
      >
        {t('tracking.followUpEmpty')}
      </p>
    );
  }

  return (
    <ul className="space-y-2" data-testid="follow-up-list">
      {actions.map((action) => (
        <li
          key={action.code}
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p className="font-medium">{action.message}</p>
          {action.dueAt && (
            <time
              dateTime={action.dueAt}
              className="mt-1 block text-xs text-amber-700"
            >
              {formatTimestamp(action.dueAt)}
            </time>
          )}
        </li>
      ))}
    </ul>
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
