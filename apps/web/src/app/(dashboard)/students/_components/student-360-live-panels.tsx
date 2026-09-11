/**
 * Wave 11 — live Health / Fees / LMS panels for the student profile.
 *
 * Server Components on purpose: `@/lib/api/{health,fees,lms}` go through
 * `gateway.ts` (`next/headers`). Client value-imports would fail the
 * no-server-only-imports-in-client guard and break the Next build.
 */
import {
  Alert,
  AlertDescription,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { getHealthRecord, listStudentAllergies, listStudentVaccinations } from '@/lib/api/health';
import { listInvoices } from '@/lib/api/fees';
import { getStudentPlan, getStudentProgress } from '@/lib/api/lms';

function PanelError({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function money(cents: number, currency = 'USD') {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

export async function StudentHealthTab({ studentId }: { studentId: string }) {
  let record = null as Awaited<ReturnType<typeof getHealthRecord>>;
  let allergies: Awaited<ReturnType<typeof listStudentAllergies>> = [];
  let vaccines: Awaited<ReturnType<typeof listStudentVaccinations>> = [];
  let error: string | null = null;

  try {
    [record, allergies, vaccines] = await Promise.all([
      getHealthRecord(studentId).catch(() => null),
      listStudentAllergies(studentId),
      listStudentVaccinations(studentId),
    ]);
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : 'Failed to load health data';
  }

  if (error) return <PanelError message={error} />;
  if (!record && allergies.length === 0 && vaccines.length === 0) {
    return <EmptyNote>No records for this student yet.</EmptyNote>;
  }

  return (
    <div className="space-y-6">
      {record ? (
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Blood type</p>
            <p className="font-medium">{record.bloodType || '—'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Last updated</p>
            <p className="font-medium">{new Date(record.lastUpdated).toLocaleString()}</p>
          </div>
          {record.emergencyContactName ? (
            <div>
              <p className="text-muted-foreground">Emergency contact</p>
              <p className="font-medium">{record.emergencyContactName}</p>
              {record.emergencyContactPhone ? (
                <p className="text-muted-foreground">{record.emergencyContactPhone}</p>
              ) : null}
            </div>
          ) : null}
          {record.chronicConditions?.length ? (
            <div>
              <p className="text-muted-foreground">Chronic conditions</p>
              <p className="font-medium">{record.chronicConditions.join(', ')}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Allergies</h3>
        {allergies.length ? (
          <ul className="space-y-2 text-sm">
            {allergies.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2"
              >
                <span className="font-medium">{a.allergyType}</span>
                {a.severity ? <Badge variant="secondary">{a.severity}</Badge> : null}
                {a.description ? (
                  <span className="w-full text-muted-foreground">{a.description}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No allergies on file.</p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Vaccinations</h3>
        {vaccines.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vaccine</TableHead>
                <TableHead>Dose</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vaccines.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>{v.vaccineName}</TableCell>
                  <TableCell>{v.doseNumber}</TableCell>
                  <TableCell>{new Date(v.dateAdministered).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No vaccinations on file.</p>
        )}
      </div>
    </div>
  );
}

export async function StudentFeesTab({ studentId }: { studentId: string }) {
  let invoices: Awaited<ReturnType<typeof listInvoices>> = [];
  let error: string | null = null;

  try {
    invoices = await listInvoices('staff', { studentId });
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : 'Failed to load fees';
  }

  if (error) return <PanelError message={error} />;
  if (invoices.length === 0) {
    return <EmptyNote>No records for this student yet.</EmptyNote>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Due</TableHead>
          <TableHead className="text-end">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((inv) => (
          <TableRow key={inv.id}>
            <TableCell>
              <div className="font-medium">{inv.title}</div>
              <div className="text-xs text-muted-foreground">{inv.invoiceNumber}</div>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{inv.status}</Badge>
            </TableCell>
            <TableCell>{inv.dueAt ? new Date(inv.dueAt).toLocaleDateString() : '—'}</TableCell>
            <TableCell className="text-end">{money(inv.amountCents, inv.currency)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export async function StudentLmsTab({ studentId }: { studentId: string }) {
  let plan: Awaited<ReturnType<typeof getStudentPlan>> = null;
  let progress: Awaited<ReturnType<typeof getStudentProgress>> = null;
  let error: string | null = null;

  try {
    [plan, progress] = await Promise.all([
      getStudentPlan(studentId),
      getStudentProgress(studentId),
    ]);
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : 'Failed to load LMS data';
  }

  if (error) return <PanelError message={error} />;
  if (!plan?.items?.length && !progress?.skills?.length) {
    return <EmptyNote>No records for this student yet.</EmptyNote>;
  }

  return (
    <div className="space-y-6">
      {progress ? (
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Mastered</p>
            <p className="text-xl font-semibold">{progress.summary.mastered}</p>
          </div>
          <div>
            <p className="text-muted-foreground">In progress</p>
            <p className="text-xl font-semibold">{progress.summary.inProgress}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Avg mastery</p>
            <p className="text-xl font-semibold">
              {Math.round(progress.summary.averageMastery * 100)}%
            </p>
          </div>
        </div>
      ) : null}

      {plan?.items?.length ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Learning plan</h3>
          <ul className="space-y-2 text-sm">
            {plan.items.slice(0, 12).map((item) => (
              <li
                key={`${item.skillId}-${item.type}`}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2"
              >
                <span className="font-medium">{item.skillName}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{item.type}</Badge>
                  <span className="text-muted-foreground">{Math.round(item.mastery * 100)}%</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {progress?.skills?.length ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Skill progress</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead className="text-end">Mastery</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {progress.skills.slice(0, 20).map((row) => (
                <TableRow key={row.skill.id}>
                  <TableCell>{row.skill.name}</TableCell>
                  <TableCell className="text-muted-foreground">{row.skill.subject}</TableCell>
                  <TableCell className="text-end">
                    {row.mastery ? `${Math.round(row.mastery.mastery * 100)}%` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
