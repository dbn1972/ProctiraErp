'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
} from '@proctira/ui/components';

import {
  createHostelBedAction,
  createHostelBlockAction,
  createHostelRoomAction,
} from '../../campus-actions';
import type { Hostel, HostelBlock, HostelRoom } from '@/lib/api/hostel';

export function NewBlockForm({ hostels }: { hostels: Hostel[] }) {
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
    const hostelId = String(fd.get('hostelId') ?? '').trim();
    const name = String(fd.get('name') ?? '').trim();
    const floorRaw = String(fd.get('floor') ?? '').trim();
    if (!hostelId || !name) {
      setError('Hostel and block name are required.');
      return;
    }
    const floor = floorRaw ? Number(floorRaw) : undefined;
    if (floorRaw && !Number.isFinite(floor)) {
      setError('Floor must be a number.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createHostelBlockAction({ hostelId, name, floor });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create block');
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Add block</CardTitle>
        <CardDescription>Creates a block via POST `/hostel/blocks`.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create hostel block"
          data-testid="hostel-block-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="block-hostel" label="Hostel" required>
            <select
              id="block-hostel"
              name="hostelId"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue=""
            >
              <option value="" disabled>
                Select hostel…
              </option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.code})
                </option>
              ))}
            </select>
          </FormField>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="block-name" label="Block name" required>
              <Input id="block-name" name="name" className="h-11 min-h-11" />
            </FormField>
            <FormField id="block-floor" label="Floor">
              <Input id="block-floor" name="floor" type="number" className="h-11 min-h-11" />
            </FormField>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || hostels.length === 0}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Creating…' : 'Create block'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function NewRoomForm({ blocks }: { blocks: HostelBlock[] }) {
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
    const blockId = String(fd.get('blockId') ?? '').trim();
    const roomNumber = String(fd.get('roomNumber') ?? '').trim();
    const capacityRaw = String(fd.get('capacity') ?? '').trim();
    if (!blockId || !roomNumber) {
      setError('Block and room number are required.');
      return;
    }
    const capacity = capacityRaw ? Number(capacityRaw) : undefined;
    if (capacityRaw && (!Number.isFinite(capacity) || (capacity as number) < 1)) {
      setError('Capacity must be at least 1.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createHostelRoomAction({ blockId, roomNumber, capacity });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create room');
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Add room</CardTitle>
        <CardDescription>Creates a room via POST `/hostel/rooms`.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create hostel room"
          data-testid="hostel-room-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="room-block" label="Block" required>
            <select
              id="room-block"
              name="blockId"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue=""
            >
              <option value="" disabled>
                Select block…
              </option>
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} (floor {b.floor})
                </option>
              ))}
            </select>
          </FormField>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="room-number" label="Room number" required>
              <Input id="room-number" name="roomNumber" className="h-11 min-h-11" />
            </FormField>
            <FormField id="room-capacity" label="Capacity">
              <Input
                id="room-capacity"
                name="capacity"
                type="number"
                min="1"
                className="h-11 min-h-11"
              />
            </FormField>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || blocks.length === 0}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Creating…' : 'Create room'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function NewBedForm({ rooms }: { rooms: HostelRoom[] }) {
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
    const roomId = String(fd.get('roomId') ?? '').trim();
    const bedLabel = String(fd.get('bedLabel') ?? '').trim();
    const isAvailable = fd.get('isAvailable') === 'on';
    if (!roomId || !bedLabel) {
      setError('Room and bed label are required.');
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await createHostelBedAction({ roomId, bedLabel, isAvailable });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create bed');
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card className="max-w-[720px]">
      <CardHeader>
        <CardTitle className="text-base">Add bed</CardTitle>
        <CardDescription>Creates a bed via POST `/hostel/beds`.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={onSubmit}
          aria-label="Create hostel bed"
          data-testid="hostel-bed-form"
          data-hydrated={hydrated ? 'true' : 'false'}
        >
          <FormField id="bed-room" label="Room" required>
            <select
              id="bed-room"
              name="roomId"
              className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue=""
            >
              <option value="" disabled>
                Select room…
              </option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  Room {r.roomNumber} (capacity {r.capacity})
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="bed-label" label="Bed label" required>
            <Input id="bed-label" name="bedLabel" className="h-11 min-h-11" />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isAvailable" defaultChecked className="h-4 w-4" />
            Available for assignment
          </label>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || rooms.length === 0}>
              <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
              {pending ? 'Creating…' : 'Create bed'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
