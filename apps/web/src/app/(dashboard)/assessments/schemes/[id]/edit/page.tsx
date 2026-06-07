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
  params: { id: string };
}

export default async function EditGradingSchemePage({ params }: PageProps) {
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
      <Button asChild variant="ghost" size="sm">
        <Link href="/assessments">
          <ArrowLeft className="me-2 h-4 w-4" aria-hidden="true" />
          Back to assessments
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle id="edit-scheme-heading">Edit {scheme.name}</CardTitle>
          <CardDescription>
            Update scheme range and grade thresholds. Existing assessment items
            referencing this scheme will continue to use the new bounds
            (Requirement 8.1).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GradingSchemeForm
            mode="edit"
            schemeId={scheme.id}
            initialValues={initialValues}
          />
        </CardContent>
      </Card>
    </section>
  );
}
