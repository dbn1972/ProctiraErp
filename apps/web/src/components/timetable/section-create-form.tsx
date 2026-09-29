'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button, Card, CardContent } from '@proctira/ui/components';

import { createSectionAction } from '@/app/(dashboard)/timetable-actions';

export function SectionCreatePanel(props: {
  institutionId: string;
  academicPeriodId: string;
  roomOptions: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Create section</h3>
            <p className="text-sm text-muted-foreground">
              The sections list stays in view until you need a new one.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant={open ? 'outline' : 'default'}
            onClick={() => setOpen((value) => !value)}
            data-testid="toggle-create-section"
            aria-expanded={open}
          >
            {open ? 'Hide form' : 'Create section'}
          </Button>
        </div>
        {open ? <SectionCreateForm {...props} /> : null}
      </CardContent>
    </Card>
  );
}

export function SectionCreateForm(props: {
  institutionId: string;
  academicPeriodId: string;
  roomOptions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [capacity, setCapacity] = useState('40');
  const [defaultRoomId, setDefaultRoomId] = useState('');

  if (!props.academicPeriodId) {
    return (
      <p className="text-sm text-muted-foreground">
        Create an academic period before adding master-schedule sections.
      </p>
    );
  }

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await createSectionAction({
            institutionId: props.institutionId,
            academicPeriodId: props.academicPeriodId,
            name,
            code: code || undefined,
            capacity: Number(capacity) || 40,
            defaultRoomId: defaultRoomId || undefined,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setName('');
          setCode('');
          router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          Name <span className="text-red-600">*</span>
        </span>
        <input
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Grade 6A Mathematics"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          Code <span className="text-red-600">*</span>
        </span>
        <input
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="G6A-MATH"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          Capacity <span className="text-red-600">*</span>
        </span>
        <input
          type="number"
          min={1}
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Default room</span>
        <select
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          value={defaultRoomId}
          onChange={(e) => setDefaultRoomId(e.target.value)}
        >
          <option value="">None</option>
          {props.roomOptions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Create section'}
        </Button>
      </div>
      {error && (
        <p className="sm:col-span-2 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
