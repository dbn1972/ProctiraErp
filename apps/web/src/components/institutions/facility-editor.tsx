'use client';

import { useState, useTransition } from 'react';

import { useHydrated } from '@/hooks/useHydrated';

import {
  createRoomAction,
  updateFacilityAction,
} from '@/app/(dashboard)/institutions/[id]/infrastructure/actions';
import { Button, Input, Label } from '@proctira/ui/components';
import { createRoomSchema, updateFacilitySchema } from '@/lib/validation/campus-actions-schema';
import { firstIssue } from '@/lib/validation/campus-action-schema';

const CONDITIONS = ['Good', 'Fair', 'Needs repair', 'Unknown'] as const;

export function FacilityEditor({
  institutionId,
  floors,
  nodes,
}: {
  institutionId: string;
  floors: Array<{ id: string; name: string }>;
  nodes: Array<{ id: string; name: string }>;
}) {
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editId, setEditId] = useState(nodes[0]?.id ?? '');

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
            // PRC-L241: same schema the server action enforces.
            const payload = {
              institutionId,
              floorId: String(fd.get('floorId') ?? ''),
              name: String(fd.get('name') ?? ''),
              capacity: Number(fd.get('capacity') ?? 1),
              condition: String(fd.get('condition') ?? 'Good') as (typeof CONDITIONS)[number],
            };
            const checked = createRoomSchema.safeParse(payload);
            if (!checked.success) {
              setError(firstIssue(checked.error, 'Please check the highlighted fields.'));
              return;
            }
            const result = await createRoomAction(payload);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setMessage('Room added.');
            form.reset();
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
          startTransition(async () => {
            // PRC-L241: same schema the server action enforces.
            const payload = {
              institutionId,
              id: editId,
              name: String(fd.get('name') ?? ''),
              capacity: Number(fd.get('capacity') ?? 1),
              condition: String(fd.get('condition') ?? 'Good') as (typeof CONDITIONS)[number],
            };
            const checked = updateFacilitySchema.safeParse(payload);
            if (!checked.success) {
              setError(firstIssue(checked.error, 'Please check the highlighted fields.'));
              return;
            }
            const result = await updateFacilityAction(payload);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setMessage('Facility updated.');
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
          <Input id="edit-name" name="name" required maxLength={255} />
        </div>
        <div className="flex gap-2">
          <div className="space-y-1">
            <Label htmlFor="edit-capacity">Capacity</Label>
            <Input id="edit-capacity" name="capacity" type="number" min={1} max={99999} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-condition">Condition</Label>
            <select
              id="edit-condition"
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
