'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type { AdmissionEnquiry } from '@/lib/api/admissions';
import {
  addFollowupAction,
  convertEnquiryAction,
  createEnquiryAction,
  updateEnquiryStageAction,
} from '../../admissions-actions';

interface Option {
  id: string;
  name: string;
}

export function EnquiryPanel({
  enquiries,
  institutions,
  periods,
  grades,
}: {
  enquiries: AdmissionEnquiry[];
  institutions: Option[];
  periods: Option[];
  grades: Option[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(task: () => Promise<{ status: string; message?: string; id?: string }>) {
    startTransition(async () => {
      setError(null);
      const result = await task();
      if (result.status === 'error') {
        setError(result.message ?? 'Failed');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New enquiry</CardTitle>
          <CardDescription>Capture a lead with source, stage, and scores.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            data-testid="enquiry-form"
            data-hydrated={hydrated ? 'true' : 'false'}
            aria-busy={pending}
            onSubmit={(event) => {
              event.preventDefault();
              const fd = new FormData(event.currentTarget);
              run(() =>
                createEnquiryAction({
                  institutionId: String(fd.get('institutionId') ?? ''),
                  academicPeriodId: String(fd.get('academicPeriodId') ?? ''),
                  gradeId: String(fd.get('gradeId') ?? ''),
                  quota: String(fd.get('quota') ?? 'general'),
                  source: String(fd.get('source') ?? 'other'),
                  firstName: String(fd.get('firstName') ?? ''),
                  lastName: String(fd.get('lastName') ?? ''),
                  dateOfBirth: String(fd.get('dateOfBirth') ?? ''),
                  guardianName: String(fd.get('guardianName') ?? ''),
                  guardianPhone: String(fd.get('guardianPhone') ?? ''),
                  interviewScore: Number(fd.get('interviewScore') || 0),
                  testScore: Number(fd.get('testScore') || 0),
                }),
              );
            }}
          >
            <FormField id="enq-institution" label="Institution" required>
              <select
                id="enq-institution"
                name="institutionId"
                data-testid="enquiry-institution"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
            <FormField id="enq-period" label="Academic period" required>
              <select
                id="enq-period"
                name="academicPeriodId"
                data-testid="enquiry-period"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
            <FormField id="enq-grade" label="Grade" required>
              <select
                id="enq-grade"
                name="gradeId"
                data-testid="enquiry-grade"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField id="enq-first" label="First name" required>
                <Input
                  id="enq-first"
                  name="firstName"
                  data-testid="enquiry-first-name"
                  required
                  disabled={!hydrated || pending}
                />
              </FormField>
              <FormField id="enq-last" label="Last name" required>
                <Input
                  id="enq-last"
                  name="lastName"
                  data-testid="enquiry-last-name"
                  required
                  disabled={!hydrated || pending}
                />
              </FormField>
            </div>
            <FormField id="enq-dob" label="Date of birth" required>
              <Input
                id="enq-dob"
                name="dateOfBirth"
                type="date"
                data-testid="enquiry-dob"
                required
                disabled={!hydrated || pending}
              />
            </FormField>
            <FormField id="enq-guardian" label="Guardian" required>
              <Input
                id="enq-guardian"
                name="guardianName"
                data-testid="enquiry-guardian"
                required
                disabled={!hydrated || pending}
              />
            </FormField>
            <FormField id="enq-phone" label="Guardian phone" required>
              <Input
                id="enq-phone"
                name="guardianPhone"
                data-testid="enquiry-phone"
                required
                disabled={!hydrated || pending}
              />
            </FormField>
            <FormField id="enq-source" label="Source">
              <select
                id="enq-source"
                name="source"
                data-testid="enquiry-source"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={!hydrated || pending}
                defaultValue="other"
              >
                {['website', 'walk_in', 'referral', 'campaign', 'other'].map((source) => (
                  <option key={source} value={source}>
                    {source.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField id="enq-interview" label="Interview score">
                <Input
                  id="enq-interview"
                  name="interviewScore"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={0}
                  data-testid="enquiry-interview-score"
                  disabled={!hydrated || pending}
                />
              </FormField>
              <FormField id="enq-test" label="Test score">
                <Input
                  id="enq-test"
                  name="testScore"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={0}
                  data-testid="enquiry-test-score"
                  disabled={!hydrated || pending}
                />
              </FormField>
            </div>
            <input type="hidden" name="quota" value="general" />
            {error ? (
              <p className="text-sm text-destructive" role="alert" data-testid="enquiry-error">
                {error}
              </p>
            ) : null}
            <Button type="submit" data-testid="new-enquiry" disabled={!hydrated || pending}>
              {pending ? 'Saving…' : 'Create enquiry'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline</CardTitle>
          <CardDescription>
            {enquiries.length === 0 ? 'No enquiries yet.' : `${enquiries.length} lead(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {enquiries.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status" data-testid="enquiry-empty">
              Create an enquiry to start the CRM pipeline.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {enquiries.map((row) => (
                <li
                  key={row.id}
                  className="space-y-3 py-3 first:pt-0 last:pb-0"
                  data-testid="enquiry-row"
                >
                  <p className="text-sm font-medium">
                    {row.firstName} {row.lastName} · {row.stage}
                  </p>
                  <form
                    className="flex flex-wrap items-end gap-2"
                    data-hydrated={hydrated ? 'true' : 'false'}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const fd = new FormData(event.currentTarget);
                      run(() =>
                        updateEnquiryStageAction({
                          id: row.id,
                          stage: String(fd.get('stage') ?? row.stage),
                        }),
                      );
                    }}
                  >
                    <label className="text-xs" htmlFor={`stage-${row.id}`}>
                      Stage
                      <select
                        id={`stage-${row.id}`}
                        name="stage"
                        data-testid="enquiry-stage"
                        defaultValue={row.stage}
                        className="mt-1 flex h-10 rounded-md border border-input bg-background px-2 text-sm"
                        disabled={!hydrated || pending}
                      >
                        {['new', 'contacted', 'qualified', 'applied', 'lost', 'waitlisted'].map(
                          (stage) => (
                            <option key={stage} value={stage}>
                              {stage}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      data-testid="enquiry-stage-save"
                      disabled={!hydrated || pending}
                    >
                      Save stage
                    </Button>
                  </form>
                  <form
                    className="flex flex-wrap items-end gap-2"
                    data-hydrated={hydrated ? 'true' : 'false'}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const fd = new FormData(event.currentTarget);
                      run(() =>
                        addFollowupAction({
                          enquiryId: row.id,
                          dueAt: new Date(String(fd.get('dueAt') ?? '')).toISOString(),
                          ownerId: String(fd.get('ownerId') ?? '') || undefined,
                          notes: String(fd.get('notes') ?? ''),
                        }),
                      );
                    }}
                  >
                    <FormField id={`due-${row.id}`} label="Follow-up due">
                      <Input
                        id={`due-${row.id}`}
                        name="dueAt"
                        type="datetime-local"
                        data-testid="followup-due"
                        disabled={!hydrated || pending}
                        required
                      />
                    </FormField>
                    <FormField id={`owner-${row.id}`} label="Owner">
                      <Input
                        id={`owner-${row.id}`}
                        name="ownerId"
                        data-testid="followup-owner"
                        disabled={!hydrated || pending}
                      />
                    </FormField>
                    <FormField id={`notes-${row.id}`} label="Notes">
                      <Input
                        id={`notes-${row.id}`}
                        name="notes"
                        data-testid="followup-notes"
                        disabled={!hydrated || pending}
                      />
                    </FormField>
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      data-testid="add-followup"
                      disabled={!hydrated || pending}
                    >
                      Add follow-up
                    </Button>
                  </form>
                  <Button
                    type="button"
                    size="sm"
                    data-testid="convert-enquiry"
                    disabled={!hydrated || pending || Boolean(row.applicationId)}
                    onClick={() =>
                      run(async () => {
                        const result = await convertEnquiryAction(row.id);
                        if (result.status === 'success' && result.id) {
                          router.push(`/admissions/${result.id}`);
                        }
                        return result;
                      })
                    }
                  >
                    {row.applicationId ? 'Converted' : 'Convert to application'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
