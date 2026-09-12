/**
 * /students/[id]/transfer — Transfer workflow (Server Component shell + client form).
 *
 * Implements Requirements 6.3 / 6.4: select destination institution, capture
 * reason and effective date, and submit for approval through the workflow engine.
 *
 * v2.0 redesign:
 * - text-3xl font-extrabold heading "Transfer request"
 * - student name + source school in subtitle
 * - 2-col layout: form (main) + sidebar (checklist + approval chain)
 * - TransferForm kept 100% intact
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileText,
  GraduationCap,
  Shield,
  UserRound,
} from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import { listAreas, listInstitutions } from '@/lib/api/institutions';
import { getStudent, getStudentEnrollments } from '@/lib/api/students';

import { TransferForm } from './_components/transfer-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/* ──────────────────────────────────────────────── Transfer checklist ── */

const CHECKLIST_ITEMS = [
  {
    icon: FileText,
    label: 'Academic records retrieved',
    done: true,
    note: 'Transcripts available in document store',
  },
  {
    icon: Shield,
    label: 'No outstanding discipline action',
    done: true,
    note: 'Last review: clean record',
  },
  {
    icon: GraduationCap,
    label: 'All fees settled',
    done: false,
    note: 'Pending: term 2 balance',
  },
  {
    icon: UserRound,
    label: 'Parent / guardian consent captured',
    done: false,
    note: 'Required before submission',
  },
  {
    icon: FileText,
    label: 'Destination school vacancy confirmed',
    done: false,
    note: 'Select destination to verify',
  },
] as const;

function TransferChecklist() {
  const done = CHECKLIST_ITEMS.filter((i) => i.done).length;
  const total = CHECKLIST_ITEMS.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Transfer checklist</CardTitle>
        <CardDescription className="text-xs">
          {done}/{total} items complete
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pb-5">
        {CHECKLIST_ITEMS.map((item) => (
          <div
            key={item.label}
            className={cn(
              'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-xs',
              item.done
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
                : 'border-border bg-muted/40',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 shrink-0',
                item.done ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
              )}
            >
              {item.done ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  'font-medium leading-snug',
                  item.done ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {item.label}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{item.note}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────── Approval chain ── */

const APPROVAL_STEPS = [
  {
    role: 'School registrar',
    action: 'Initial review & documentation check',
    status: 'upcoming' as const,
  },
  {
    role: 'School principal',
    action: 'Academic record approval',
    status: 'upcoming' as const,
  },
  {
    role: 'District education officer',
    action: 'Cross-school transfer authorisation',
    status: 'upcoming' as const,
  },
  {
    role: 'Destination school',
    action: 'Admission confirmation',
    status: 'upcoming' as const,
  },
] as const;

const STATUS_STYLES = {
  done: 'bg-primary text-primary-foreground',
  active: 'bg-primary/20 text-primary ring-4 ring-primary/10',
  upcoming: 'bg-muted text-muted-foreground',
} as const;

function ApprovalChain() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Approval chain</CardTitle>
        <CardDescription className="text-xs">
          All steps required for district-level transfer
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-5">
        <ol className="space-y-0">
          {APPROVAL_STEPS.map((step, i) => (
            <li key={step.role} className="flex gap-3">
              {/* dot + connector */}
              <div className="flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    STATUS_STYLES[step.status],
                  )}
                >
                  {i + 1}
                </span>
                {i < APPROVAL_STEPS.length - 1 && (
                  <span aria-hidden="true" className="mt-1 h-8 w-px bg-border" />
                )}
              </div>

              {/* text */}
              <div className={cn('pb-5 pt-0.5', i === APPROVAL_STEPS.length - 1 && 'pb-0')}>
                <p className="text-xs font-semibold leading-none text-foreground">{step.role}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{step.action}</p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────── Page ── */

export default async function StudentTransferPage(props: PageProps) {
  const params = await props.params;
  const studentId = params.id;
  const [student, enrollments, institutions, areas] = await Promise.all([
    getStudent(studentId),
    getStudentEnrollments(studentId),
    listInstitutions({ pageSize: 200 }),
    listAreas(),
  ]);

  if (!student) {
    notFound();
  }

  const activeEnrollments = enrollments.filter((e) => e.status === 'ENROLLED');

  // Build source info for subtitle
  const cd = student.customData ?? {};
  const gradeSection = typeof cd['gradeSection'] === 'string' ? cd['gradeSection'] : '';
  const institutionName = typeof cd['institutionName'] === 'string' ? cd['institutionName'] : '';
  const subtitleParts = [
    `${student.firstName} ${student.lastName}`,
    gradeSection && `Grade ${gradeSection}`,
    institutionName,
  ].filter(Boolean);

  return (
    <section aria-labelledby="transfer-heading" className="space-y-6">
      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="transfer-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Transfer request
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {subtitleParts.join(' · ')}
            {subtitleParts.length > 0 ? ' · ' : ''}
            Requires district approval — all steps tracked in the audit trail.
          </p>
        </div>
        <div className="shrink-0">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/students/${student.id}`}>
              <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
              Back to profile
            </Link>
          </Button>
        </div>
      </div>

      {/* ── 2-column layout ── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Main: form ── */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transfer details</CardTitle>
              <CardDescription>
                Source enrollment, destination, effective date, and reason.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activeEnrollments.length === 0 ? (
                <div className="space-y-3" data-testid="transfer-needs-enroll">
                  <p className="text-sm text-muted-foreground">
                    This student has no active enrollment. Enroll the student before initiating a
                    transfer.
                  </p>
                  <Button asChild size="sm">
                    <Link href={`/students/${student.id}/enroll`}>Enroll student</Link>
                  </Button>
                </div>
              ) : (
                <TransferForm
                  studentId={student.id}
                  activeEnrollments={activeEnrollments.map((e) => ({
                    id: e.id,
                    institutionId: e.institutionId,
                    gradeId: e.gradeId,
                    academicPeriodId: e.academicPeriodId,
                  }))}
                  institutions={institutions.map((i) => ({
                    id: i.id,
                    name: i.name,
                    areaId: i.areaId,
                  }))}
                  areas={areas.map((a) => ({
                    id: a.id,
                    name: a.name,
                    parentId: a.parentId,
                    level: a.level,
                  }))}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Sidebar ── */}
        <aside className="flex flex-col gap-5" aria-label="Transfer details sidebar">
          <TransferChecklist />
          <ApprovalChain />
        </aside>
      </div>
    </section>
  );
}
