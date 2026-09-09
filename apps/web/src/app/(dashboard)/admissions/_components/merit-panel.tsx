'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type { MeritList } from '@/lib/api/admissions';
import { generateMeritListAction } from '../../admissions-actions';

interface Option {
  id: string;
  name: string;
}

export function MeritPanel({
  list,
  institutions,
  periods,
  grades,
}: {
  list: MeritList | null;
  institutions: Option[];
  periods: Option[];
  grades: Option[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate merit list</CardTitle>
          <CardDescription>Weights over interview and test scores must sum to 1.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
            data-testid="merit-form"
            data-hydrated={hydrated ? 'true' : 'false'}
            onSubmit={(event) => {
              event.preventDefault();
              const fd = new FormData(event.currentTarget);
              startTransition(async () => {
                setError(null);
                const result = await generateMeritListAction({
                  institutionId: String(fd.get('institutionId') ?? ''),
                  academicPeriodId: String(fd.get('academicPeriodId') ?? ''),
                  gradeId: String(fd.get('gradeId') ?? ''),
                  interviewWeight: Number(fd.get('interviewWeight') ?? 0.4),
                  testWeight: Number(fd.get('testWeight') ?? 0.6),
                });
                if (result.status === 'error') {
                  setError(result.message ?? 'Failed');
                  return;
                }
                router.refresh();
              });
            }}
          >
            <FormField id="merit-institution" label="Institution" required>
              <select id="merit-institution" name="institutionId" data-testid="merit-institution" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={!hydrated || pending} defaultValue={institutions[0]?.id ?? ''}>
                {institutions.map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </FormField>
            <FormField id="merit-period" label="Period" required>
              <select id="merit-period" name="academicPeriodId" data-testid="merit-period" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={!hydrated || pending} defaultValue={periods[0]?.id ?? ''}>
                {periods.map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </FormField>
            <FormField id="merit-grade" label="Grade" required>
              <select id="merit-grade" name="gradeId" data-testid="merit-grade" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={!hydrated || pending} defaultValue={grades[0]?.id ?? ''}>
                {grades.map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </FormField>
            <FormField id="merit-interview" label="Interview weight">
              <Input id="merit-interview" name="interviewWeight" type="number" step="0.05" min={0} max={1} defaultValue="0.4" data-testid="merit-interview-weight" disabled={!hydrated || pending} />
            </FormField>
            <FormField id="merit-test" label="Test weight">
              <Input id="merit-test" name="testWeight" type="number" step="0.05" min={0} max={1} defaultValue="0.6" data-testid="merit-test-weight" disabled={!hydrated || pending} />
            </FormField>
            {error ? <p className="text-sm text-destructive sm:col-span-2" role="alert">{error}</p> : null}
            <div className="sm:col-span-2 lg:col-span-5">
              <Button type="submit" data-testid="generate-merit" disabled={!hydrated || pending}>
                {pending ? 'Generating…' : 'Generate ranking'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ranked applicants</CardTitle>
          <CardDescription>
            {list ? `${list.entries.length} applicant(s).` : 'Generate a list to rank placed applications.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!list || list.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status" data-testid="merit-empty">
              No ranked entries yet.
            </p>
          ) : (
            <Table data-testid="merit-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Interview</TableHead>
                  <TableHead>Test</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.entries.map((entry) => (
                  <TableRow key={entry.id} data-testid="merit-row">
                    <TableCell>{entry.rank}</TableCell>
                    <TableCell>
                      <Link className="underline" href={`/admissions/${entry.applicationId}`}>
                        {entry.firstName} {entry.lastName}
                      </Link>
                    </TableCell>
                    <TableCell>{entry.score.toFixed(2)}</TableCell>
                    <TableCell>{entry.interviewScore}</TableCell>
                    <TableCell>{entry.testScore}</TableCell>
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
