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
import { resolveQuotaFromForm } from '@/lib/admissions/quota-categories';
import { generateMeritListAction, setPlacementScoresAction } from '../../admissions-actions';
import { QuotaCategoryField } from './quota-category-field';

interface Option {
  id: string;
  name: string;
}

const selectClassName =
  'flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm';

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
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [scoreMessage, setScoreMessage] = useState<string | null>(null);
  const lookupsMissing = institutions.length === 0 || periods.length === 0 || grades.length === 0;

  return (
    <div className="space-y-6">
      <p
        className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        role="note"
        data-testid="merit-honesty"
      >
        Merit ranking uses interview and entrance/test scores stored on application{' '}
        <strong className="font-medium text-foreground">placement</strong> (
        <code className="text-xs">PATCH /admissions/applications/:id/placement</code>). There is no
        separate entrance-exam catalog or board-pack ingest API in this release.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingest entrance scores</CardTitle>
          <CardDescription>
            Set or update period, grade, category, interview, and entrance/test scores for an
            application before generating a ranking.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lookupsMissing ? (
            <p
              className="text-sm text-muted-foreground"
              role="status"
              data-testid="merit-lookups-empty"
            >
              Institutions, periods, and grades are required before scores can be saved.
            </p>
          ) : (
            <form
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="merit-score-form"
              data-hydrated={hydrated ? 'true' : 'false'}
              aria-busy={pending}
              onSubmit={(event) => {
                event.preventDefault();
                const fd = new FormData(event.currentTarget);
                const quota = resolveQuotaFromForm(
                  String(fd.get('quotaPreset') ?? 'general'),
                  String(fd.get('quotaCustom') ?? ''),
                );
                startTransition(async () => {
                  setScoreError(null);
                  setScoreMessage(null);
                  const result = await setPlacementScoresAction({
                    applicationId: String(fd.get('applicationId') ?? '').trim(),
                    academicPeriodId: String(fd.get('academicPeriodId') ?? ''),
                    gradeId: String(fd.get('gradeId') ?? ''),
                    quota,
                    interviewScore: Number(fd.get('interviewScore') ?? 0),
                    testScore: Number(fd.get('testScore') ?? 0),
                  });
                  if (result.status === 'error') {
                    setScoreError(result.message ?? 'Failed');
                    return;
                  }
                  setScoreMessage(result.message ?? 'Saved.');
                  router.refresh();
                });
              }}
            >
              <FormField id="merit-app-id" label="Application ID" required>
                <Input
                  id="merit-app-id"
                  name="applicationId"
                  data-testid="merit-application-id"
                  placeholder="UUID from /admissions/[id]"
                  required
                  disabled={!hydrated || pending}
                />
              </FormField>
              <FormField id="merit-score-period" label="Period" required>
                <select
                  id="merit-score-period"
                  name="academicPeriodId"
                  data-testid="merit-score-period"
                  className={selectClassName}
                  disabled={!hydrated || pending}
                  defaultValue={periods[0]?.id ?? ''}
                >
                  {periods.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="merit-score-grade" label="Grade" required>
                <select
                  id="merit-score-grade"
                  name="gradeId"
                  data-testid="merit-score-grade"
                  className={selectClassName}
                  disabled={!hydrated || pending}
                  defaultValue={grades[0]?.id ?? ''}
                >
                  {grades.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <QuotaCategoryField
                id="merit-score-quota"
                testIdPrefix="merit-score-quota"
                disabled={!hydrated || pending}
              />
              <FormField id="merit-score-interview" label="Interview score" required>
                <Input
                  id="merit-score-interview"
                  name="interviewScore"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  defaultValue={0}
                  data-testid="merit-score-interview"
                  disabled={!hydrated || pending}
                />
              </FormField>
              <FormField id="merit-score-test" label="Entrance / test score" required>
                <Input
                  id="merit-score-test"
                  name="testScore"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  defaultValue={0}
                  data-testid="merit-score-test"
                  disabled={!hydrated || pending}
                />
              </FormField>
              {scoreError ? (
                <p
                  className="text-sm text-destructive sm:col-span-2"
                  role="alert"
                  data-testid="merit-score-error"
                >
                  {scoreError}
                </p>
              ) : null}
              {scoreMessage ? (
                <p
                  className="text-sm text-muted-foreground sm:col-span-2"
                  role="status"
                  data-testid="merit-score-success"
                >
                  {scoreMessage}
                </p>
              ) : null}
              <div className="sm:col-span-2 lg:col-span-3">
                <Button
                  type="submit"
                  data-testid="save-merit-scores"
                  disabled={!hydrated || pending}
                >
                  {pending ? 'Saving…' : 'Save scores'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate merit list</CardTitle>
          <CardDescription>
            Weights over interview and entrance/test scores must sum to 1.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lookupsMissing ? (
            <p className="text-sm text-muted-foreground" role="status">
              Lookups missing — cannot generate a ranking yet.
            </p>
          ) : (
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
                <select
                  id="merit-institution"
                  name="institutionId"
                  data-testid="merit-institution"
                  className={selectClassName}
                  disabled={!hydrated || pending}
                  defaultValue={institutions[0]?.id ?? ''}
                >
                  {institutions.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="merit-period" label="Period" required>
                <select
                  id="merit-period"
                  name="academicPeriodId"
                  data-testid="merit-period"
                  className={selectClassName}
                  disabled={!hydrated || pending}
                  defaultValue={periods[0]?.id ?? ''}
                >
                  {periods.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="merit-grade" label="Grade" required>
                <select
                  id="merit-grade"
                  name="gradeId"
                  data-testid="merit-grade"
                  className={selectClassName}
                  disabled={!hydrated || pending}
                  defaultValue={grades[0]?.id ?? ''}
                >
                  {grades.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="merit-interview" label="Interview weight">
                <Input
                  id="merit-interview"
                  name="interviewWeight"
                  type="number"
                  step="0.05"
                  min={0}
                  max={1}
                  defaultValue="0.4"
                  data-testid="merit-interview-weight"
                  disabled={!hydrated || pending}
                />
              </FormField>
              <FormField id="merit-test" label="Test weight">
                <Input
                  id="merit-test"
                  name="testWeight"
                  type="number"
                  step="0.05"
                  min={0}
                  max={1}
                  defaultValue="0.6"
                  data-testid="merit-test-weight"
                  disabled={!hydrated || pending}
                />
              </FormField>
              {error ? (
                <p
                  className="text-sm text-destructive sm:col-span-2"
                  role="alert"
                  data-testid="merit-error"
                >
                  {error}
                </p>
              ) : null}
              <div className="sm:col-span-2 lg:col-span-5">
                <Button type="submit" data-testid="generate-merit" disabled={!hydrated || pending}>
                  {pending ? 'Generating…' : 'Generate ranking'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ranked applicants</CardTitle>
          <CardDescription>
            {list
              ? `${list.entries.length} applicant(s).`
              : 'Generate a list to rank placed applications with scores.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!list || list.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status" data-testid="merit-empty">
              No ranked entries yet. Ingest scores for placed applications, then generate a ranking
              for that institution × period × grade.
            </p>
          ) : (
            <Table data-testid="merit-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Interview</TableHead>
                  <TableHead>Entrance / test</TableHead>
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
