/**
 * /assessments/outcomes — curriculum outcomes mapped to assessment items (G-907).
 */
import Link from 'next/link';

import { ArrowLeft } from 'lucide-react';

import { OutcomeCreateForm } from '../_components/outcome-create-form';
import { Button, Card, CardContent } from '@proctira/ui/components';
import { listOutcomes } from '@/lib/api/assessments';
import { listSubjects, type SubjectSummary } from '@/lib/institutions/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{ subjectId?: string }>;
}

export default async function AssessmentOutcomesPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const subjects = await listSubjects().catch(() => [] as SubjectSummary[]);
  const subjectId =
    searchParams?.subjectId && subjects.some((s) => s.id === searchParams.subjectId)
      ? searchParams.subjectId
      : (subjects[0]?.id ?? '');
  const outcomes = subjectId ? await listOutcomes(subjectId) : [];
  const active = subjects.find((s) => s.id === subjectId);

  return (
    <section className="space-y-6" aria-labelledby="outcomes-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ms-2 mb-1">
            <Link href="/assessments">
              <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
              Assessment schemes
            </Link>
          </Button>
          <h1
            id="outcomes-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Learning outcomes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Curriculum outcomes per subject. Link these IDs on assessment items.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          {subjects.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="outcomes-empty-subjects">
              No subjects yet. Create subjects under Institutions, then return here.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground" data-testid="outcomes-subject-name">
                {active ? `${active.code} — ${active.name}` : 'Subject'}
              </p>
              <OutcomeCreateForm subjects={subjects} defaultSubjectId={subjectId} />
              {outcomes.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="outcomes-empty">
                  No outcomes for this subject yet.
                </p>
              ) : (
                <ul className="divide-y divide-border" data-testid="outcomes-list">
                  {outcomes.map((row) => (
                    <li key={row.id} className="py-3" data-testid="outcome-row">
                      <p className="text-sm font-semibold">
                        {row.code} · {row.name}
                      </p>
                      {row.description ? (
                        <p className="text-sm text-muted-foreground">{row.description}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
