/**
 * Edit survey (ProctiraERP).
 *
 * Layout cues from redesign/web/surveys-list.html and Scholarships edit patterns.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getSurvey } from '@/lib/api/surveys';

import { SurveyForm } from '../../_components/survey-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function EditSurveyPage({ params }: PageProps) {
  const survey = await getSurvey(params.id);
  if (!survey) notFound();

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href={`/surveys/${survey.id}`}>
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to survey
        </Link>
      </Button>

      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          Edit survey
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Update details and questions for {survey.name}.
        </p>
      </div>

      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="text-base">Survey details</CardTitle>
          <CardDescription>
            Closed surveys cannot be updated by the API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SurveyForm mode="edit" survey={survey} />
        </CardContent>
      </Card>
    </div>
  );
}
