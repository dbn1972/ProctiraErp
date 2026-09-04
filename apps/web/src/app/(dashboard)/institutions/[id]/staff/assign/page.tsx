/**
 * Pick a staff member to assign to this institution.
 *
 * Cite: redesign/web/institutions-detail.html Staff tab + staff-assignment-new.html
 *
 * Assignment creation requires a staffId (`POST /staff/assignments`). This
 * picker lists tenant staff and continues to the existing assignment form
 * with `institutionId` prefilled.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { listStaff } from '@/lib/api/staff';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function InstitutionStaffAssignPage({ params }: PageProps) {
  const staff = await listStaff({ pageSize: 100, sortBy: 'lastName', sortOrder: 'asc' });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">
            Add assignment
          </h2>
          <p className="text-sm text-muted-foreground">
            Choose a staff member, then set class, subject, and allocation for this institution.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/institutions/${params.id}/staff`}>
            <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
            Back to staff
          </Link>
        </Button>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {staff.data.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <p className="text-base font-semibold">No staff records</p>
              <p className="text-sm text-muted-foreground">
                Create a staff record before adding an assignment.
              </p>
              <Button asChild size="sm" className="mt-2">
                <Link href="/staff/new">Add staff</Link>
              </Button>
            </div>
          ) : (
            <Table aria-label="Select staff for assignment">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Staff member</TableHead>
                  <TableHead className="font-semibold">Position</TableHead>
                  <TableHead className="text-end font-semibold">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.data.map((member) => {
                  const fullName = `${member.firstName} ${member.lastName}`;
                  return (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">{fullName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {member.position || '—'}
                      </TableCell>
                      <TableCell className="text-end">
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/staff/${member.id}/assignments/new?institutionId=${encodeURIComponent(params.id)}`}
                          >
                            Continue
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
