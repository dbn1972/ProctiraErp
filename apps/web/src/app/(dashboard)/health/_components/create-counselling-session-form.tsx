'use client';

/**
 * Minimal create form for counselling sessions.
 * Posts to existing domain API: POST /health/counselling/sessions.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Check } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Textarea,
} from '@proctira/ui/components';

import { createCounsellingSessionAction } from '../actions';

const SESSION_TYPES = ['individual', 'group', 'family', 'crisis'] as const;
const SESSION_STATUSES = ['scheduled', 'completed', 'cancelled', 'no-show'] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function CreateCounsellingSessionForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);

    const studentId = String(fd.get('studentId') ?? '').trim();
    const counsellorId = String(fd.get('counsellorId') ?? '').trim();
    const sessionDate = String(fd.get('sessionDate') ?? '').trim();
    const sessionType = String(fd.get('sessionType') ?? 'individual').trim();
    const reason = String(fd.get('reason') ?? '').trim();
    const caseNotes = String(fd.get('caseNotes') ?? '').trim();
    const outcome = String(fd.get('outcome') ?? '').trim();
    const status = String(fd.get('status') ?? 'scheduled').trim();
    const followUpRequired = fd.get('followUpRequired') === 'on';
    const followUpDate = String(fd.get('followUpDate') ?? '').trim();

    if (!UUID_RE.test(studentId)) {
      setError('Student ID must be a valid UUID (version 4).');
      return;
    }
    if (!UUID_RE.test(counsellorId)) {
      setError('Counsellor ID must be a valid UUID (version 4).');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
      setError('Session date is required (YYYY-MM-DD).');
      return;
    }
    if (!reason) {
      setError('Reason is required.');
      return;
    }
    if (!caseNotes) {
      setError('Case notes are required.');
      return;
    }
    if (followUpRequired && !followUpDate) {
      setError('Follow-up date is required when follow-up is marked.');
      return;
    }
    if (!SESSION_TYPES.includes(sessionType as (typeof SESSION_TYPES)[number])) {
      setError('Invalid session type.');
      return;
    }
    if (!SESSION_STATUSES.includes(status as (typeof SESSION_STATUSES)[number])) {
      setError('Invalid status.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createCounsellingSessionAction({
        studentId,
        counsellorId,
        sessionDate,
        sessionType: sessionType as (typeof SESSION_TYPES)[number],
        reason,
        caseNotes,
        outcome: outcome || undefined,
        followUpRequired,
        followUpDate: followUpDate || undefined,
        status: status as (typeof SESSION_STATUSES)[number],
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create counselling session');
        return;
      }
      router.push('/health/counselling');
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[860px]">
      <CardHeader>
        <CardTitle className="text-base">Session details</CardTitle>
        <CardDescription>
          Schedule a confidential counselling session. Notes stay sealed to authorized
          health roles.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create counselling session"
          data-testid="counselling-session-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="counselling-student-id" label="Student ID" required>
              <Input
                id="counselling-student-id"
                name="studentId"
                placeholder="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
                required
                autoComplete="off"
              />
            </FormField>
            <FormField id="counselling-counsellor-id" label="Counsellor ID" required>
              <Input
                id="counselling-counsellor-id"
                name="counsellorId"
                placeholder="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
                required
                autoComplete="off"
              />
            </FormField>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <FormField id="counselling-session-date" label="Session date" required>
              <Input
                id="counselling-session-date"
                name="sessionDate"
                type="date"
                required
              />
            </FormField>
            <FormField id="counselling-session-type" label="Session type" required>
              <select
                id="counselling-session-type"
                name="sessionType"
                required
                defaultValue="individual"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {SESSION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="counselling-status" label="Status" required>
              <select
                id="counselling-status"
                name="status"
                required
                defaultValue="scheduled"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {SESSION_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField id="counselling-reason" label="Reason" required>
            <Input
              id="counselling-reason"
              name="reason"
              aria-label="Reason"
              placeholder="Exam anxiety / peer conflict / …"
            />
          </FormField>

          <FormField id="counselling-case-notes" label="Case notes" required>
            <Textarea
              id="counselling-case-notes"
              name="caseNotes"
              rows={4}
              placeholder="Document discussion points (sealed)."
              required
            />
          </FormField>

          <FormField id="counselling-outcome" label="Outcome">
            <Input
              id="counselling-outcome"
              name="outcome"
              placeholder="Optional outcome summary"
            />
          </FormField>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center gap-2 pt-6">
              <input
                id="counselling-follow-up"
                name="followUpRequired"
                type="checkbox"
                className="h-4 w-4 rounded border-input"
              />
              <label htmlFor="counselling-follow-up" className="text-sm font-medium">
                Follow-up required
              </label>
            </div>
            <FormField id="counselling-follow-up-date" label="Follow-up date">
              <Input id="counselling-follow-up-date" name="followUpDate" type="date" />
            </FormField>
          </div>

          {error ? (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="counselling-session-error"
            >
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-3 pt-2">
            <Button asChild variant="outline" type="button">
              <Link href="/health/counselling">Cancel</Link>
            </Button>
            <Button type="submit" disabled={pending}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Scheduling…' : 'Schedule session'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
