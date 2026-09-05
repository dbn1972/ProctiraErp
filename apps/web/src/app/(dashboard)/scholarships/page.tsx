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

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<ScholarshipProgram['status'], string> = {
  DRAFT: 'Draft',
  OPEN: 'Window open',
  CLOSED: 'Closed',
  ARCHIVED: 'Archived',
};

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
  const [programs, applications, disbursements] = await Promise.all([
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
            Scholarship programs
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Central and state scholarship schemes — eligibility, application windows, and DBT
            disbursements in one place.
            {programs.length > 0
              ? ` ${programs.length.toLocaleString()} programs configured, ${openCount.toLocaleString()} with an open window.`
              : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/scholarships/applications">
              <FileText className="me-1.5 h-4 w-4" aria-hidden="true" />
              Applications
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/scholarships/disbursements">
              <Wallet className="me-1.5 h-4 w-4" aria-hidden="true" />
              Disbursements
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/scholarships/programs/new">
              <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
              New program
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Wallet className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          label="Disbursed"
          value={processed.length > 0 ? formatMoney(disbursedTotal, disbursedCurrency) : '—'}
          foot={
            processed.length > 0
              ? `${processed.length.toLocaleString()} processed payments`
              : 'No payments processed yet'
          }
        />
        <KpiCard
          icon={<Award className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
          label="Active programs"
          value={openCount.toLocaleString()}
          foot={`${programs.length.toLocaleString()} total configured`}
        />
        <KpiCard
          icon={<Clock className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
          label="Pending applications"
          value={pendingApps.toLocaleString()}
          foot={`${applications.length.toLocaleString()} applications received`}
        />
        <KpiCard
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400"
          label="Beneficiaries"
          value={approvedApps.toLocaleString()}
          foot="Approved applications"
        />
      </div>

      {programs.length === 0 ? (
        <EmptyState />
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <ProgramsTable items={programs} />
            </div>
            <div className="border-t px-4 py-3 text-sm text-muted-foreground">
              Showing <span className="font-semibold text-foreground">1–{programs.length}</span> of{' '}
              <span className="font-semibold text-foreground">{programs.length}</span> programs
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <Award className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-base font-medium">No scholarship programs yet</p>
        <p className="text-sm text-muted-foreground">
          Create your first scholarship program to start accepting applications.
        </p>
        <Button asChild className="mt-2">
          <Link href="/scholarships/programs/new">Create program</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ProgramsTable({ items }: { items: ScholarshipProgram[] }) {
  return (
    <Table aria-label="Scholarship programs">
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="ps-4 font-semibold">Program</TableHead>
          <TableHead className="font-semibold text-end">Slots</TableHead>
          <TableHead className="font-semibold text-end">Award</TableHead>
          <TableHead className="font-semibold">Application window</TableHead>
          <TableHead className="font-semibold">Status</TableHead>
          <TableHead className="pe-4 text-end font-semibold">Actions</TableHead>
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
              <span className="block text-[11px] font-normal text-muted-foreground">/ yr</span>
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
                {STATUS_LABELS[program.status]}
              </span>
            </TableCell>
            <TableCell className="pe-4">
              <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
                  <Link href={`/scholarships/programs/${program.id}`} aria-label="View">
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 p-0" aria-label="Edit">
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 p-0" aria-label="More">
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
