/**
 * Examination results tab.
 *
 * Validates: Requirement 10.1 — record and review examination results.
 * G-902: merges recorded marks (POST /results/marks) with the publication
 * (POST /results/publish) and exposes working upload / publish controls.
 */
import { notFound } from 'next/navigation';

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { ResultsControls } from '@/components/examinations/exam-ops-controls';
import { getExamination, getExaminationResultsView } from '@/lib/api/examinations';

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_VARIANT = {
  PUBLISHED: 'success',
  PENDING: 'warning',
  INCOMPLETE: 'secondary',
} as const;

export default async function ExaminationResultsPage(props: PageProps) {
  const params = await props.params;
  const examination = await getExamination(params.id);
  if (!examination) notFound();
  const view = await getExaminationResultsView(examination);

  const csv = [
    ['studentId', ...view.subjects.map((s) => s.code), 'total', 'status'].join(','),
    ...view.rows.map((row) =>
      [
        row.studentId,
        ...row.subjects.map((s) => (s.score === null ? '' : String(s.score))),
        row.totalScore === null ? '' : String(row.totalScore),
        row.status,
      ].join(','),
    ),
  ].join('\n');

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Results</CardTitle>
          <CardDescription>
            {view.rows.length.toLocaleString()} candidates with recorded marks
            {view.publishedAt
              ? ` · published ${new Date(view.publishedAt).toLocaleString('en-GB')}`
              : ' · not yet published'}
            .
          </CardDescription>
        </div>
        <ResultsControls
          examination={examination}
          published={view.published}
          subjects={view.subjects}
          csv={csv}
        />
      </CardHeader>
      <CardContent>
        {view.rows.length === 0 ? (
          <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
            Results have not been entered yet. Use “Upload marks” to record scores for registered
            candidates.
          </p>
        ) : (
          <Table aria-label="Results">
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                {view.subjects.map((subject) => (
                  <TableHead key={subject.id} className="text-end">
                    {subject.code}
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      / {subject.maxScore}
                    </span>
                  </TableHead>
                ))}
                <TableHead className="text-end">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.rows.map((row) => (
                <TableRow key={row.candidateId}>
                  <TableCell className="font-mono text-xs">{row.studentId}</TableCell>
                  {row.subjects.map((subject) => (
                    <TableCell key={subject.id} className="text-end">
                      {subject.score === null ? '—' : subject.score}
                      {subject.grade && (
                        <Badge variant="outline" className="ms-1.5">
                          {subject.grade}
                        </Badge>
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="text-end">
                    {row.totalScore !== null ? `${row.totalScore} / ${row.maxScore}` : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
