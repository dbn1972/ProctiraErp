'use client';

import { useState, useTransition } from 'react';

import { issueTranscriptAction } from '@/app/(dashboard)/gradebook-actions';
import { Button, Input, Label } from '@proctira/ui/components';

export function IssueTranscriptForm({ defaultStudentId = '' }: { defaultStudentId?: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const studentId = String(fd.get('studentId') ?? '').trim();
        setMessage(null);
        setError(null);
        startTransition(async () => {
          const result = await issueTranscriptAction({ studentId });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setMessage(
            `Issued transcript ${result.id} v${String(result.extra?.version ?? '')} checksum=${String(result.extra?.checksumSha256 ?? '').slice(0, 12)}…`,
          );
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="transcriptStudentId">Student ID</Label>
        <Input
          id="transcriptStudentId"
          name="studentId"
          required
          defaultValue={defaultStudentId}
          className="min-w-[18rem]"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Issuing…' : 'Issue official transcript'}
      </Button>
      {message ? <p className="basis-full text-sm text-foreground">{message}</p> : null}
      {error ? (
        <p className="basis-full text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
