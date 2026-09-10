'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Clock, ShieldX, AlertTriangle, ListChecks } from 'lucide-react';
import type { RegistrationStatus } from '@/lib/api';

/**
 * Detail card displayed on `/track/[trackingNumber]` after a successful
 * status lookup. The look matches the Figma "Application Tracking" page.
 */
export function StatusCard({ status }: { status: RegistrationStatus }) {
  const t = useTranslations('tracking');
  const tCommon = useTranslations('common');
  const variant = STATUS_VARIANTS[status.status] ?? STATUS_VARIANTS.pending;

  const timeline = buildTimeline(status.status);

  return (
    <article className="card space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-xs text-gray-500">
            {t('applicationNumber')} #{status.trackingNumber}
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-gray-900">
            {status.applicantName}
          </h2>
        </div>
        <span className={`status-badge ${variant.badgeClass}`}>
          <span className="me-1">{variant.icon}</span>
          {t(variant.labelKey)}
        </span>
      </header>

      {/* Vertical status timeline */}
      <ol className="relative space-y-5 ps-2">
        {timeline.map((item, index) => {
          const isLast = index === timeline.length - 1;
          return (
            <li key={item.key} className="relative flex gap-3.5">
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={`absolute start-[11px] top-7 h-[calc(100%+4px)] w-0.5 ${
                    item.state === 'done' ? 'bg-primary-600' : 'bg-gray-200'
                  }`}
                />
              )}
              <span
                className={`relative z-10 mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${
                  item.state === 'done'
                    ? 'bg-primary-600 text-white'
                    : item.state === 'active'
                      ? 'bg-white text-primary-700 ring-2 ring-primary-600'
                      : 'bg-gray-100 text-gray-400'
                }`}
              >
                {item.state === 'done' ? (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                ) : item.state === 'active' ? (
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                )}
              </span>
              <span
                className={`pt-0.5 text-sm font-semibold ${
                  item.state === 'upcoming' ? 'text-gray-400' : 'text-gray-900'
                }`}
              >
                {t(item.labelKey)}
              </span>
            </li>
          );
        })}
      </ol>

      <dl className="grid gap-4 border-t border-gray-100 pt-6 text-sm sm:grid-cols-2">
        <Row label={t('institution')} value={status.institutionName} />
        <Row label={t('submittedDate')} value={formatDate(status.submittedAt)} />
        <Row label={t('lastUpdated')} value={formatDate(status.updatedAt)} />
        <Row label={t('status')} value={t(variant.labelKey)} />
      </dl>

      {status.remarks && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">{t('remarks')}</p>
          <p className="mt-1">{status.remarks}</p>
        </div>
      )}

      <Link href="/" className="btn-secondary w-full justify-center">
        {tCommon('home')}
      </Link>
    </article>
  );
}

type TimelineState = 'done' | 'active' | 'upcoming';

/**
 * Derives a presentation-only status timeline from the real application
 * status. Steps: submitted → under review → decision. No fabricated dates or
 * copy — only the translated status labels are shown.
 */
function buildTimeline(
  status: RegistrationStatus['status'],
): { key: string; labelKey: string; state: TimelineState }[] {
  const submitted: TimelineState = 'done';
  let review: TimelineState;
  let decision: TimelineState;
  let decisionKey: string;

  switch (status) {
    case 'pending':
      review = 'active';
      decision = 'upcoming';
      decisionKey = 'statusApproved';
      break;
    case 'under_review':
    case 'waitlisted':
      review = 'done';
      decision = 'active';
      decisionKey = status === 'waitlisted' ? 'statusWaitlisted' : 'statusApproved';
      break;
    case 'approved':
      review = 'done';
      decision = 'done';
      decisionKey = 'statusApproved';
      break;
    case 'rejected':
      review = 'done';
      decision = 'done';
      decisionKey = 'statusRejected';
      break;
    default:
      review = 'active';
      decision = 'upcoming';
      decisionKey = 'statusApproved';
  }

  return [
    { key: 'submitted', labelKey: 'submittedDate', state: submitted },
    { key: 'review', labelKey: 'statusUnderReview', state: review },
    { key: 'decision', labelKey: decisionKey, state: decision },
  ];
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value}</dd>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

const STATUS_VARIANTS: Record<
  RegistrationStatus['status'],
  { icon: React.ReactNode; badgeClass: string; labelKey: string }
> = {
  pending: {
    icon: <Clock className="inline h-3 w-3" />,
    badgeClass: 'status-pending',
    labelKey: 'statusPending',
  },
  under_review: {
    icon: <ListChecks className="inline h-3 w-3" />,
    badgeClass: 'status-review',
    labelKey: 'statusUnderReview',
  },
  approved: {
    icon: <CheckCircle2 className="inline h-3 w-3" />,
    badgeClass: 'status-approved',
    labelKey: 'statusApproved',
  },
  rejected: {
    icon: <ShieldX className="inline h-3 w-3" />,
    badgeClass: 'status-rejected',
    labelKey: 'statusRejected',
  },
  waitlisted: {
    icon: <AlertTriangle className="inline h-3 w-3" />,
    badgeClass: 'status-pending',
    labelKey: 'statusWaitlisted',
  },
};
