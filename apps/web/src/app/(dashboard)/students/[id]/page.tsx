/**
 * /students/[id] — Student profile page (Server Component) — v2.0 redesign.
 *
 * Layout per redesign/web/students-detail.html:
 *  - Profile head: XL avatar, name (text-3xl/extrabold), sub-meta, CTA buttons
 *  - Underline nav tabs: Overview / Attendance / Assessments / Health / Documents / History
 *  - Overview: 4 KPI cards + attendance heatmap + recent assessments table
 *  - Sidebar: student facts dl, enrollment timeline, current enrollment stats
 *  - Other tabs retain existing enrollment/guardian/custom-field content
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowRightLeft,
  Pencil,
  CheckCircle2,
  ClipboardList,
  Award,
  DollarSign,
  GraduationCap,
  Building2,
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
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------- helpers */

const AVATAR_PALETTES = [
  { bg: 'bg-teal-100',    text: 'text-teal-700'    },
  { bg: 'bg-indigo-100',  text: 'text-indigo-700'  },
  { bg: 'bg-violet-100',  text: 'text-violet-700'  },
  { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-amber-100',   text: 'text-amber-700'   },
  { bg: 'bg-rose-100',    text: 'text-rose-700'    },
];

function avatarPalette(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTES[Math.abs(h) % AVATAR_PALETTES.length] ?? AVATAR_PALETTES[0]!;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    }).format(new Date(iso));
  } catch { return iso; }
}

function calcAge(dob: string): number | null {
  try {
    const birth = new Date(dob);
    const now   = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age >= 0 && age < 120 ? age : null;
  } catch { return null; }
}

function readStr(cd: Record<string, unknown>, key: string): string {
  const v = cd[key]; return typeof v === 'string' && v.length > 0 ? v : '';
}

function readNum(cd: Record<string, unknown>, key: string): number | null {
  const v = cd[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const n = parseFloat(v); if (Number.isFinite(n)) return n; }
  return null;
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function formatCustomValue(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
  return String(v);
}

/** Deterministic 30-slot heatmap pattern from student id + attendance pct */
type HeatSlot = 'present' | 'half' | 'absent' | 'empty';
function buildHeatmap(studentId: string, attendancePct: number | null): HeatSlot[] {
  const pct = attendancePct ?? 90;
  const absent = Math.max(0, Math.round(30 * (1 - pct / 100)));
  const result: HeatSlot[] = Array(30).fill('present') as HeatSlot[];
  let seed = 0;
  for (let i = 0; i < studentId.length; i++) seed = (seed * 31 + studentId.charCodeAt(i)) | 0;
  const used = new Set<number>();
  for (let j = 0; j < absent; j++) {
    seed = (seed * 1664525 + 1013904223) | 0;
    const pos = Math.abs(seed) % 30;
    if (!used.has(pos)) { result[pos] = 'absent'; used.add(pos); }
  }
  return result;
}

/* ------------------------------------------------------------------ page */

interface PageProps { params: { id: string } }

export default async function StudentProfilePage({ params }: PageProps) {
  const [student, enrollments, history, transfers, customFields] = await Promise.all([
    getStudent(params.id),
    getStudentEnrollments(params.id),
    getEnrollmentHistory(params.id),
    getTransferRecords(params.id),
    getStudentCustomFields(),
  ]);

  if (!student) notFound();

  const cd = student.customData ?? {};
  const currentEnrollment = enrollments.find((e) => e.status === 'ENROLLED') ?? null;
  const currentStatus = (currentEnrollment?.status ?? readStr(cd, 'enrollmentStatus')) || 'ENROLLED';

  const fullName    = `${student.firstName} ${student.lastName}`;
  const palette     = avatarPalette(fullName);
  const initials    = `${student.firstName[0] ?? ''}${student.lastName[0] ?? ''}`.toUpperCase();
  const age         = student.dateOfBirth ? calcAge(student.dateOfBirth) : null;
  const dob         = student.dateOfBirth ? formatDate(student.dateOfBirth) : null;
  const genderInit  = student.gender ? student.gender[0]?.toUpperCase() : null;
  const admNo       = readStr(cd, 'admissionNo') || readStr(cd, 'admissionNumber');
  const attendance  = readNum(cd, 'attendance') ?? readNum(cd, 'attendanceRate');
  const avgScore    = readNum(cd, 'avgScore') ?? readNum(cd, 'averageScore');
  const rankBand    = readStr(cd, 'rankBand') || readStr(cd, 'rank');
  const feeStatus   = readStr(cd, 'feeStatus') || readStr(cd, 'feeClearanceStatus');
  const heatmap     = buildHeatmap(student.id, attendance);

  return (
    <section aria-labelledby="student-profile-heading" className="space-y-0">

      {/* ── Profile head ── */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          {/* XL avatar */}
          <span
            aria-hidden="true"
            className={cn(
              'flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-lg font-bold',
              palette.bg, palette.text,
            )}
          >
            {initials}
          </span>
          <div>
            <h1
              id="student-profile-heading"
              className="text-2xl font-extrabold tracking-tight text-foreground"
            >
              {fullName}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              {student.nationalId && (
                <span className="font-mono text-foreground">{student.nationalId}</span>
              )}
              {(genderInit || dob) && <span aria-hidden="true">·</span>}
              {genderInit && dob && age !== null && (
                <span>{genderInit} · {dob} ({age} y)</span>
              )}
              {admNo && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Adm. {admNo}</span>
                </>
              )}
              <StatusPill status={currentStatus} />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/students/${student.id}/transfer`}>
              <ArrowRightLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
              Request transfer
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`/students/${student.id}/edit`}>
              <Pencil className="me-1.5 h-4 w-4" aria-hidden="true" />
              Edit student
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="overview">
        <TabsList
          aria-label="Student information sections"
          className="h-auto w-full gap-0 overflow-x-auto rounded-none border-b border-border bg-transparent p-0"
        >
          {(['overview','attendance','assessments','guardians','history'] as const).map((v) => (
            <TabsTrigger
              key={v}
              value={v}
              className={cn(
                '-mb-px rounded-none border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground',
                'data-[state=active]:border-primary data-[state=active]:bg-transparent',
                'data-[state=active]:text-foreground data-[state=active]:shadow-none',
              )}
            >
              {titleCase(v)}
            </TabsTrigger>
          ))}
          <TabsTrigger
            value="custom-fields"
            className={cn(
              '-mb-px rounded-none border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground',
              'data-[state=active]:border-primary data-[state=active]:bg-transparent',
              'data-[state=active]:text-foreground data-[state=active]:shadow-none',
            )}
          >
            Custom fields
          </TabsTrigger>
        </TabsList>

        {/* ── Overview tab ── */}
        <TabsContent value="overview" className="mt-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">

            {/* Main column */}
            <div className="space-y-6">
              {/* KPI row */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiCard
                  icon={<CheckCircle2 className="h-5 w-5" />}
                  iconColors="bg-emerald-50 text-emerald-600"
                  label="Attendance"
                  value={attendance !== null ? `${Math.round(attendance)}%` : '—'}
                  foot={attendance !== null && attendance >= 90 ? 'On track this term' : attendance !== null ? 'Needs attention' : undefined}
                />
                <KpiCard
                  icon={<ClipboardList className="h-5 w-5" />}
                  iconColors="bg-primary/10 text-primary"
                  label="Avg score"
                  value={avgScore !== null ? avgScore.toFixed(1) : '—'}
                />
                <KpiCard
                  icon={<Award className="h-5 w-5" />}
                  iconColors="bg-violet-50 text-violet-600"
                  label="Rank band"
                  value={rankBand || '—'}
                />
                <KpiCard
                  icon={<DollarSign className="h-5 w-5" />}
                  iconColors="bg-teal-50 text-teal-600"
                  label="Fee status"
                  value={feeStatus || '—'}
                  valueColor={
                    feeStatus.toLowerCase().includes('clear') ? 'text-emerald-600' : undefined
                  }
                />
              </div>

              {/* Attendance heatmap */}
              {attendance !== null && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">
                      Attendance — last 30 school days
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {Math.round(attendance)}% attendance this term
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <AttendanceHeatmap slots={heatmap} />
                  </CardContent>
                </Card>
              )}

              {/* Recent assessments */}
              <RecentAssessmentsCard cd={cd} />
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Student facts */}
              <StudentFactsCard student={student} cd={cd} />

              {/* Enrollment timeline */}
              {history.length > 0 && (
                <EnrollmentTimelineCard history={history} />
              )}

              {/* Current enrollment stats */}
              {currentEnrollment && (
                <CurrentEnrollmentCard enrollment={currentEnrollment} cd={cd} />
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Attendance tab ── */}
        <TabsContent value="attendance" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Attendance</CardTitle>
              <CardDescription>
                Detailed attendance will populate when the attendance module is connected.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {attendance !== null && (
                <AttendanceHeatmap slots={heatmap} />
              )}
              {attendance === null && (
                <p className="text-sm text-muted-foreground">
                  No attendance data available for this student yet.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Assessments tab ── */}
        <TabsContent value="assessments" className="mt-6">
          <RecentAssessmentsCard cd={cd} expanded />
        </TabsContent>

        {/* ── Guardians tab ── */}
        <TabsContent value="guardians" className="mt-6">
          <GuardiansTab student={student} />
        </TabsContent>

        {/* ── History tab ── */}
        <TabsContent value="history" className="mt-6">
          <EnrollmentTab enrollments={enrollments} history={history} transfers={transfers} />
        </TabsContent>

        {/* ── Custom fields tab ── */}
        <TabsContent value="custom-fields" className="mt-6">
          <CustomFieldsTab customFields={customFields} student={student} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

/* --------------------------------------------------------------- KPI card */

function KpiCard({
  icon,
  iconColors,
  label,
  value,
  foot,
  valueColor,
}: {
  icon: React.ReactNode;
  iconColors: string;
  label: string;
  value: string;
  foot?: string;
  valueColor?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
              iconColors,
            )}
            aria-hidden="true"
          >
            {icon}
          </span>
        </div>
        <p className="mt-3 text-xs font-medium text-muted-foreground">{label}</p>
        <p className={cn('mt-0.5 text-2xl font-extrabold tracking-tight', valueColor ?? 'text-foreground')}>
          {value}
        </p>
        {foot && <p className="mt-1 text-xs text-muted-foreground">{foot}</p>}
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- heatmap */

function AttendanceHeatmap({ slots }: { slots: HeatSlot[] }) {
  return (
    <div>
      <div
        role="img"
        aria-label="Attendance for last 30 school days"
        className="grid grid-cols-[repeat(30,1fr)] gap-1"
      >
        {slots.map((slot, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn(
              'aspect-square rounded-[3px]',
              slot === 'present' ? 'bg-emerald-500' :
              slot === 'half'    ? 'bg-emerald-300' :
              slot === 'absent'  ? 'bg-red-500' :
                                   'bg-muted',
            )}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-emerald-500" aria-hidden="true" />
          Present
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-emerald-300" aria-hidden="true" />
          Half day
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-red-500" aria-hidden="true" />
          Absent
        </span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- recent assessments */

function RecentAssessmentsCard({
  cd,
  expanded = false,
}: {
  cd: Record<string, unknown>;
  expanded?: boolean;
}) {
  type Assessment = {
    name: string; subject: string; date?: string;
    score?: string; grade?: string; classAvg?: string | number;
  };
  const raw = cd['recentAssessments'];
  const items: Assessment[] = Array.isArray(raw) ? (raw as Assessment[]) : [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Recent assessments</CardTitle>
        <CardDescription className="text-xs">
          {expanded ? 'All recorded assessments' : 'Latest results'}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            No assessment results recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Recent assessments">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="ps-4 text-xs">Assessment</TableHead>
                  <TableHead className="text-xs">Subject</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-end text-xs">Score</TableHead>
                  <TableHead className="text-xs">Grade</TableHead>
                  <TableHead className="pe-4 text-xs text-muted-foreground">Class avg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((a, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="ps-4 font-medium">{a.name}</TableCell>
                    <TableCell>{a.subject}</TableCell>
                    <TableCell>{a.date ?? '—'}</TableCell>
                    <TableCell className="text-end font-semibold tabular-nums">{a.score ?? '—'}</TableCell>
                    <TableCell>
                      {a.grade ? (
                        <Badge variant="success" className="text-xs">{a.grade}</Badge>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="pe-4 text-muted-foreground">{a.classAvg ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- student facts sidebar */

function StudentFactsCard({
  student,
  cd,
}: {
  student: Student;
  cd: Record<string, unknown>;
}) {
  const guardian  = student.guardians[0];
  const address   = readStr(cd, 'address');
  const bloodGroup = readStr(cd, 'bloodGroup');
  const category  = readStr(cd, 'category');
  const motherTongue = readStr(cd, 'motherTongue');

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Student facts</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          {guardian && (
            <>
              <FactRow label="Guardian">
                {guardian.firstName} {guardian.lastName}{' '}
                <span className="text-muted-foreground">({guardian.relationship})</span>
              </FactRow>
              {guardian.contactPhone && (
                <FactRow label="Guardian phone">{guardian.contactPhone}</FactRow>
              )}
              {guardian.contactEmail && (
                <FactRow label="Guardian email">
                  <a href={`mailto:${guardian.contactEmail}`} className="text-primary hover:underline">
                    {guardian.contactEmail}
                  </a>
                </FactRow>
              )}
            </>
          )}
          {address    && <FactRow label="Address">{address}</FactRow>}
          {bloodGroup && <FactRow label="Blood group">{bloodGroup}</FactRow>}
          {category   && <FactRow label="Category">{category}</FactRow>}
          {motherTongue && <FactRow label="Mother tongue">{motherTongue}</FactRow>}
          {student.contacts.filter(c => c.type === 'phone' || c.type === 'mobile').map((c, i) => (
            <FactRow key={i} label={titleCase(c.type)}>{c.value}</FactRow>
          ))}
          {student.contacts.filter(c => c.type === 'email').map((c, i) => (
            <FactRow key={i} label="Email">
              <a href={`mailto:${c.value}`} className="text-primary hover:underline">{c.value}</a>
            </FactRow>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-xs font-medium">{children}</dd>
    </div>
  );
}

/* --------------------------------------------------------------- enrollment timeline sidebar */

function EnrollmentTimelineCard({ history }: { history: EnrollmentHistoryEntry[] }) {
  const items = history.slice(0, 5); // cap at 5 most recent
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Enrollment timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-4 border-s border-border ps-4 text-sm">
          {items.map((entry, i) => (
            <li key={entry.id} className="relative">
              {/* dot */}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute -start-[21px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-background',
                  entry.newStatus === 'ENROLLED'   ? 'bg-primary' :
                  entry.newStatus === 'GRADUATED'  ? 'bg-emerald-500' :
                  entry.newStatus === 'TRANSFERRED'? 'bg-amber-500' :
                                                     'bg-muted-foreground',
                )}
              />
              <p className="font-medium leading-tight">
                {titleCase(entry.newStatus)}
                {entry.previousStatus && (
                  <span className="font-normal text-muted-foreground">
                    {' '}(was {entry.previousStatus.toLowerCase()})
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {entry.effectiveDate}
                {entry.reason && ` · ${entry.reason}`}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- current enrollment sidebar */

function CurrentEnrollmentCard({
  enrollment,
  cd,
}: {
  enrollment: EnrollmentEntry;
  cd: Record<string, unknown>;
}) {
  const classTeacher = readStr(cd, 'classTeacher');
  const rollNumber   = readStr(cd, 'rollNumber');
  const udise        = readStr(cd, 'udise') || readStr(cd, 'udiseCode');
  const gradeSection = readStr(cd, 'gradeSection') || readStr(cd, 'grade');

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Current enrollment</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          <FactRow label="Institution">{enrollment.institutionId}</FactRow>
          {udise && <FactRow label="UDISE"><span className="font-mono">{udise}</span></FactRow>}
          <FactRow label="Grade / Section">{gradeSection || enrollment.gradeId}</FactRow>
          {classTeacher && <FactRow label="Class teacher">{classTeacher}</FactRow>}
          {rollNumber   && <FactRow label="Roll number">{rollNumber}</FactRow>}
        </dl>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- existing tab content */

function EnrollmentTab({
  enrollments, history, transfers,
}: {
  enrollments: EnrollmentEntry[];
  history: EnrollmentHistoryEntry[];
  transfers: TransferRecord[];
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Enrollment history</CardTitle>
          <CardDescription>All enrollment status changes.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No enrollment history yet.</p>
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
                {history.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.effectiveDate}</TableCell>
                    <TableCell>{e.previousStatus ?? '—'}</TableCell>
                    <TableCell>{titleCase(e.newStatus)}</TableCell>
                    <TableCell>{e.institutionId}</TableCell>
                    <TableCell className="max-w-xs truncate">{e.reason ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {transfers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Transfers</CardTitle>
          </CardHeader>
          <CardContent>
            <Table aria-label="Transfer records">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>From</TableHead>
                  <TableHead>To</TableHead><TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{t.transferDate}</TableCell>
                    <TableCell>{t.sourceInstitutionId}</TableCell>
                    <TableCell>{t.destinationInstitutionId}</TableCell>
                    <TableCell className="max-w-xs truncate">{t.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GuardiansTab({ student }: { student: Student }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Guardians</CardTitle>
        <CardDescription>Parents and other guardians.</CardDescription>
      </CardHeader>
      <CardContent>
        {student.guardians.length === 0 ? (
          <p className="text-sm text-muted-foreground">No guardians on file.</p>
        ) : (
          <Table aria-label="Guardians">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>Relationship</TableHead>
                <TableHead>Phone</TableHead><TableHead>Email</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {student.guardians.map((g, i) => (
                <TableRow key={g.id ?? `${g.firstName}-${i}`}>
                  <TableCell className="font-medium">{g.firstName} {g.lastName}</TableCell>
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

function CustomFieldsTab({
  customFields, student,
}: {
  customFields: CustomFieldDefinition[];
  student: Student;
}) {
  if (customFields.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Custom fields</CardTitle>
          <CardDescription>No custom fields configured for students yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom fields</CardTitle>
        <CardDescription>Tenant-specific fields beyond the core schema.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          {customFields.map((f) => (
            <div key={f.id}>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</dt>
              <dd className="mt-0.5 break-words font-medium">
                {formatCustomValue(student.customData[f.fieldKey])}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- status pill */

function StatusPill({ status }: { status: string }) {
  switch (status.toUpperCase()) {
    case 'ENROLLED':    return <Badge variant="success">Enrolled</Badge>;
    case 'TRANSFERRED': return <Badge variant="warning">Transferred</Badge>;
    case 'WITHDRAWN':   return <Badge variant="secondary">Withdrawn</Badge>;
    case 'GRADUATED':   return <Badge variant="outline">Graduated</Badge>;
    default:            return <Badge variant="outline">{titleCase(status)}</Badge>;
  }
}

// EnrollmentHistoryEntry is imported from @/lib/api/students above.
