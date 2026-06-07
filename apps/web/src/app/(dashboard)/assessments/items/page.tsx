/**
 * /assessments/items — Configure assessment items per subject + period.
 *
 * Implements Requirement 8.2/8.3: up to 50 items per subject per academic
 * period; weights must sum to exactly 100%.
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
import {
  getAssessmentItems,
  listGradingSchemes,
} from '@/lib/api/assessments';
import {
  listAcademicPeriods,
  listSubjects,
  type SubjectSummary,
} from '@/lib/institutions/api';
import type { AcademicPeriod } from '@/lib/institutions/types';

import { AssessmentItemsForm } from '../_components/assessment-items-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function readStringParam(
  params: PageProps['searchParams'],
  key: string,
): string {
  if (!params) return '';
  const value = params[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0] ?? '';
  return '';
}

export default async function AssessmentItemsPage({ searchParams }: PageProps) {
  const subjectId = readStringParam(searchParams, 'subjectId');
  const academicPeriodId = readStringParam(searchParams, 'academicPeriodId');

  const [schemesResponse, subjects, academicPeriods, existing] =
    await Promise.all([
      listGradingSchemes({ pageSize: 100 }),
      listSubjects().catch(() => [] as SubjectSummary[]),
      listAcademicPeriods().catch(() => [] as AcademicPeriod[]),
      subjectId && academicPeriodId
        ? getAssessmentItems(subjectId, academicPeriodId)
        : Promise.resolve(null),
    ]);

  return (
    <section aria-labelledby="items-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/assessments">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to assessments
        </Link>
      </Button>

      <div>
        <h1
          id="items-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          Assessment items
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define up to 50 items per subject per academic period. Weights must
          sum to exactly 100%.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
          <CardDescription>
            Choose subject, academic period, and grading scheme. Existing items
            for that combination are pre-loaded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {schemesResponse.data.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-[hsl(var(--muted-foreground))]">
              No grading schemes are defined. Create a grading scheme first.
            </p>
          ) : (
            <AssessmentItemsForm
              schemes={schemesResponse.data.map((s) => ({
                id: s.id,
                name: s.name,
                type: s.type,
              }))}
              subjects={subjects.map((s) => ({
                id: s.id,
                name: s.name,
                code: s.code,
              }))}
              academicPeriods={academicPeriods.map((p) => ({
                id: p.id,
                name: p.name,
              }))}
              defaultSubjectId={subjectId}
              defaultAcademicPeriodId={academicPeriodId}
              defaultSchemeId={existing?.gradingSchemeId ?? ''}
              defaultItems={
                existing && existing.items.length > 0
                  ? existing.items.map((it) => ({
                      name: it.name,
                      weight: it.weight,
                      minScore: it.minScore,
                      maxScore: it.maxScore,
                    }))
                  : []
              }
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
