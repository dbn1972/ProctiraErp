/**
 * Examination definitions list (Server Component).
 *
 * Validates: Requirement 10.1 — examination definition browse / management.
 */
import Link from 'next/link';
import { FileText, Plus } from 'lucide-react';

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
import { listExaminations, type Examination } from '@/lib/api/examinations';

export const dynamic = 'force-dynamic';

export default async function ExaminationsPage() {
  const examinations = await listExaminations();

  return (
    <section aria-labelledby="examinations-heading" className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="examinations-heading" className="text-2xl font-semibold tracking-tight">
            Examinations
          </h1>
          <p className="text-sm text-muted-foreground">
            Browse, define, and manage examination cycles.
          </p>
        </div>
        <Button asChild>
          <Link href="/examinations/new">
            <Plus className="me-2 h-4 w-4" aria-hidden="true" />
            New examination
          </Link>
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All examinations</CardTitle>
          <CardDescription>
            {examinations.length.toLocaleString()} examinations configured.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {examinations.length === 0 ? (
            <EmptyState />
          ) : (
            <ExaminationsTable items={examinations} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
      <FileText className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-base font-medium">No examinations yet</p>
      <p className="text-sm text-muted-foreground">
        Create your first examination definition to get started.
      </p>
      <Button asChild className="mt-2">
        <Link href="/examinations/new">Create examination</Link>
      </Button>
    </div>
  );
}

function ExaminationsTable({ items }: { items: Examination[] }) {
  return (
    <Table aria-label="Examinations">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Code</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Candidates</TableHead>
          <TableHead className="text-end">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((exam) => (
          <TableRow key={exam.id}>
            <TableCell className="font-medium">
              <Link
                href={`/examinations/${exam.id}`}
                className="text-primary hover:underline"
              >
                {exam.name}
              </Link>
            </TableCell>
            <TableCell>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{exam.code}</code>
            </TableCell>
            <TableCell>{exam.examinationDate}</TableCell>
            <TableCell>
              <ExaminationStatus status={exam.status} />
            </TableCell>
            <TableCell className="text-right">
              {exam.candidateCount?.toLocaleString() ?? '—'}
            </TableCell>
            <TableCell className="text-end">
              <Button asChild variant="ghost" size="sm">
                <Link href={`/examinations/${exam.id}`}>View</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ExaminationStatus({ status }: { status: Examination['status'] }) {
  switch (status) {
    case 'OPEN':
      return <Badge variant="success">Open</Badge>;
    case 'COMPLETED':
      return <Badge variant="outline">Completed</Badge>;
    case 'CANCELLED':
      return <Badge variant="destructive">Cancelled</Badge>;
    case 'CLOSED':
      return <Badge variant="secondary">Closed</Badge>;
    default:
      return <Badge variant="warning">Draft</Badge>;
  }
}
