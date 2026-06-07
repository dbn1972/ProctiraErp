/**
 * Examination candidates tab.
 *
 * Validates: Requirement 10.1 — manage candidate registration.
 */
import { Plus } from 'lucide-react';

import {
  Badge,
  Button,
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
import { listExaminationCandidates } from '@/lib/api/examinations';

interface PageProps {
  params: { id: string };
}

export default async function ExaminationCandidatesPage({ params }: PageProps) {
  const candidates = await listExaminationCandidates(params.id);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Candidates</CardTitle>
          <CardDescription>
            {candidates.length.toLocaleString()} registered candidates.
          </CardDescription>
        </div>
        <Button>
          <Plus className="me-2 h-4 w-4" aria-hidden="true" />
          Register candidate
        </Button>
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
                <TableHead>Registered on</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.map((candidate) => (
                <TableRow key={candidate.id}>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {candidate.registrationNumber}
                    </code>
                  </TableCell>
                  <TableCell className="font-medium">{candidate.studentName}</TableCell>
                  <TableCell>{candidate.registrationDate}</TableCell>
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
