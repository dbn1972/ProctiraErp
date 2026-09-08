/**
 * /assessments/schemes/[id]/edit — Edit grading scheme.
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
import { getGradingScheme } from '@/lib/api/assessments';
import type { GradingSchemeFormValues } from '@/lib/validation/assessment-schema';

import { GradingSchemeForm } from '../../../_components/grading-scheme-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditGradingSchemePage(props: PageProps) {
  const params = await props.params;
  const scheme = await getGradingScheme(params.id);
  if (!scheme) {
    notFound();
  }

  const initialValues: GradingSchemeFormValues = {
    name: scheme.name,
    type: scheme.type,
    minValue: scheme.minValue,
    maxValue: scheme.maxValue,
    thresholds: scheme.thresholds.map((t) => ({
      grade: t.grade,
      minScore: t.minScore,
      maxScore: t.maxScore,
      descriptor: t.descriptor ?? '',
    })),
  };

  return (
    <section aria-labelledby="edit-scheme-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/assessments">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to assessments
        </Link>
      </Button>

      <div>
        <h1
          id="edit-scheme-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          Edit {scheme.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Update scheme range and grade thresholds. Existing assessment items referencing this
          scheme will continue to use the new bounds.
        </p>
      </div>

      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="text-base">Scheme definition</CardTitle>
          <CardDescription>Scale type, value range, and grade bands.</CardDescription>
        </CardHeader>
        <CardContent>
          <GradingSchemeForm mode="edit" schemeId={scheme.id} initialValues={initialValues} />
        </CardContent>
      </Card>
    </section>
  );
}
