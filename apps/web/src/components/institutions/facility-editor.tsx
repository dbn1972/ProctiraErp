'use client';

import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { useHydrated } from '@/hooks/useHydrated';
import { normCondition, type FacilityConditionKind } from '@/lib/institutions/facility-condition';

import {
  createRoomAction,
  updateFacilityAction,
} from '@/app/(dashboard)/institutions/[id]/infrastructure/actions';
import { Button, Input, Label } from '@proctira/ui/components';

const CONDITIONS = ['Good', 'Fair', 'Needs repair', 'Unknown'] as const;
type EditorCondition = (typeof CONDITIONS)[number];

const EDITOR_CONDITION: Record<FacilityConditionKind, EditorCondition> = {
  good: 'Good',
  fair: 'Fair',
  repair: 'Needs repair',
  unknown: 'Unknown',
};

/** Map a stored (possibly legacy upper-snake) condition onto an editor option. */
function toEditorCondition(condition: string): EditorCondition {
  return EDITOR_CONDITION[normCondition(condition)];
}

interface FacilityNode {
  id: string;
  name: string;
  capacity: number;
  condition: string;
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
  const hydrated = useHydrated();
  const router = useRouter();
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
          if (!selected) return;
          const fd = new FormData(event.currentTarget);
          // PRC-L255: send only what the user changed, so untouched values are
          // never overwritten with blanks or the 'Good' default. An unmapped
          // legacy condition the user left alone is not rewritten either.
          const changes: { name?: string; capacity?: number; condition?: EditorCondition } = {};
          const name = String(fd.get('name') ?? '');
          if (name !== selected.name) changes.name = name.trim();
          const capacity = Number(fd.get('capacity') ?? '');
          if (capacity !== selected.capacity) changes.capacity = capacity;
          const condition = String(fd.get('condition') ?? '') as EditorCondition;
          if (condition !== toEditorCondition(selected.condition)) changes.condition = condition;
          setError(null);
          if (Object.keys(changes).length === 0) {
            setMessage('No changes to save.');
            return;
          }
          startTransition(async () => {
            const result = await updateFacilityAction({
              institutionId,
              id: selected.id,
              ...changes,
            });
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
        {/* Keyed by the selection so the uncontrolled fields remount with the
            newly selected facility's values (PRC-L255). */}
        <Fragment key={editId}>
          <div className="space-y-1">
            <Label htmlFor="edit-name">Name</Label>
            <Input
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
                id="edit-capacity"
                name="capacity"
                type="number"
                min={1}
                max={99999}
                required
                defaultValue={selected?.capacity}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-condition">Condition</Label>
              <select
                id="edit-condition"
                name="condition"
                className="h-10 rounded-md border bg-background px-3 text-sm"
                defaultValue={selected ? toEditorCondition(selected.condition) : undefined}
              >
                {CONDITIONS.map((condition) => (
                  <option key={condition} value={condition}>
                    {condition}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Fragment>
        <Button type="submit" size="sm" disabled={pending || !selected}>
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
