/**
 * /students/[id] — Student profile page (Server Component).
 *
 * Layout uses tabs for: overview, enrollment history, guardians, custom fields,
 * attendance summary. Data is loaded in parallel from student, enrollment, and
 * custom-field services through the API gateway.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, Pencil, ArrowRightLeft } from 'lucide-react';

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
  getEnrollmentHistory,
  getStudent,
  getStudentCustomFields,
  getStudentEnrollments,
  getTransferRecords,
  type CustomFieldDefinition,
  type EnrollmentEntry,
  type EnrollmentHistoryEntry,
  type Student,
  type TransferRecord,
} from '@/lib/api/students';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function StudentProfilePage({ params }: PageProps) {
  const studentId = params.id;
  const [student, enrollments, history, transfers, customFields] = await Promise.all([
    getStudent(studentId),
    getStudentEnrollments(studentId),
    getEnrollmentHistory(studentId),
    getTransferRecords(studentId),
    getStudentCustomFields(),
  ]);

  if (!student) {
    notFound();
  }

  const currentEnrollment = enrollments.find((e) => e.status === 'ENROLLED') ?? null;
  const currentStatus = currentEnrollment?.status ?? 'UNKNOWN';

  return (
    <section aria-labelledby="student-profile-heading" className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/students">
            <ArrowLeft className="me-2 h-4 w-4" aria-hidden="true" />
            Back to students
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1
            id="student-profile-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            {student.firstName} {student.lastName}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
            <span>DOB: {student.dateOfBirth}</span>
            <span aria-hidden="true">•</span>
            <span className="capitalize">{student.gender}</span>
            {student.nationalId && (
              <>
                <span aria-hidden="true">•</span>
                <span>National ID: {student.nationalId}</span>
              </>
            )}
            <Badge variant={currentStatus === 'ENROLLED' ? 'success' : 'secondary'}>
              {titleCase(currentStatus)}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/students/${student.id}/transfer`}>
              <ArrowRightLeft className="me-2 h-4 w-4" aria-hidden="true" />
              Request transfer
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/students/${student.id}/edit`}>
              <Pencil className="me-2 h-4 w-4" aria-hidden="true" />
              Edit student
            </Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList aria-label="Student information sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="enrollment">Enrollment</TabsTrigger>
          <TabsTrigger value="guardians">Guardians</TabsTrigger>
          <TabsTrigger value="custom-fields">Custom fields</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <OverviewTab student={student} currentEnrollment={currentEnrollment} />
        </TabsContent>

        <TabsContent value="enrollment" className="space-y-4">
          <EnrollmentTab
            enrollments={enrollments}
            history={history}
            transfers={transfers}
          />
        </TabsContent>

        <TabsContent value="guardians" className="space-y-4">
          <GuardiansTab student={student} />
        </TabsContent>

        <TabsContent value="custom-fields" className="space-y-4">
          <CustomFieldsTab customFields={customFields} student={student} />
        </TabsContent>

        <TabsContent value="attendance" className="space-y-4">
          <AttendanceSummaryTab studentId={student.id} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

/* ------------------------------------------------------------- Overview tab */

interface OverviewTabProps {
  student: Student;
  currentEnrollment: EnrollmentEntry | null;
}

function OverviewTab({ student, currentEnrollment }: OverviewTabProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Personal information</CardTitle>
          <CardDescription>Identity and demographics.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <DefItem label="First name" value={student.firstName} />
            <DefItem label="Last name" value={student.lastName} />
            <DefItem label="Date of birth" value={student.dateOfBirth} />
            <DefItem label="Gender" value={student.gender} />
            <DefItem label="National ID" value={student.nationalId ?? '—'} />
            <DefItem label="Nationality" value={student.nationality ?? '—'} />
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Current enrollment</CardTitle>
          <CardDescription>Active institution and academic period.</CardDescription>
        </CardHeader>
        <CardContent>
          {currentEnrollment ? (
            <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <DefItem label="Institution" value={currentEnrollment.institutionId} />
              <DefItem label="Grade" value={currentEnrollment.gradeId} />
              <DefItem
                label="Class"
                value={currentEnrollment.classId ?? '—'}
              />
              <DefItem
                label="Enrolled on"
                value={currentEnrollment.enrolledAt}
              />
              <DefItem
                label="Academic period"
                value={currentEnrollment.academicPeriodId}
              />
              <DefItem label="Status" value={titleCase(currentEnrollment.status)} />
            </dl>
          ) : (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No active enrollment on file.
            </p>
          )}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Contacts</CardTitle>
        </CardHeader>
        <CardContent>
          {student.contacts.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No contacts on file.
            </p>
          ) : (
            <Table aria-label="Student contacts">
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Primary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {student.contacts.map((contact, idx) => (
                  <TableRow key={`${contact.type}-${idx}`}>
                    <TableCell className="capitalize">{contact.type}</TableCell>
                    <TableCell>{contact.value}</TableCell>
                    <TableCell>{contact.isPrimary ? 'Yes' : 'No'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------- Enrollment tab */

interface EnrollmentTabProps {
  enrollments: EnrollmentEntry[];
  history: EnrollmentHistoryEntry[];
  transfers: TransferRecord[];
}

function EnrollmentTab({ enrollments, history, transfers }: EnrollmentTabProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Enrollment timeline</CardTitle>
          <CardDescription>
            All enrollment status changes (Requirement 6.2).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No enrollment history yet.
            </p>
          ) : (
            <Table aria-label="Enrollment history">
              <TableHeader>
                <TableRow>
                  <TableHead>Effective date</TableHead>
                  <TableHead>Previous status</TableHead>
                  <TableHead>New status</TableHead>
                  <TableHead>Institution</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.effectiveDate}</TableCell>
                    <TableCell>{entry.previousStatus ?? '—'}</TableCell>
                    <TableCell>{titleCase(entry.newStatus)}</TableCell>
                    <TableCell>{entry.institutionId}</TableCell>
                    <TableCell className="max-w-xs truncate" title={entry.reason ?? ''}>
                      {entry.reason ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enrollments</CardTitle>
          <CardDescription>All enrollments past and present.</CardDescription>
        </CardHeader>
        <CardContent>
          {enrollments.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No enrollments recorded.
            </p>
          ) : (
            <Table aria-label="All enrollments">
              <TableHeader>
                <TableRow>
                  <TableHead>Institution</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Enrolled</TableHead>
                  <TableHead>Exited</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.institutionId}</TableCell>
                    <TableCell>{entry.gradeId}</TableCell>
                    <TableCell>{entry.academicPeriodId}</TableCell>
                    <TableCell>{entry.enrolledAt}</TableCell>
                    <TableCell>{entry.exitedAt ?? '—'}</TableCell>
                    <TableCell>
                      <Badge
                        variant={entry.status === 'ENROLLED' ? 'success' : 'secondary'}
                      >
                        {titleCase(entry.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transfers</CardTitle>
          <CardDescription>Inter-institution transfer records.</CardDescription>
        </CardHeader>
        <CardContent>
          {transfers.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No transfers on record.
            </p>
          ) : (
            <Table aria-label="Transfer records">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((transfer) => (
                  <TableRow key={transfer.id}>
                    <TableCell>{transfer.transferDate}</TableCell>
                    <TableCell>{transfer.sourceInstitutionId}</TableCell>
                    <TableCell>{transfer.destinationInstitutionId}</TableCell>
                    <TableCell className="max-w-xs truncate" title={transfer.reason}>
                      {transfer.reason}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ Guardians tab */

function GuardiansTab({ student }: { student: Student }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Guardians</CardTitle>
        <CardDescription>Parents and other guardians.</CardDescription>
      </CardHeader>
      <CardContent>
        {student.guardians.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No guardians on file.
          </p>
        ) : (
          <Table aria-label="Guardians">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Relationship</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {student.guardians.map((g, idx) => (
                <TableRow key={g.id ?? `${g.firstName}-${idx}`}>
                  <TableCell className="font-medium">
                    {g.firstName} {g.lastName}
                  </TableCell>
                  <TableCell className="capitalize">{g.relationship}</TableCell>
                  <TableCell>{g.contactPhone ?? '—'}</TableCell>
                  <TableCell>{g.contactEmail ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------- Custom fields tab */

function CustomFieldsTab({
  customFields,
  student,
}: {
  customFields: CustomFieldDefinition[];
  student: Student;
}) {
  if (customFields.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Custom fields</CardTitle>
          <CardDescription>
            No custom fields configured for students yet.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom fields</CardTitle>
        <CardDescription>
          Tenant-specific data captured beyond the core schema (Requirement 6.5).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          {customFields.map((field) => (
            <DefItem
              key={field.id}
              label={field.label}
              value={formatCustomValue(student.customData[field.fieldKey])}
            />
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/* ----------------------------------------------------- Attendance summary */

function AttendanceSummaryTab({ studentId }: { studentId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance summary</CardTitle>
        <CardDescription>
          Summary will populate once attendance has been recorded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Detailed attendance will appear here when the attendance module is wired
          up. Student ID: {studentId}.
        </p>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- helpers */

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

function formatCustomValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
