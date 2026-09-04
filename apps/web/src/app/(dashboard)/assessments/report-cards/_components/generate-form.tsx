'use client';

/**
 * Report card generation form — single or bulk.
 */
import { useState } from 'react';
import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@proctira/ui/components';
import type { ReportCardJob, ReportCardTemplate } from '@/lib/api/report-cards';
import { cn } from '@/lib/utils';

import {
  generateReportCardAction,
  type ActionState,
} from '../actions';

interface InstitutionOption {
  id: string;
  name: string;
}

interface AcademicPeriodOption {
  id: string;
  name: string;
}

interface GenerateFormProps {
  templates: ReportCardTemplate[];
  institutions: InstitutionOption[];
  academicPeriods: AcademicPeriodOption[];
}

const STATUS_PILL: Record<ReportCardJob['status'], string> = {
  queued: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  processing:
    'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400',
  completed:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
};

export function ReportCardGenerateForm({
  templates,
  institutions,
  academicPeriods,
}: GenerateFormProps) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [studentId, setStudentId] = useState('');
  const [studentIds, setStudentIds] = useState('');
  const [academicPeriodId, setAcademicPeriodId] = useState(
    academicPeriods[0]?.id ?? '',
  );
  const [institutionId, setInstitutionId] = useState(institutions[0]?.id ?? '');
  const [templateId, setTemplateId] = useState(
    templates.find((t) => t.isDefault)?.id ?? templates[0]?.id ?? '',
  );
  const [isPending, setIsPending] = useState(false);
  const [state, setState] = useState<ActionState<{
    jobs: ReportCardJob[];
    jobsCreated: number;
  }> | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);
    setState(null);
    try {
      const result = await generateReportCardAction({
        mode,
        studentId,
        studentIds,
        academicPeriodId,
        institutionId,
        templateId: templateId || undefined,
      });
      setState(result);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate report cards</CardTitle>
          <CardDescription>
            Queue PDF generation for one student or a bulk batch (up to 500).
            Jobs process asynchronously — check status from the report cards
            list.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <div
              className="flex flex-wrap gap-1 border-b border-border pb-3"
              role="tablist"
              aria-label="Generation mode"
            >
              {(
                [
                  { key: 'single', label: 'Single student' },
                  { key: 'bulk', label: 'Bulk' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={mode === tab.key}
                  onClick={() => setMode(tab.key)}
                  className={cn(
                    'inline-flex items-center border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
                    mode === tab.key
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {mode === 'single' ? (
              <div className="space-y-2">
                <Label htmlFor="studentId">Student ID</Label>
                <Input
                  id="studentId"
                  name="studentId"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  placeholder="UUID"
                  required
                  className="font-mono text-sm"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="studentIds">Student IDs</Label>
                <Textarea
                  id="studentIds"
                  name="studentIds"
                  value={studentIds}
                  onChange={(e) => setStudentIds(e.target.value)}
                  placeholder="One UUID per line, or comma-separated"
                  rows={5}
                  required
                  className="font-mono text-sm"
                />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="academicPeriodId">Academic period</Label>
                {academicPeriods.length > 0 ? (
                  <Select
                    value={academicPeriodId}
                    onValueChange={setAcademicPeriodId}
                  >
                    <SelectTrigger id="academicPeriodId">
                      <SelectValue placeholder="Select period" />
                    </SelectTrigger>
                    <SelectContent>
                      {academicPeriods.map((period) => (
                        <SelectItem key={period.id} value={period.id}>
                          {period.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="academicPeriodId"
                    value={academicPeriodId}
                    onChange={(e) => setAcademicPeriodId(e.target.value)}
                    placeholder="Period UUID"
                    required
                    className="font-mono text-sm"
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="institutionId">Institution</Label>
                {institutions.length > 0 ? (
                  <Select
                    value={institutionId}
                    onValueChange={setInstitutionId}
                  >
                    <SelectTrigger id="institutionId">
                      <SelectValue placeholder="Select institution" />
                    </SelectTrigger>
                    <SelectContent>
                      {institutions.map((inst) => (
                        <SelectItem key={inst.id} value={inst.id}>
                          {inst.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="institutionId"
                    value={institutionId}
                    onChange={(e) => setInstitutionId(e.target.value)}
                    placeholder="Institution UUID"
                    required
                    className="font-mono text-sm"
                  />
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="templateId">Template</Label>
              <Select
                value={templateId || '__default__'}
                onValueChange={(v) =>
                  setTemplateId(v === '__default__' ? '' : v)
                }
              >
                <SelectTrigger id="templateId">
                  <SelectValue placeholder="Default template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">
                    Default template
                  </SelectItem>
                  {templates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name}
                      {tpl.isDefault ? ' (default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {state?.status === 'error' ? (
              <p className="text-sm text-destructive" role="alert">
                {state.message}
              </p>
            ) : null}
            {state?.status === 'success' ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                {state.message}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? 'Queuing…' : 'Queue generation'}
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/assessments/report-cards">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {state?.status === 'success' && state.data?.jobs?.length ? (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Queued jobs</CardTitle>
            <CardDescription>
              {state.data.jobsCreated.toLocaleString()} job
              {state.data.jobsCreated === 1 ? '' : 's'} created
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y" role="list">
              {state.data.jobs.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-foreground">
                      {job.id}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Student{' '}
                      <span className="font-mono">{job.studentId}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        STATUS_PILL[job.status],
                      )}
                    >
                      {job.status}
                    </span>
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        href={`/assessments/report-cards?jobId=${encodeURIComponent(job.id)}`}
                      >
                        View
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
