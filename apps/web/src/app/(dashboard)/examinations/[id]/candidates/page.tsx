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
import { resolveEntityLabel } from '@/lib/entity-label';
import { loadStudentOptions } from '@/lib/load-entity-labels';

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
  const [examination, candidates, studentOptions] = await Promise.all([
    getExamination(params.id),
    listExaminationCandidates(params.id),
    loadStudentOptions(),
  ]);
  if (!examination) notFound();

  const studentLabels = new Map(studentOptions.map((option) => [option.id, option.label]));
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
        <RegisterCandidateDialog examination={examination} studentOptions={studentOptions} />
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
                    <span className="text-xs text-muted-foreground">
                      {resolveEntityLabel(candidate.id, {}, 'Reg')}
                    </span>
                  </TableCell>
                  <TableCell>
                    {resolveEntityLabel(candidate.studentId, studentLabels, 'Student')}
                  </TableCell>
                  <TableCell>
                    {centerName.get(candidate.centerId) ??
                      resolveEntityLabel(candidate.centerId, {}, 'Centre')}
                  </TableCell>
                  <TableCell className="text-xs">
                    {candidate.subjectIds
                      .map((id) => subjectCode.get(id) ?? resolveEntityLabel(id, {}, 'Subject'))
                      .join(', ')}
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
