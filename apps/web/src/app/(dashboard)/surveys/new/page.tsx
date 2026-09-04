/**
 * Create survey (ProctiraERP).
 *
 * Layout cues from redesign/web/surveys-list.html (New survey CTA) and
 * Transport / Scholarships form patterns.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';

import { SurveyForm } from '../_components/survey-form';

export const dynamic = 'force-dynamic';

export default function NewSurveyPage() {
  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/surveys">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Surveys
        </Link>
      </Button>

      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          New survey
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Design questions, then publish and distribute to institutions.
        </p>
      </div>

      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="text-base">Survey details</CardTitle>
          <CardDescription>
            Name the survey and add at least one question. You can distribute
            after publishing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SurveyForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
