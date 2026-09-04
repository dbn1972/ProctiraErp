/**
 * Survey detail (ProctiraERP).
 *
 * Layout aligned with Transport route detail / Scholarships program detail:
 * page head, status, meta, questions list, related actions.
 * Cues from redesign/web/surveys-list.html.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  BarChart3,
  Pencil,
  Send,
} from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  getSurvey,
  getSurveyStatus,
  type Survey,
  type SurveyStatus,
} from '@/lib/api/surveys';
import { cn } from '@/lib/utils';

import { PublishCloseButtons } from '../_components/survey-status-actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

const STATUS_LABELS: Record<SurveyStatus, string> = {
  draft: 'Draft',
  published: 'Active',
  closed: 'Closed',
};

const STATUS_COLOURS: Record<SurveyStatus, string> = {
  draft: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  published:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  closed: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

export default async function SurveyDetailPage({ params }: PageProps) {
  const survey = await getSurvey(params.id);
  if (!survey) notFound();

  const status = await getSurveyStatus(survey.id);
  const questions = Array.isArray(survey.questions) ? survey.questions : [];

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/surveys">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Surveys
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
              {survey.name}
            </h1>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                STATUS_COLOURS[survey.status],
              )}
            >
              {STATUS_LABELS[survey.status]}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {survey.description || 'No description'}
            {survey.startDate || survey.endDate
              ? ` · ${survey.startDate ?? '—'} → ${survey.endDate ?? '—'}`
              : ''}
            {status
              ? ` · ${status.completionRate.toFixed(0)}% complete (${status.completed}/${status.total})`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/surveys/${survey.id}/edit`}>
              <Pencil className="me-1.5 h-4 w-4" aria-hidden="true" />
              Edit
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/surveys/${survey.id}/distributions`}>
              <Send className="me-1.5 h-4 w-4" aria-hidden="true" />
              Distribute
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`/surveys/${survey.id}/results`}>
              <BarChart3 className="me-1.5 h-4 w-4" aria-hidden="true" />
              Results
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetaCard label="Questions" value={String(questions.length)} />
        <MetaCard
          label="Distributed"
          value={status ? status.total.toLocaleString() : '—'}
        />
        <MetaCard
          label="Completed"
          value={status ? status.completed.toLocaleString() : '—'}
        />
        <MetaCard
          label="Completion"
          value={status ? `${status.completionRate.toFixed(0)}%` : '—'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Questions</CardTitle>
            <CardDescription>
              Ordered as respondents will see them
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {questions.length === 0 ? (
              <p className="border-t py-10 text-center text-sm text-muted-foreground">
                No questions defined.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <QuestionsTable survey={survey} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Status</CardTitle>
            <CardDescription>
              Publish before distributing. Close when the window ends.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PublishCloseButtons surveyId={survey.id} status={survey.status} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function QuestionsTable({ survey }: { survey: Survey }) {
  const questions = [...(survey.questions ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  return (
    <Table aria-label="Survey questions">
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="ps-4 w-12 font-semibold">#</TableHead>
          <TableHead className="font-semibold">Question</TableHead>
          <TableHead className="font-semibold">Type</TableHead>
          <TableHead className="pe-4 font-semibold">Required</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {questions.map((q, idx) => (
          <TableRow key={q.id ?? `${idx}-${q.label}`}>
            <TableCell className="ps-4 tabular-nums text-muted-foreground">
              {(q.order ?? idx) + 1}
            </TableCell>
            <TableCell className="font-medium text-foreground">{q.label}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{q.type}</TableCell>
            <TableCell className="pe-4 text-sm">
              {q.required ? 'Yes' : 'No'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
