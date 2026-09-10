/**
 * /assessments/report-cards — published grade state per class + report-card jobs (G-907).
 */
import Link from 'next/link';

import { ArrowLeft } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import {
  listGradebookSections,
  listPublishedGradeEntries,
  listReportCardJobs,
  readGradeWorkflowStatus,
  listGradeEntries,
} from '@/lib/api/gradebook';
import { listInstitutions } from '@/lib/institutions/api';

export const dynamic = 'force-dynamic';

export default async function AssessmentReportCardsPage() {
  const [institutions, jobsResult] = await Promise.all([
    listInstitutions({ pageSize: 50 }).catch(() => ({
      data: [] as Array<{ id: string; name: string }>,
    })),
    listReportCardJobs(),
  ]);
  const jobs = jobsResult.ok ? jobsResult.data : [];
  const institutionList = 'data' in institutions ? institutions.data : [];
  const firstInstitutionId = institutionList[0]?.id;

  const sectionsResult = firstInstitutionId
    ? await listGradebookSections({ institutionId: firstInstitutionId })
    : { ok: true as const, data: [] };
  const sections = sectionsResult.ok ? sectionsResult.data : [];

  const classRows = await Promise.all(
    sections.slice(0, 20).map(async (section) => {
      const [all, published] = await Promise.all([
        listGradeEntries({ sectionId: section.id }),
        listPublishedGradeEntries({ sectionId: section.id }),
      ]);
      const entries = all.ok ? all.data : [];
      const publishedCount = published.ok
        ? published.data.length
        : entries.filter((e) => readGradeWorkflowStatus(e) === 'PUBLISHED').length;
      return {
        section,
        total: entries.length,
        published: publishedCount,
      };
    }),
  );

  return (
    <section className="space-y-6" aria-labelledby="report-cards-heading">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ms-2 mb-1">
          <Link href="/assessments">
            <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
            Assessment schemes
          </Link>
        </Button>
        <h1
          id="report-cards-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          Report cards
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Published grades per class and queued report-card jobs. Transcripts live on student
          records.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-base font-semibold">Classes</h2>
          {classRows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="report-cards-empty">
              No gradebook sections yet. Open an institution gradebook to enter and publish grades.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm" data-testid="report-cards-classes">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 pe-3 font-medium">Class</th>
                    <th className="py-2 pe-3 font-medium">Entries</th>
                    <th className="py-2 pe-3 font-medium">Published</th>
                    <th className="py-2 font-medium">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {classRows.map((row) => (
                    <tr
                      key={row.section.id}
                      className="border-b border-border/60"
                      data-testid="report-card-class-row"
                    >
                      <td className="py-2 pe-3">
                        {row.section.code} — {row.section.name}
                      </td>
                      <td className="py-2 pe-3 tabular-nums">{row.total}</td>
                      <td className="py-2 pe-3 tabular-nums" data-testid="published-count">
                        {row.published}
                      </td>
                      <td className="py-2">
                        <Link
                          className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
                          href={`/institutions/${row.section.institutionId}/gradebook?sectionId=${row.section.id}`}
                        >
                          Gradebook
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            <Link
              href="/students/records"
              className="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
            >
              Student records
            </Link>
            {' · '}
            official transcripts and report-card job status.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-base font-semibold">Report-card jobs</h2>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No report-card jobs queued.</p>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="report-card-jobs">
              {jobs.slice(0, 20).map((job) => (
                <li key={job.id}>
                  {job.id.slice(0, 8)} · {job.status}
                  {job.artifactUri ? ` · ${job.artifactUri}` : ''}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
