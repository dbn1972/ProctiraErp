/**
 * /staff/[id] — Staff profile page (Server Component).
 *
 * Layout uses tabs for: overview, assignments, appraisals, training. Data is
 * loaded in parallel from staff, assignment, appraisal, and training services
 * through the API gateway.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  ArrowLeft,
  ArrowRightLeft,
  Pencil,
  Plus,
} from 'lucide-react';

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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@proctira/ui/components';
import {
  getStaff,
  listStaffAppraisals,
  listStaffAssignments,
  listStaffCertifications,
  type Appraisal,
  type Assignment,
  type Staff,
  type TrainingCertification,
} from '@/lib/api/staff';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function StaffProfilePage({ params }: PageProps) {
  const staffId = params.id;
  const [staff, assignments, appraisals, certifications] = await Promise.all([
    getStaff(staffId),
    listStaffAssignments(staffId),
    listStaffAppraisals(staffId),
    listStaffCertifications(staffId),
  ]);

  if (!staff) {
    notFound();
  }

  return (
    <section aria-labelledby="staff-profile-heading" className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/staff">
            <ArrowLeft className="me-2 h-4 w-4" aria-hidden="true" />
            Back to staff
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1
            id="staff-profile-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            {staff.firstName} {staff.lastName}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
            <span>Position: {staff.position}</span>
            <span aria-hidden="true">•</span>
            <span>ID: {staff.identityNumber}</span>
            <span aria-hidden="true">•</span>
            <span>DOB: {staff.dateOfBirth}</span>
            <Badge variant={staff.status === 'ACTIVE' ? 'success' : 'secondary'}>
              {titleCase(staff.status)}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/staff/${staff.id}/assignments/new`}>
              <ArrowRightLeft className="me-2 h-4 w-4" aria-hidden="true" />
              New assignment
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/staff/${staff.id}/appraisals/new`}>
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />
              New appraisal
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/staff/${staff.id}/edit`}>
              <Pencil className="me-2 h-4 w-4" aria-hidden="true" />
              Edit
            </Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList aria-label="Staff information sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="appraisals">Appraisals</TabsTrigger>
          <TabsTrigger value="training">Training</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <OverviewTab staff={staff} />
        </TabsContent>

        <TabsContent value="assignments" className="space-y-4">
          <AssignmentsTab assignments={assignments} staffId={staff.id} />
        </TabsContent>

        <TabsContent value="appraisals" className="space-y-4">
          <AppraisalsTab appraisals={appraisals} staffId={staff.id} />
        </TabsContent>

        <TabsContent value="training" className="space-y-4">
          <TrainingTab certifications={certifications} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

/* ------------------------------------------------------------- Overview tab */

function OverviewTab({ staff }: { staff: Staff }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal information</CardTitle>
        <CardDescription>Identity and contact details.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <DefItem label="First name" value={staff.firstName} />
          <DefItem label="Last name" value={staff.lastName} />
          <DefItem label="Date of birth" value={staff.dateOfBirth} />
          <DefItem label="Identity number" value={staff.identityNumber} />
          <DefItem label="Position" value={staff.position} />
          <DefItem label="Phone" value={staff.contactPhone} />
          <DefItem label="Email" value={staff.contactEmail ?? '—'} />
          <DefItem label="Status" value={titleCase(staff.status)} />
        </dl>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------- Assignments tab */

function AssignmentsTab({
  assignments,
  staffId,
}: {
  assignments: Assignment[];
  staffId: string;
}) {
  const totalAllocation = assignments
    .filter((a) => a.status === 'ACTIVE')
    .reduce((sum, a) => sum + a.allocationPercentage, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>Assignments</CardTitle>
          <CardDescription>
            Current and historical institution / class / subject assignments.
            Active total: {totalAllocation}%.
          </CardDescription>
        </div>
        <Button asChild size="sm">
          <Link href={`/staff/${staffId}/assignments/new`}>
            <Plus className="me-2 h-4 w-4" aria-hidden="true" />
            Add assignment
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {assignments.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No assignments yet.
          </p>
        ) : (
          <Table aria-label="Staff assignments">
            <TableHeader>
              <TableRow>
                <TableHead>Institution</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Allocation</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.institutionId}</TableCell>
                  <TableCell>{a.classId}</TableCell>
                  <TableCell>{a.subjectId}</TableCell>
                  <TableCell>{a.role}</TableCell>
                  <TableCell>{a.allocationPercentage}%</TableCell>
                  <TableCell>
                    {a.startDate} → {a.endDate ?? 'present'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.status === 'ACTIVE' ? 'success' : 'secondary'}>
                      {titleCase(a.status)}
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

/* ---------------------------------------------------------- Appraisals tab */

function AppraisalsTab({
  appraisals,
  staffId,
}: {
  appraisals: Appraisal[];
  staffId: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>Appraisals</CardTitle>
          <CardDescription>
            Performance appraisals routed through the workflow engine.
          </CardDescription>
        </div>
        <Button asChild size="sm">
          <Link href={`/staff/${staffId}/appraisals/new`}>
            <Plus className="me-2 h-4 w-4" aria-hidden="true" />
            New appraisal
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {appraisals.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No appraisals yet.
          </p>
        ) : (
          <Table aria-label="Staff appraisals">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Total score</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {appraisals.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.appraisalDate}</TableCell>
                  <TableCell>{a.templateId}</TableCell>
                  <TableCell>{a.totalScore.toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === 'APPROVED' ? 'success' : 'secondary'}>
                      {titleCase(a.status)}
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

/* ------------------------------------------------------------ Training tab */

function TrainingTab({
  certifications,
}: {
  certifications: TrainingCertification[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Training & certifications</CardTitle>
        <CardDescription>
          Programs attended and certifications issued (Requirement 7.4).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {certifications.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No training records yet.
          </p>
        ) : (
          <Table aria-label="Training certifications">
            <TableHeader>
              <TableRow>
                <TableHead>Certification</TableHead>
                <TableHead>Program</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {certifications.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.certificationName}</TableCell>
                  <TableCell>{c.programId}</TableCell>
                  <TableCell>{c.issuedDate}</TableCell>
                  <TableCell>{c.expiryDate ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === 'ACTIVE' ? 'success' : 'secondary'}>
                      {titleCase(c.status)}
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

/* ---------------------------------------------------------------- helpers */

function DefItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

function titleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
