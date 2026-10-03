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

import { AlertTriangle, ArrowLeft, CheckCircle2, HelpCircle } from 'lucide-react';

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
import {
  getStudent,
  getStudentEnrollments,
  readStudentConsents,
  readStudentDiscipline,
} from '@/lib/api/students';
import { listInvoicesResult } from '@/lib/api/fees';
import {
  buildTransferChecklist,
  type TransferChecklistItem,
} from './_components/transfer-checklist';

import { TransferForm } from './_components/transfer-form';
import { loadPlacementDirectories } from '../../_components/load-student-placement';
import {
  classSectionLabel,
  enrollmentOptionLabel,
  institutionLabel,
} from '../../_components/student-placement-label';
import { MAX_API_PAGE_SIZE } from '@/lib/api/pagination';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/* ──────────────────────────────────────────────── Transfer checklist ── */

const STATE_ICON = { done: CheckCircle2, outstanding: AlertTriangle, unknown: HelpCircle } as const;
const STATE_TEXT = { done: 'Done', outstanding: 'Outstanding', unknown: 'Not checked' } as const;

/** PRC-M483: live checklist; no static "done" data. */
function TransferChecklist({ items }: { items: TransferChecklistItem[] }) {
  const done = items.filter((i) => i.state === 'done').length;
  return (
    <Card data-testid="transfer-checklist">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Transfer checklist</CardTitle>
        <CardDescription className="text-xs">
          From this student&apos;s records. {done}/{items.length} complete.
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-5">
        <ul className="space-y-3">
          {items.map((item) => {
            const Icon = STATE_ICON[item.state];
            return (
              <li
                key={item.key}
                data-testid={`transfer-check-${item.key}`}
                data-state={item.state}
                className={cn(
                  'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-xs',
                  item.state === 'done'
                    ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
                    : item.state === 'outstanding'
                      ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
                      : 'border-border bg-muted/40',
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    item.state === 'done'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : item.state === 'outstanding'
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-muted-foreground',
                  )}
                />
                <div className="min-w-0">
                  <p className="font-medium leading-snug text-foreground">
                    {item.label}
                    <span className="sr-only">: {STATE_TEXT[item.state]}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{item.note}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────── Page ── */

export default async function StudentTransferPage(props: PageProps) {
  const params = await props.params;
  const studentId = params.id;
  const [student, enrollments, institutions, areas, invoicesResult, discipline, consents] =
    await Promise.all([
      getStudent(studentId),
      getStudentEnrollments(studentId),
      listInstitutions({ pageSize: MAX_API_PAGE_SIZE }),
      listAreas(),
      listInvoicesResult('staff', { studentId }),
      readStudentDiscipline(studentId),
      readStudentConsents(studentId),
    ]);

  if (!student) {
    notFound();
  }

  const activeEnrollments = enrollments.filter((e) => e.status === 'ENROLLED');
  const checklist = buildTransferChecklist({
    invoices: invoicesResult.ok ? invoicesResult.items : null,
    discipline,
    consents,
  });
  const pendingChecks = checklist.filter((item) => item.state !== 'done');
  const directories = await loadPlacementDirectories(
    [
      ...enrollments.map((entry) => entry.institutionId),
      ...institutions.map((institution) => institution.id),
    ],
    institutions.map((institution) => ({ id: institution.id, name: institution.name })),
  );

  // Build source info for subtitle from the enrollment, not a raw id.
  const cd = student.customData ?? {};
  const source = activeEnrollments[0];
  const gradeSection = classSectionLabel({
    classId: source?.classId,
    gradeId: source?.gradeId,
    customGradeSection: typeof cd['gradeSection'] === 'string' ? cd['gradeSection'] : '',
    directories,
  });
  const institutionName = institutionLabel({
    institutionId: source?.institutionId,
    customName: typeof cd['institutionName'] === 'string' ? cd['institutionName'] : '',
    directories,
  });
  const subtitleParts = [
    `${student.firstName} ${student.lastName}`,
    gradeSection !== '—' ? gradeSection : '',
    institutionName !== '—' ? institutionName : '',
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
            <CardContent className="space-y-4">
              {pendingChecks.length > 0 && activeEnrollments.length > 0 ? (
                <div
                  role="status"
                  data-testid="transfer-checklist-warning"
                  className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                >
                  {pendingChecks.length} checklist item
                  {pendingChecks.length === 1 ? ' is' : 's are'} not complete (
                  {pendingChecks.map((item) => item.label).join('; ')}). Resolve
                  {pendingChecks.length === 1 ? ' it' : ' them'} or record why before submitting.
                </div>
              ) : null}
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
                    label: enrollmentOptionLabel({
                      institutionId: e.institutionId,
                      classId: e.classId,
                      gradeId: e.gradeId,
                      customGradeSection:
                        typeof cd['gradeSection'] === 'string' ? cd['gradeSection'] : '',
                      customInstitutionName:
                        typeof cd['institutionName'] === 'string' ? cd['institutionName'] : '',
                      directories,
                    }),
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
          <TransferChecklist items={checklist} />
        </aside>
      </div>
    </section>
  );
}
