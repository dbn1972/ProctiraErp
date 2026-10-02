'use client';

import { useState, useTransition } from 'react';

import { issueTranscriptAction } from '@/app/(dashboard)/gradebook-actions';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@proctira/ui/components';

interface NamedStudent {
  id: string;
  label: string;
}

/**
 * Issue a transcript by student name. The stored id stays in component state
 * and is not the visible label.
 */
export function IssueTranscriptByName({
  students,
  defaultStudentId = '',
}: {
  students: NamedStudent[];
  defaultStudentId?: string;
}) {
  const initial = students.some((student) => student.id === defaultStudentId)
    ? defaultStudentId
    : (students[0]?.id ?? '');
  const [studentId, setStudentId] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const selectedLabel = students.find((student) => student.id === studentId)?.label ?? '';

  function issue() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await issueTranscriptAction({ studentId });
      setConfirming(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const version = String(result.extra?.version ?? '');
      setMessage(version ? `Issued transcript version ${version}.` : 'Issued transcript.');
    });
  }

  if (students.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No students are available to issue a transcript for.
      </p>
    );
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        // PRC-L056: issuing an official transcript requires an explicit confirm.
        setConfirming(true);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="transcriptStudent">Student</Label>
        <Select value={studentId} onValueChange={setStudentId}>
          <SelectTrigger id="transcriptStudent" className="min-w-[18rem]">
            <SelectValue placeholder="Select a student" />
          </SelectTrigger>
          <SelectContent>
            {students.map((student) => (
              <SelectItem key={student.id} value={student.id}>
                {student.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={pending || !studentId}>
        {pending ? 'Issuing…' : 'Issue official transcript'}
      </Button>
      <ConfirmActionDialog
        open={confirming}
        onOpenChange={(open) => !pending && setConfirming(open)}
        title={`Issue official transcript for ${selectedLabel}?`}
        description="A new transcript version will be issued and recorded for this student."
        confirmLabel="Issue transcript"
        pending={pending}
        onConfirm={issue}
        testId="issue-transcript-confirm"
      />
      {message ? (
        <p className="basis-full text-sm text-foreground" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="basis-full text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
