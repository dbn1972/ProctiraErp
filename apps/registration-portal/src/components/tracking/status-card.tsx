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
  const variant = STATUS_VARIANTS[status.status] ?? STATUS_VARIANTS.pending;

  return (
    <article className="card space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-xs text-gray-500">
            {t('applicationNumber')} #{status.trackingNumber}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-gray-900">{status.applicantName}</h2>
        </div>
        <span className={`status-badge ${variant.badgeClass}`}>
          <span className="me-1">{variant.icon}</span>
          {t(variant.labelKey)}
        </span>
      </header>

      <dl className="grid gap-4 text-sm sm:grid-cols-2">
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
        Home
      </Link>
    </article>
  );
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
  pending: { icon: <Clock className="inline h-3 w-3" />, badgeClass: 'status-pending', labelKey: 'statusPending' },
  under_review: { icon: <ListChecks className="inline h-3 w-3" />, badgeClass: 'status-review', labelKey: 'statusUnderReview' },
  approved: { icon: <CheckCircle2 className="inline h-3 w-3" />, badgeClass: 'status-approved', labelKey: 'statusApproved' },
  rejected: { icon: <ShieldX className="inline h-3 w-3" />, badgeClass: 'status-rejected', labelKey: 'statusRejected' },
  waitlisted: { icon: <AlertTriangle className="inline h-3 w-3" />, badgeClass: 'status-pending', labelKey: 'statusWaitlisted' },
};
