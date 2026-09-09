/**
 * LMS hub (Server Component) — assignments · homework · quizzes · Spiral PAL.
 *
 * FR-UX-001: KPIs, kind/status filters, table with Board/School scope badges.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  BookOpenCheck,
  Brain,
  CalendarClock,
  ClipboardCheck,
  Eye,
  Plus,
  Sparkles,
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
  listAssignments,
  type AssignmentKind,
  type AssignmentStatus,
  type LmsAssignment,
} from '@/lib/api/lms';
import { cn } from '@/lib/utils';

import { KindPill, ScopePill, StatusPill } from './_components/badges';
import { KpiCard } from './_components/kpi-card';
import { EmptyState } from '@/components/page';

export const dynamic = 'force-dynamic';

type LmsT = Awaited<ReturnType<typeof getTranslations<'lms'>>>;

const KINDS: readonly AssignmentKind[] = ['assignment', 'homework', 'quiz'];
const STATUSES: readonly AssignmentStatus[] = ['draft', 'published', 'closed', 'archived'];

const KIND_KEYS = {
  assignment: 'kindAssignment',
  homework: 'kindHomework',
  quiz: 'kindQuiz',
} as const satisfies Record<AssignmentKind, string>;

const STATUS_KEYS = {
  draft: 'statusDraft',
  published: 'statusPublished',
  closed: 'statusClosed',
  archived: 'statusArchived',
} as const satisfies Record<AssignmentStatus, string>;

function formatDue(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

export default async function LmsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const kind = pick(typeof params.kind === 'string' ? params.kind : undefined, KINDS);
  const status = pick(typeof params.status === 'string' ? params.status : undefined, STATUSES);

  const [t, all, filtered] = await Promise.all([
    getTranslations('lms'),
    listAssignments(),
    kind || status ? listAssignments({ kind, status }) : Promise.resolve(null),
  ]);
  const items = filtered ?? all;

  const now = Date.now();
  const weekAhead = now + 7 * 24 * 60 * 60 * 1000;
  const published = all.filter((a) => a.status === 'published');
  const dueThisWeek = published.filter((a) => {
    if (!a.dueAt) return false;
    const due = new Date(a.dueAt).getTime();
    return due >= now && due <= weekAhead;
  });
  const quizzes = all.filter((a) => a.kind === 'quiz');
  const boardShared = all.filter((a) => a.scope === 'board');

  return (
    <section aria-labelledby="lms-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 id="lms-heading" className="text-3xl font-extrabold tracking-tight text-foreground">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('subtitle')}
            {all.length > 0
              ? ` ${t('configured', { count: all.length, published: published.length })}`
              : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/lms/pal">
              <Brain className="me-1.5 h-4 w-4" aria-hidden="true" />
              {t('spiralPal')}
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/lms/assignments/new">
              <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
              {t('newWork')}
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<BookOpenCheck className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          label={t('kpiPublished')}
          value={published.length.toLocaleString()}
          foot={t('totalWork', { count: all.length })}
        />
        <KpiCard
          icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
          label={t('kpiDueThisWeek')}
          value={dueThisWeek.length.toLocaleString()}
          foot={t('publishedOnly')}
        />
        <KpiCard
          icon={<ClipboardCheck className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-950/40 dark:text-fuchsia-400"
          label={t('kpiQuizzes')}
          value={quizzes.length.toLocaleString()}
          foot={t('autoGraded')}
        />
        <KpiCard
          icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400"
          label={t('kpiBoardShared')}
          value={boardShared.length.toLocaleString()}
          foot={t('sharedWithSchools')}
        />
      </div>

      <Filters t={t} kind={kind} status={status} />

      {items.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title={kind || status ? t('emptyFilteredTitle') : t('emptyTitle')}
              description={kind || status ? t('emptyFilteredBody') : t('emptyBody')}
              action={
                <Button asChild>
                  <Link href={kind || status ? '/lms' : '/lms/assignments/new'}>
                    {kind || status ? t('clearFilters') : t('createFirst')}
                  </Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <WorkTable items={items} t={t} />
            </div>
            <div className="border-t px-4 py-3 text-sm text-muted-foreground">
              {t.rich('showing', {
                from: 1,
                to: items.length,
                total: items.length,
                strong: (chunks) => <span className="font-semibold text-foreground">{chunks}</span>,
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function Filters({
  t,
  kind,
  status,
}: {
  t: LmsT;
  kind?: AssignmentKind;
  status?: AssignmentStatus;
}) {
  const link = (next: { kind?: AssignmentKind; status?: AssignmentStatus }) => {
    const qs = new URLSearchParams();
    if (next.kind) qs.set('kind', next.kind);
    if (next.status) qs.set('status', next.status);
    const s = qs.toString();
    return s ? `/lms?${s}` : '/lms';
  };
  const chip = (active: boolean) =>
    cn(
      'inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-medium transition-colors',
      active
        ? 'border-primary bg-primary text-primary-foreground'
        : 'border-border bg-background text-foreground hover:bg-muted',
    );
  return (
    <nav aria-label={t('filters')} className="flex flex-wrap gap-2">
      <Link
        href={link({ status })}
        className={chip(!kind)}
        aria-current={!kind ? 'true' : undefined}
      >
        {t('allKinds')}
      </Link>
      {KINDS.map((k) => (
        <Link
          key={k}
          href={link({ kind: k, status })}
          className={chip(kind === k)}
          aria-current={kind === k ? 'true' : undefined}
        >
          {t(KIND_KEYS[k])}
        </Link>
      ))}
      <span className="mx-1 hidden self-center text-muted-foreground sm:inline" aria-hidden="true">
        ·
      </span>
      {STATUSES.map((s) => (
        <Link
          key={s}
          href={link({ kind, status: status === s ? undefined : s })}
          className={chip(status === s)}
          aria-current={status === s ? 'true' : undefined}
        >
          {t(STATUS_KEYS[s])}
        </Link>
      ))}
    </nav>
  );
}

function WorkTable({ items, t }: { items: LmsAssignment[]; t: LmsT }) {
  return (
    <Table aria-label={t('title')}>
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="ps-4 font-semibold">{t('colTitle')}</TableHead>
          <TableHead className="font-semibold">{t('colKind')}</TableHead>
          <TableHead className="font-semibold">{t('colScope')}</TableHead>
          <TableHead className="font-semibold">{t('colSubject')}</TableHead>
          <TableHead className="font-semibold">{t('colDue')}</TableHead>
          <TableHead className="font-semibold text-end">{t('colMaxScore')}</TableHead>
          <TableHead className="font-semibold">{t('colStatus')}</TableHead>
          <TableHead className="pe-4 text-end font-semibold">{t('colActions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((a) => (
          <TableRow key={a.id} className="group" data-testid="lms-row">
            <TableCell className="ps-4">
              <Link
                href={`/lms/assignments/${a.id}`}
                className="font-semibold text-foreground hover:underline"
              >
                {a.title}
              </Link>
              {a.gradeLevel ? (
                <p className="text-[11px] text-muted-foreground">
                  {t('grade', { grade: a.gradeLevel })}
                </p>
              ) : null}
            </TableCell>
            <TableCell>
              <KindPill kind={a.kind} label={t(KIND_KEYS[a.kind])} />
            </TableCell>
            <TableCell>
              <ScopePill
                scope={a.scope}
                label={a.scope === 'board' ? t('scopeBoard') : t('scopeSchool')}
              />
            </TableCell>
            <TableCell className="text-sm">{a.subject}</TableCell>
            <TableCell className="text-sm tabular-nums">{formatDue(a.dueAt)}</TableCell>
            <TableCell className="text-end tabular-nums">{a.maxScore.toLocaleString()}</TableCell>
            <TableCell>
              <StatusPill status={a.status} label={t(STATUS_KEYS[a.status])} />
            </TableCell>
            <TableCell className="pe-4">
              <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                <Button asChild variant="ghost" size="icon" className="h-11 w-11 p-0">
                  <Link href={`/lms/assignments/${a.id}`} aria-label={t('view')}>
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
