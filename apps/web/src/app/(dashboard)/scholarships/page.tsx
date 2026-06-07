/**
 * Scholarship programs list (Server Component).
 *
 * Validates: Requirement 11.1 — scholarship program management entry point.
 */
import Link from 'next/link';
import { Award, Plus } from 'lucide-react';

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
import {
  listScholarshipPrograms,
  type ScholarshipProgram,
} from '@/lib/api/scholarships';

export const dynamic = 'force-dynamic';

export default async function ScholarshipsPage() {
  const programs = await listScholarshipPrograms();

  return (
    <section aria-labelledby="programs-heading" className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="programs-heading" className="text-2xl font-semibold tracking-tight">
            Scholarship programs
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage scholarship offers, eligibility windows, and award allocations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/scholarships/applications">View applications</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/scholarships/disbursements">View disbursements</Link>
          </Button>
          <Button asChild>
            <Link href="/scholarships/programs/new">
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />
              New program
            </Link>
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All programs</CardTitle>
          <CardDescription>
            {programs.length.toLocaleString()} programs configured.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {programs.length === 0 ? (
            <EmptyState />
          ) : (
            <ProgramsTable items={programs} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
      <Award className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-base font-medium">No scholarship programs yet</p>
      <p className="text-sm text-muted-foreground">
        Create your first scholarship program to start accepting applications.
      </p>
      <Button asChild className="mt-2">
        <Link href="/scholarships/programs/new">Create program</Link>
      </Button>
    </div>
  );
}

function ProgramsTable({ items }: { items: ScholarshipProgram[] }) {
  return (
    <Table aria-label="Scholarship programs">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Code</TableHead>
          <TableHead className="text-right">Slots</TableHead>
          <TableHead className="text-right">Award</TableHead>
          <TableHead>Application window</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-end">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((program) => (
          <TableRow key={program.id}>
            <TableCell className="font-medium">
              <Link
                href={`/scholarships/programs/${program.id}`}
                className="text-primary hover:underline"
              >
                {program.name}
              </Link>
            </TableCell>
            <TableCell>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{program.code}</code>
            </TableCell>
            <TableCell className="text-right">{program.totalSlots.toLocaleString()}</TableCell>
            <TableCell className="text-right">
              {program.currency} {program.awardAmount.toLocaleString()}
            </TableCell>
            <TableCell>
              {program.applicationStartDate} → {program.applicationEndDate}
            </TableCell>
            <TableCell>
              <Badge variant={program.status === 'OPEN' ? 'success' : 'secondary'}>
                {program.status}
              </Badge>
            </TableCell>
            <TableCell className="text-end">
              <Button asChild variant="ghost" size="sm">
                <Link href={`/scholarships/programs/${program.id}`}>View</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
