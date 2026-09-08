/**
 * /assessments/results — Bulk result entry data grid.
 *
 * Implements Requirement 8.4 / 8.8: data grid bulk entry, score range
 * validation, and Excel import (up to 5000 rows per operation).
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
import { getAssessmentItems, getStudentResults, listGradingSchemes } from '@/lib/api/assessments';
import { listAcademicPeriods, listSubjects, type SubjectSummary } from '@/lib/institutions/api';
import type { AcademicPeriod } from '@/lib/institutions/types';

import { ResultsEntryGrid } from '../_components/results-entry-grid';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function readStringParam(params: Awaited<PageProps['searchParams']>, key: string): string {
  if (!params) return '';
  const value = params[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0] ?? '';
  return '';
}

export default async function AssessmentResultsPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const subjectId = readStringParam(searchParams, 'subjectId');
  const academicPeriodId = readStringParam(searchParams, 'academicPeriodId');

  const [schemesResponse, subjects, academicPeriods, items, results] = await Promise.all([
    listGradingSchemes({ pageSize: 100 }),
    listSubjects().catch(() => [] as SubjectSummary[]),
    listAcademicPeriods().catch(() => [] as AcademicPeriod[]),
    subjectId && academicPeriodId
      ? getAssessmentItems(subjectId, academicPeriodId)
      : Promise.resolve(null),
    subjectId && academicPeriodId
      ? getStudentResults(subjectId, academicPeriodId)
      : Promise.resolve([]),
  ]);

  const schemeForSubject = items?.gradingSchemeId
    ? (schemesResponse.data.find((s) => s.id === items.gradingSchemeId) ?? null)
    : null;

  return (
    <section aria-labelledby="results-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/assessments">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to assessments
        </Link>
      </Button>

      <div>
        <h1 id="results-heading" className="text-3xl font-extrabold tracking-tight text-foreground">
          Result entry
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bulk entry via data grid; supports Excel import (up to 5,000 rows). Scores are validated
          against the grading scheme range.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entry grid</CardTitle>
          <CardDescription>
            Pick a subject and academic period to load assessment items and previously recorded
            results for editing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResultsEntryGrid
            defaultSubjectId={subjectId}
            defaultAcademicPeriodId={academicPeriodId}
            subjects={subjects.map((s) => ({
              id: s.id,
              name: s.name,
              code: s.code,
            }))}
            academicPeriods={academicPeriods.map((p) => ({
              id: p.id,
              name: p.name,
            }))}
            items={
              items?.items.map((it) => ({
                id: it.id,
                name: it.name,
                minScore: it.minScore,
                maxScore: it.maxScore,
                weight: it.weight,
              })) ?? []
            }
            existingResults={results.map((r) => ({
              studentId: r.studentId,
              itemScores: r.itemScores.map((s) => ({
                assessmentItemId: s.assessmentItemId,
                score: s.score,
              })),
              weightedAverage: r.weightedAverage,
              grade: r.grade,
            }))}
            scheme={
              schemeForSubject
                ? {
                    id: schemeForSubject.id,
                    name: schemeForSubject.name,
                    minValue: schemeForSubject.minValue,
                    maxValue: schemeForSubject.maxValue,
                  }
                : null
            }
          />
        </CardContent>
      </Card>
    </section>
  );
}
