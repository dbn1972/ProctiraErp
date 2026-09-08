/**
 * Examination results tab.
 *
 * Validates: Requirement 10.1 — record and review examination results.
 */
import { Download, Upload } from 'lucide-react';

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
import { listExaminationResults } from '@/lib/api/examinations';

interface PageProps {
  params: { id: string };
}

export default async function ExaminationResultsPage({ params }: PageProps) {
  const results = await listExaminationResults(params.id);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Results</CardTitle>
          <CardDescription>{results.length.toLocaleString()} entries.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Upload className="me-2 h-4 w-4" aria-hidden="true" />
            Upload results
          </Button>
          <Button variant="outline">
            <Download className="me-2 h-4 w-4" aria-hidden="true" />
            Download CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {results.length === 0 ? (
          <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
            Results have not been entered yet.
          </p>
        ) : (
          <Table aria-label="Results">
            <TableHeader>
              <TableRow>
                <TableHead>Registration #</TableHead>
                <TableHead>Student</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((result) => (
                <TableRow key={result.id}>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {result.registrationNumber}
                    </code>
                  </TableCell>
                  <TableCell className="font-medium">{result.studentName}</TableCell>
                  <TableCell className="text-right">
                    {result.totalScore !== null ? `${result.totalScore} / ${result.maxScore}` : '—'}
                  </TableCell>
                  <TableCell>{result.grade ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={result.status === 'PUBLISHED' ? 'success' : 'warning'}>
                      {result.status}
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
