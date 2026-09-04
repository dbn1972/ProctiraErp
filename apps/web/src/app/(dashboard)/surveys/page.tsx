/**
 * Surveys list (Server Component).
 *
 * Layout per redesign/web/surveys-list.html:
 *  - Page head with active/draft counts
 *  - Surveys table (name, status, window, questions)
 */
import { ClipboardList } from 'lucide-react';

import {
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { listSurveys, type Survey, type SurveyStatus } from '@/lib/api/surveys';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<SurveyStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
  archived: 'Archived',
};

const STATUS_COLOURS: Record<SurveyStatus, string> = {
  draft: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  closed: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  archived: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

export default async function SurveysPage() {
  const surveys = await listSurveys();
  const activeCount = surveys.filter((s) => s.status === 'active').length;
  const draftCount = surveys.filter((s) => s.status === 'draft').length;

  return (
    <section aria-labelledby="surveys-heading" className="space-y-6">
      <div>
        <h1
          id="surveys-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          Surveys
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Design, distribute and track surveys
          {surveys.length > 0
            ? ` · ${surveys.length.toLocaleString()} total · ${activeCount.toLocaleString()} active · ${draftCount.toLocaleString()} draft`
            : null}
        </p>
      </div>

      {surveys.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <ClipboardList
              className="h-10 w-10 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-base font-medium">No surveys yet</p>
            <p className="text-sm text-muted-foreground">
              Surveys will appear here once created.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <SurveysTable items={surveys} />
            </div>
            <div className="border-t px-4 py-3 text-sm text-muted-foreground">
              Showing{' '}
              <span className="font-semibold text-foreground">1–{surveys.length}</span> of{' '}
              <span className="font-semibold text-foreground">{surveys.length}</span> surveys
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function SurveysTable({ items }: { items: Survey[] }) {
  return (
    <Table aria-label="Surveys">
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="ps-4 font-semibold">Survey</TableHead>
          <TableHead className="font-semibold text-end">Questions</TableHead>
          <TableHead className="font-semibold">Window</TableHead>
          <TableHead className="pe-4 font-semibold">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((survey) => {
          const questionCount = Array.isArray(survey.questions)
            ? survey.questions.length
            : null;

          return (
            <TableRow key={survey.id}>
              <TableCell className="ps-4">
                <p className="font-semibold text-foreground">{survey.name}</p>
                {survey.description ? (
                  <p className="line-clamp-1 text-[11px] text-muted-foreground">
                    {survey.description}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {questionCount != null ? questionCount.toLocaleString() : '—'}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {survey.startDate || survey.endDate
                  ? `${survey.startDate ?? '—'} → ${survey.endDate ?? '—'}`
                  : '—'}
              </TableCell>
              <TableCell className="pe-4">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    STATUS_COLOURS[survey.status],
                  )}
                >
                  {STATUS_LABELS[survey.status]}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
