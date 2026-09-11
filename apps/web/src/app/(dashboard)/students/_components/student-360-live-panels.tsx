'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Badge,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  getHealthRecord,
  listStudentAllergies,
  listStudentVaccinations,
  type AllergyRecord,
  type HealthRecord,
  type VaccinationRecord,
} from '@/lib/api/health';
import { listInvoices, type FeeInvoice } from '@/lib/api/fees';
import {
  getStudentPlan,
  getStudentProgress,
  type SpiralPlan,
  type StudentProgress,
} from '@/lib/api/lms';

type LoadState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

function useLiveLoad<T>(loader: () => Promise<T>, deps: unknown[]): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    loader()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load',
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls deps
  }, deps);

  return state;
}

function PanelShell({
  loading,
  error,
  empty,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-1" aria-busy="true">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (empty) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No records for this student yet.
      </p>
    );
  }
  return <>{children}</>;
}

function money(cents: number, currency = 'USD') {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

export function StudentHealthTab({ studentId }: { studentId: string }) {
  const record = useLiveLoad<HealthRecord | null>(
    () => getHealthRecord(studentId).catch(() => null),
    [studentId],
  );
  const allergies = useLiveLoad<AllergyRecord[]>(
    () => listStudentAllergies(studentId),
    [studentId],
  );
  const vaccines = useLiveLoad<VaccinationRecord[]>(
    () => listStudentVaccinations(studentId),
    [studentId],
  );

  const loading = record.loading || allergies.loading || vaccines.loading;
  const error = record.error || allergies.error || vaccines.error;
  const empty = !record.data && !allergies.data?.length && !vaccines.data?.length;

  return (
    <PanelShell loading={loading} error={error} empty={empty}>
      <div className="space-y-6">
        {record.data && (
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Blood type</p>
              <p className="font-medium">{record.data.bloodType || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Last updated</p>
              <p className="font-medium">{new Date(record.data.lastUpdated).toLocaleString()}</p>
            </div>
            {record.data.emergencyContactName ? (
              <div>
                <p className="text-muted-foreground">Emergency contact</p>
                <p className="font-medium">{record.data.emergencyContactName}</p>
                {record.data.emergencyContactPhone ? (
                  <p className="text-muted-foreground">{record.data.emergencyContactPhone}</p>
                ) : null}
              </div>
            ) : null}
            {record.data.chronicConditions?.length ? (
              <div>
                <p className="text-muted-foreground">Chronic conditions</p>
                <p className="font-medium">{record.data.chronicConditions.join(', ')}</p>
              </div>
            ) : null}
          </div>
        )}

        <div>
          <h3 className="mb-2 text-sm font-semibold">Allergies</h3>
          {allergies.data?.length ? (
            <ul className="space-y-2 text-sm">
              {allergies.data.map((a) => (
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
          {vaccines.data?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vaccine</TableHead>
                  <TableHead>Dose</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vaccines.data.map((v) => (
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
    </PanelShell>
  );
}

export function StudentFeesTab({ studentId }: { studentId: string }) {
  const { data, loading, error } = useLiveLoad<FeeInvoice[]>(
    () => listInvoices('staff', { studentId }),
    [studentId],
  );

  return (
    <PanelShell loading={loading} error={error} empty={!data?.length}>
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
          {(data ?? []).map((inv) => (
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
    </PanelShell>
  );
}

export function StudentLmsTab({ studentId }: { studentId: string }) {
  const plan = useLiveLoad<SpiralPlan | null>(() => getStudentPlan(studentId), [studentId]);
  const progress = useLiveLoad<StudentProgress | null>(
    () => getStudentProgress(studentId),
    [studentId],
  );

  const loading = plan.loading || progress.loading;
  const error = plan.error || progress.error;
  const empty = !plan.data?.items?.length && !progress.data?.skills?.length;

  return (
    <PanelShell loading={loading} error={error} empty={empty}>
      <div className="space-y-6">
        {progress.data && (
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground">Mastered</p>
              <p className="text-xl font-semibold">{progress.data.summary.mastered}</p>
            </div>
            <div>
              <p className="text-muted-foreground">In progress</p>
              <p className="text-xl font-semibold">{progress.data.summary.inProgress}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Avg mastery</p>
              <p className="text-xl font-semibold">
                {Math.round(progress.data.summary.averageMastery * 100)}%
              </p>
            </div>
          </div>
        )}

        {plan.data?.items?.length ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Learning plan</h3>
            <ul className="space-y-2 text-sm">
              {plan.data.items.slice(0, 12).map((item) => (
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

        {progress.data?.skills?.length ? (
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
                {progress.data.skills.slice(0, 20).map((row) => (
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
    </PanelShell>
  );
}
