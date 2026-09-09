'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';

import { createSectionAction } from '@/app/(dashboard)/timetable-actions';

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
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
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
        <span className="font-medium">Name</span>
        <input
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Grade 6A Mathematics"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Code</span>
        <input
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="G6A-MATH"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Capacity</span>
        <input
          type="number"
          min={1}
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
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
      <div className="flex items-end">
        <Button type="submit" size="sm" disabled={pending} className="w-full">
          {pending ? 'Saving…' : 'Create section'}
        </Button>
      </div>
      {error && (
        <p
          className="sm:col-span-2 lg:col-span-5 text-sm text-red-600 dark:text-red-400"
          role="alert"
        >
          {error}
        </p>
      )}
    </form>
  );
}
