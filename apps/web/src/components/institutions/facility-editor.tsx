'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { useHydrated } from '@/hooks/useHydrated';

import {
  createRoomAction,
  updateFacilityAction,
} from '@/app/(dashboard)/institutions/[id]/infrastructure/actions';
import { Button, Input, Label } from '@proctira/ui/components';

const CONDITIONS = ['Good', 'Fair', 'Needs repair', 'Unknown'] as const;
type Condition = (typeof CONDITIONS)[number];

export interface FacilityNode {
  id: string;
  name: string;
  capacity?: number;
  condition?: string;
}

/** Map a gateway condition string (any case) onto the editable condition set. */
function toCondition(value: string | undefined): Condition {
  const match = CONDITIONS.find((c) => c.toLowerCase() === (value ?? '').toLowerCase());
  return match ?? 'Unknown';
}

export function FacilityEditor({
  institutionId,
  floors,
  nodes,
}: {
  institutionId: string;
  floors: Array<{ id: string; name: string }>;
  nodes: FacilityNode[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editId, setEditId] = useState(nodes[0]?.id ?? '');
  const selected = nodes.find((node) => node.id === editId);

  return (
    <div
      className="grid gap-4 lg:grid-cols-2"
      data-testid="facility-editor"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <form
        className="space-y-2 rounded-lg border p-4"
        data-testid="add-room-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const fd = new FormData(form);
          setError(null);
          startTransition(async () => {
            const result = await createRoomAction({
              institutionId,
              floorId: String(fd.get('floorId') ?? ''),
              name: String(fd.get('name') ?? ''),
              capacity: Number(fd.get('capacity') ?? 1),
              condition: String(fd.get('condition') ?? 'Good') as (typeof CONDITIONS)[number],
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setMessage('Room added.');
            form.reset();
            router.refresh();
          });
        }}
      >
        <h3 className="text-sm font-semibold">Add room</h3>
        <div className="space-y-1">
          <Label htmlFor="room-floor">Floor</Label>
          <select
            id="room-floor"
            name="floorId"
            required
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            {floors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="room-name">Name</Label>
          <Input id="room-name" name="name" required maxLength={255} />
        </div>
        <div className="flex gap-2">
          <div className="space-y-1">
            <Label htmlFor="room-capacity">Capacity</Label>
            <Input id="room-capacity" name="capacity" type="number" min={1} max={99999} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="room-condition">Condition</Label>
            <select
              id="room-condition"
              name="condition"
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              {CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {condition}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button type="submit" size="sm" disabled={pending || floors.length === 0}>
          Add room
        </Button>
      </form>

      <form
        className="space-y-2 rounded-lg border p-4"
        data-testid="edit-facility-form"
        onSubmit={(event) => {
          event.preventDefault();
          const fd = new FormData(event.currentTarget);
          setError(null);
          // Send only the fields the user actually changed (PUT accepts partial bodies).
          const name = String(fd.get('name') ?? '').trim();
          const capacity = Number(fd.get('capacity') ?? 0);
          const condition = toCondition(String(fd.get('condition') ?? ''));
          const changes: { name?: string; capacity?: number; condition?: Condition } = {};
          if (name && name !== selected?.name) changes.name = name;
          if (Number.isFinite(capacity) && capacity >= 1 && capacity !== selected?.capacity) {
            changes.capacity = capacity;
          }
          if (condition !== toCondition(selected?.condition)) changes.condition = condition;
          if (Object.keys(changes).length === 0) {
            setMessage('No changes to save.');
            return;
          }
          startTransition(async () => {
            const result = await updateFacilityAction({ institutionId, id: editId, ...changes });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setMessage('Facility updated.');
            router.refresh();
          });
        }}
      >
        <h3 className="text-sm font-semibold">Edit facility</h3>
        <div className="space-y-1">
          <Label htmlFor="edit-facility">Facility</Label>
          <select
            id="edit-facility"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={editId}
            onChange={(event) => setEditId(event.target.value)}
          >
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-name">Name</Label>
          <Input
            key={`name-${editId}`}
            id="edit-name"
            name="name"
            required
            maxLength={255}
            defaultValue={selected?.name ?? ''}
          />
        </div>
        <div className="flex gap-2">
          <div className="space-y-1">
            <Label htmlFor="edit-capacity">Capacity</Label>
            <Input
              key={`capacity-${editId}`}
              id="edit-capacity"
              name="capacity"
              type="number"
              min={1}
              max={99999}
              required
              defaultValue={selected?.capacity ?? ''}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-condition">Condition</Label>
            <select
              key={`condition-${editId}`}
              id="edit-condition"
              name="condition"
              defaultValue={toCondition(selected?.condition)}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              {CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {condition}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button type="submit" size="sm" disabled={pending || nodes.length === 0}>
          Save facility
        </Button>
      </form>
      {message ? (
        <p className="text-sm text-muted-foreground lg:col-span-2" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive lg:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
