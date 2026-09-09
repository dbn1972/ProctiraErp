/**
 * Examination candidates tab.
 *
 * Validates: Requirement 10.1 — manage candidate registration.
 * G-902: reads GET /examinations/:id/candidates and registers via Server Action.
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
import { RegisterCandidateDialog } from '@/components/examinations/exam-ops-controls';
import { getExamination, listExaminationCandidates } from '@/lib/api/examinations';

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function ExaminationCandidatesPage(props: PageProps) {
  const params = await props.params;
  const [examination, candidates] = await Promise.all([
    getExamination(params.id),
    listExaminationCandidates(params.id),
  ]);
  if (!examination) notFound();

  const centerName = new Map(examination.centers.map((c) => [c.id, c.name]));
  const subjectCode = new Map(examination.subjects.map((s) => [s.id, s.code]));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Candidates</CardTitle>
          <CardDescription>
            {candidates.length.toLocaleString()} registered candidates.
          </CardDescription>
        </div>
        <RegisterCandidateDialog examination={examination} />
      </CardHeader>
      <CardContent>
        {candidates.length === 0 ? (
          <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
            No candidates registered yet.
          </p>
        ) : (
          <Table aria-label="Candidates">
            <TableHeader>
              <TableRow>
                <TableHead>Registration #</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Centre</TableHead>
                <TableHead>Subjects</TableHead>
                <TableHead>Registered on</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.map((candidate) => (
                <TableRow key={candidate.id}>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {candidate.id.slice(0, 8).toUpperCase()}
                    </code>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{candidate.studentId}</TableCell>
                  <TableCell>{centerName.get(candidate.centerId) ?? candidate.centerId}</TableCell>
                  <TableCell className="text-xs">
                    {candidate.subjectIds.map((id) => subjectCode.get(id) ?? id).join(', ')}
                  </TableCell>
                  <TableCell>{formatDateTime(candidate.registeredAt)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        candidate.status === 'CONFIRMED'
                          ? 'success'
                          : candidate.status === 'WITHDRAWN'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      {candidate.status}
                    </Badge>
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
