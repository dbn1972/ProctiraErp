/**
 * Survey results / submissions aggregate (ProctiraERP).
 *
 * Layout cues from redesign/web/surveys-list.html Results CTA and Reports results.
 * Uses GET /surveys/:id/aggregate and GET /surveys/:id/status.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Send } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import {
  getSurvey,
  getSurveyAggregate,
  getSurveyStatus,
} from '@/lib/api/surveys';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function SurveyResultsPage({
  params,
  searchParams,
}: PageProps) {
  const survey = await getSurvey(params.id);
  if (!survey) notFound();

  const groupByRaw = single(searchParams?.groupBy);
  const groupBy =
    groupByRaw === 'area' || groupByRaw === 'institution_type'
      ? groupByRaw
      : undefined;

  const [aggregate, status] = await Promise.all([
    getSurveyAggregate(survey.id, groupBy),
    getSurveyStatus(survey.id),
  ]);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href={`/surveys/${survey.id}`}>
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to survey
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            Results · {survey.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aggregated responses
            {aggregate
              ? ` · ${aggregate.totalCompleted.toLocaleString()} of ${aggregate.totalDistributed.toLocaleString()} completed (${aggregate.completionRate.toFixed(0)}%)`
              : status
                ? ` · ${status.completed.toLocaleString()} of ${status.total.toLocaleString()} completed`
                : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/surveys/${survey.id}/distributions`}>
              <Send className="me-1.5 h-4 w-4" aria-hidden="true" />
              Distributions
            </Link>
          </Button>
        </div>
      </div>

      <div
        className="flex flex-wrap gap-1 border-b border-border"
        role="tablist"
        aria-label="Group results"
      >
        {(
          [
            { key: undefined, label: 'Overall', href: `/surveys/${survey.id}/results` },
            {
              key: 'area',
              label: 'By area',
              href: `/surveys/${survey.id}/results?groupBy=area`,
            },
            {
              key: 'institution_type',
              label: 'By institution type',
              href: `/surveys/${survey.id}/results?groupBy=institution_type`,
            },
          ] as const
        ).map((tab) => {
          const active = groupBy === tab.key;
          return (
            <Link
              key={tab.label}
              href={tab.href}
              role="tab"
              aria-selected={active}
              className={
                active
                  ? 'inline-flex border-b-2 border-primary px-3 py-2 text-sm font-semibold text-foreground'
                  : 'inline-flex border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground'
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {!aggregate ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No aggregated results yet. Distribute the survey and collect
            submissions first.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label="Distributed"
              value={aggregate.totalDistributed.toLocaleString()}
            />
            <Stat
              label="Completed"
              value={aggregate.totalCompleted.toLocaleString()}
            />
            <Stat
              label="Completion rate"
              value={`${aggregate.completionRate.toFixed(0)}%`}
            />
          </div>

          {aggregate.crossTabulation && aggregate.crossTabulation.length > 0 ? (
            <Card className="overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Cross-tabulation</CardTitle>
                <CardDescription>
                  Completion by {groupBy === 'area' ? 'area' : 'institution type'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 p-0">
                <ul className="divide-y divide-border">
                  {aggregate.crossTabulation.map((row) => (
                    <li
                      key={row.groupKey}
                      className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                    >
                      <span className="font-medium text-foreground">
                        {row.groupLabel || row.groupKey}
                      </span>
                      <span className="text-muted-foreground">
                        {row.totalCompleted}/{row.totalDistributed} ·{' '}
                        {row.completionRate.toFixed(0)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card className="overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Question summaries</CardTitle>
              <CardDescription>
                Aggregated answers per question
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {aggregate.questionSummaries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No question summaries available.
                </p>
              ) : (
                aggregate.questionSummaries.map((q) => (
                  <div
                    key={q.questionId}
                    className="rounded-lg border border-border bg-muted/20 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold text-foreground">
                        {q.questionLabel}
                      </p>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                        {q.questionType}
                      </span>
                    </div>
                    <pre className="mt-3 overflow-x-auto rounded-md bg-background p-3 text-xs text-muted-foreground">
                      {formatSummary(q.summary)}
                    </pre>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
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

function formatSummary(summary: unknown): string {
  try {
    return JSON.stringify(summary, null, 2);
  } catch {
    return String(summary);
  }
}
