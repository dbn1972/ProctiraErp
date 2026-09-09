/**
 * Scholarship programs list (Server Component).
 *
 * Layout per redesign/web/scholarships-list.html:
 *  - Page head with Applications / Disbursements / New program CTAs
 *  - KPI cards (active programs, pending apps, beneficiaries, disbursed)
 *  - Programs table with status pills and icon actions
 *
 * Validates: Requirement 11.1 — scholarship program management entry point.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  Award,
  Clock,
  Eye,
  FileText,
  MoreVertical,
  Pencil,
  Plus,
  Users,
  Wallet,
} from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  listScholarshipApplications,
  listScholarshipDisbursements,
  listScholarshipPrograms,
  type ScholarshipProgram,
} from '@/lib/api/scholarships';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/page';

export const dynamic = 'force-dynamic';

type ScholarshipsT = Awaited<ReturnType<typeof getTranslations<'scholarships'>>>;

const STATUS_KEYS = {
  DRAFT: 'statusDraft',
  OPEN: 'statusOpen',
  CLOSED: 'statusClosed',
  ARCHIVED: 'statusArchived',
} as const satisfies Record<ScholarshipProgram['status'], string>;

const STATUS_COLOURS: Record<ScholarshipProgram['status'], string> = {
  OPEN: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  DRAFT: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  CLOSED: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  ARCHIVED: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

function formatWindow(start: string, end: string): string {
  const fmt = (iso: string) => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

export default async function ScholarshipsPage() {
  const [t, programs, applications, disbursements] = await Promise.all([
    getTranslations('scholarships'),
    listScholarshipPrograms(),
    listScholarshipApplications(),
    listScholarshipDisbursements(),
  ]);

  const openCount = programs.filter((p) => p.status === 'OPEN').length;
  const pendingApps = applications.filter(
    (a) => a.status === 'PENDING' || a.status === 'UNDER_REVIEW',
  ).length;
  const approvedApps = applications.filter((a) => a.status === 'APPROVED').length;
  const processed = disbursements.filter((d) => d.status === 'PROCESSED');
  const disbursedTotal = processed.reduce((sum, d) => sum + d.amount, 0);
  const disbursedCurrency = processed[0]?.currency ?? programs[0]?.currency ?? 'INR';

  return (
    <section aria-labelledby="programs-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="programs-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('subtitle')}
            {programs.length > 0
              ? ` ${t('configured', { count: programs.length, open: openCount })}`
              : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/scholarships/applications">
              <FileText className="me-1.5 h-4 w-4" aria-hidden="true" />
              {t('applications')}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/scholarships/disbursements">
              <Wallet className="me-1.5 h-4 w-4" aria-hidden="true" />
              {t('disbursements')}
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/scholarships/programs/new">
              <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
              {t('newProgram')}
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Wallet className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          label={t('kpiDisbursed')}
          value={processed.length > 0 ? formatMoney(disbursedTotal, disbursedCurrency) : '—'}
          foot={t('processedPayments', { count: processed.length })}
        />
        <KpiCard
          icon={<Award className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
          label={t('kpiActive')}
          value={openCount.toLocaleString()}
          foot={t('totalConfigured', { count: programs.length })}
        />
        <KpiCard
          icon={<Clock className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
          label={t('kpiPending')}
          value={pendingApps.toLocaleString()}
          foot={t('applicationsReceived', { count: applications.length })}
        />
        <KpiCard
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400"
          label={t('kpiBeneficiaries')}
          value={approvedApps.toLocaleString()}
          foot={t('approvedApplications')}
        />
      </div>

      {programs.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title={t('emptyTitle')}
              description={t('emptyBody')}
              action={
                <Button asChild>
                  <Link href="/scholarships/programs/new">{t('createProgram')}</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <ProgramsTable items={programs} t={t} />
            </div>
            <div className="border-t px-4 py-3 text-sm text-muted-foreground">
              {t.rich('showing', {
                from: 1,
                to: programs.length,
                total: programs.length,
                strong: (chunks) => <span className="font-semibold text-foreground">{chunks}</span>,
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function ProgramsTable({ items, t }: { items: ScholarshipProgram[]; t: ScholarshipsT }) {
  return (
    <Table aria-label={t('title')}>
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="ps-4 font-semibold">{t('colProgram')}</TableHead>
          <TableHead className="font-semibold text-end">{t('colSlots')}</TableHead>
          <TableHead className="font-semibold text-end">{t('colAward')}</TableHead>
          <TableHead className="font-semibold">{t('colWindow')}</TableHead>
          <TableHead className="font-semibold">{t('colStatus')}</TableHead>
          <TableHead className="pe-4 text-end font-semibold">{t('colActions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((program) => (
          <TableRow key={program.id} className="group">
            <TableCell className="ps-4">
              <Link
                href={`/scholarships/programs/${program.id}`}
                className="font-semibold text-foreground hover:underline"
              >
                {program.name}
              </Link>
              <p className="text-[11px] text-muted-foreground">
                <span className="font-mono">{program.code}</span>
              </p>
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {program.totalSlots.toLocaleString()}
            </TableCell>
            <TableCell className="text-end font-semibold tabular-nums">
              {formatMoney(program.awardAmount, program.currency)}
              <span className="block text-[11px] font-normal text-muted-foreground">
                {t('perYear')}
              </span>
            </TableCell>
            <TableCell className="text-sm">
              {formatWindow(program.applicationStartDate, program.applicationEndDate)}
            </TableCell>
            <TableCell>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  STATUS_COLOURS[program.status],
                )}
              >
                {t(STATUS_KEYS[program.status])}
              </span>
            </TableCell>
            <TableCell className="pe-4">
              <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
                  <Link href={`/scholarships/programs/${program.id}`} aria-label={t('view')}>
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 p-0" aria-label={t('edit')}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 p-0" aria-label={t('more')}>
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function KpiCard({
  icon,
  iconClass,
  label,
  value,
  foot,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
  foot?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              iconClass,
            )}
          >
            {icon}
          </span>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </div>
        <div className="mt-3 text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
          {value}
        </div>
        {foot ? <p className="mt-1 text-xs text-muted-foreground">{foot}</p> : null}
      </CardContent>
    </Card>
  );
}
