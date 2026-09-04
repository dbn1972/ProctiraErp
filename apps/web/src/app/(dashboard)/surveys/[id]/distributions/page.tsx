/**
 * Survey distributions (ProctiraERP).
 *
 * Layout cues from redesign/web/surveys-list.html and Transport patterns.
 * Uses GET /surveys/:id/status, POST /surveys/distribute, POST /surveys/:id/remind.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, BarChart3 } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getSurvey, getSurveyStatus } from '@/lib/api/surveys';

import { DistributeForm, RemindButton } from '../../_components/distribute-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function SurveyDistributionsPage({ params }: PageProps) {
  const survey = await getSurvey(params.id);
  if (!survey) notFound();

  const status = await getSurveyStatus(survey.id);
  const canDistribute = survey.status === 'published';

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
            Distribute · {survey.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Push this survey to matching institutions and track completion.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/surveys/${survey.id}/results`}>
            <BarChart3 className="me-1.5 h-4 w-4" aria-hidden="true" />
            Results
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total" value={status?.total ?? 0} />
        <Stat label="Pending" value={status?.pending ?? 0} />
        <Stat label="In progress" value={status?.inProgress ?? 0} />
        <Stat label="Completed" value={status?.completed ?? 0} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <Card className="max-w-[860px]">
          <CardHeader>
            <CardTitle className="text-base">Distribution filters</CardTitle>
            <CardDescription>
              Provide at least one filter. Institutions matching any supplied
              filter set receive the survey.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DistributeForm
              surveyId={survey.id}
              canDistribute={canDistribute}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Reminders</CardTitle>
            <CardDescription>
              Notify institutions that have not completed the survey.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RemindButton surveyId={survey.id} />
            {status ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Completion rate {status.completionRate.toFixed(0)}%
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">
          {value.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}
