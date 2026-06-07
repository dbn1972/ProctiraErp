/**
 * apps/web/src/features/registration/components/RankedPreference.tsx —
 * Ranked-preference field for the public registration wizard
 * (Task 51.3, Requirement 16.10, Design §F).
 * =============================================================================
 *
 * Renders the applicant's 1st / 2nd / 3rd school choices as a reorderable
 * list. Pointer drag-and-drop is provided by `@dnd-kit/core` +
 * `@dnd-kit/sortable`; the same backend respects the keyboard sensor so
 * users without a pointer can reorder via:
 *
 *   • Tab            — focus the drag handle
 *   • Space / Enter  — pick up the focused item ("grab")
 *   • Arrow ↑ / ↓    — move the picked-up item before / after its neighbour
 *   • Space / Enter  — drop the item at its current position
 *   • Esc            — cancel the drag
 *
 * The component is a controlled field: it accepts the current
 * `preferences` array (1–3 entries) plus a callback to receive the new
 * order or removal. It does **not** own the schools' data — the parent
 * (the wizard's school-selection step) decides which schools may be added.
 *
 * Each row exposes its rank as a number badge plus the ordinal label
 * ("1st choice"), and announces reorder events via an
 * `aria-live="polite"` region so screen readers narrate "Moved Lincoln
 * High to 1st choice."
 *
 * The cap of three preferences is enforced at the wizard schema level
 * (`schoolSelectionSchema` in `../schemas.ts`); this component refuses to
 * accept more than three entries as a defensive measure.
 */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';

import type { SchoolPreference } from '../schemas';

/** Maximum ranked preferences (Requirement 16 AC 10). */
export const MAX_RANKED_PREFERENCES = 3;

/** Rank → human label. Used both by the badge and the live-region announce. */
const RANK_LABELS: Record<1 | 2 | 3, string> = {
  1: '1st choice',
  2: '2nd choice',
  3: '3rd choice',
};

export interface RankedPreferenceProps {
  /**
   * The current preferences in ranking order. The component ignores the
   * `rank` field on each entry and re-derives it from the array index so a
   * stale rank value cannot desynchronise with the visual order.
   */
  preferences: SchoolPreference[];
  /**
   * Called whenever the user reorders or removes a preference. Receives
   * the next array with `rank` re-derived from position.
   */
  onChange: (next: SchoolPreference[]) => void;
  /** Optional: disables drag, keyboard reorder, and the remove button. */
  disabled?: boolean;
  /** Optional: when present, rendered above the list as a heading. */
  heading?: string;
}

/**
 * Re-derives the `rank` field on every entry so the array index is the
 * source of truth. Anything past the third slot is dropped on the floor.
 */
function withDerivedRanks(items: SchoolPreference[]): SchoolPreference[] {
  return items
    .slice(0, MAX_RANKED_PREFERENCES)
    .map((item, idx) => ({ ...item, rank: (idx + 1) as 1 | 2 | 3 }));
}

interface SortableRowProps {
  preference: SchoolPreference;
  index: number;
  total: number;
  disabled: boolean;
  grabbedId: string | null;
  onRemove: (id: string) => void;
  onToggleGrab: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onCancelGrab: () => void;
}

function SortableRow({
  preference,
  index,
  total,
  disabled,
  grabbedId,
  onRemove,
  onToggleGrab,
  onMove,
  onCancelGrab,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: preference.schoolId, disabled });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const rank = (index + 1) as 1 | 2 | 3;
  const rankLabel = RANK_LABELS[rank];
  const isGrabbed = grabbedId === preference.schoolId;

  // Keyboard reorder handler. Tab to focus the handle, then:
  //   Space / Enter — toggle grab/drop
  //   ArrowUp       — move up while grabbed
  //   ArrowDown     — move down while grabbed
  //   Escape        — release without moving
  // We intercept arrow keys before dnd-kit's listeners so they always
  // route through `onMove`, regardless of whether the dnd-kit
  // KeyboardSensor has activated. This keeps the keyboard path
  // deterministic in environments (like jsdom) where dnd-kit's DOM
  // measurements are unreliable.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        onToggleGrab(preference.schoolId);
        return;
      }
      if (!isGrabbed) return;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        onMove(preference.schoolId, -1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        onMove(preference.schoolId, 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onCancelGrab();
      }
    },
    [disabled, isGrabbed, onCancelGrab, onMove, onToggleGrab, preference.schoolId],
  );

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-md border bg-background p-3 ${
        isGrabbed ? 'ring-2 ring-primary' : ''
      }`}
      data-testid={`preference-row-${preference.schoolId}`}
      data-rank={rank}
      data-grabbed={isGrabbed ? 'true' : 'false'}
      aria-label={`${preference.schoolName}, ${rankLabel} of ${total}`}
    >
      <button
        type="button"
        className="cursor-grab rounded-md border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={
          isGrabbed
            ? `Reordering ${preference.schoolName}. Use arrow up or down to move, space to drop.`
            : `Reorder ${preference.schoolName}, currently ${rankLabel}. Press space to pick up.`
        }
        disabled={disabled}
        data-testid={`drag-handle-${preference.schoolId}`}
        {...attributes}
        {...listeners}
        aria-pressed={isGrabbed}
        // Place keyboard handler AFTER the spread so dnd-kit's
        // KeyboardSensor binding does not override our explicit
        // grab/drop / arrow logic. Pointer reorder still flows
        // through the dnd-kit listeners spread above.
        onKeyDown={handleKeyDown}
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>
      <span
        className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground"
        aria-hidden="true"
      >
        {rank}
      </span>
      <div className="flex-1">
        <div className="text-sm font-medium">{preference.schoolName}</div>
        <div className="text-xs text-muted-foreground">
          <span className="sr-only">{rankLabel}: </span>
          {preference.schoolId}
        </div>
      </div>
      <button
        type="button"
        className="rounded-md border px-2 py-1 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => onRemove(preference.schoolId)}
        disabled={disabled}
        aria-label={`Remove ${preference.schoolName}`}
        data-testid={`remove-${preference.schoolId}`}
      >
        Remove
      </button>
    </li>
  );
}

/**
 * Ranked preference list with pointer + keyboard reorder.
 *
 * Renders nothing when `preferences` is empty; the parent is expected to
 * show an empty-state hint along the lines of "Search for schools above
 * and add up to three preferences."
 */
export function RankedPreference({
  preferences,
  onChange,
  disabled = false,
  heading,
}: RankedPreferenceProps): JSX.Element {
  // Track the most recent reorder for screen-reader narration.
  const [lastAnnouncement, setLastAnnouncement] = useState<string>('');
  // Tracks the id of the row currently "grabbed" via the keyboard.
  // Only one row is grabbed at a time; pressing Space again drops it.
  const [grabbedId, setGrabbedId] = useState<string | null>(null);

  // dnd-kit sensors. The KeyboardSensor with the sortable coordinate
  // getter handles browsers where the layout measurements are
  // available; the explicit per-row keyboard handler below is the
  // source of truth and works in any environment.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // 5 px activation distance prevents the click on the remove
      // button from being mis-interpreted as a drag start.
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ids = useMemo(() => preferences.map((p) => p.schoolId), [preferences]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = preferences.findIndex((p) => p.schoolId === active.id);
      const newIndex = preferences.findIndex((p) => p.schoolId === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(preferences, oldIndex, newIndex);
      const next = withDerivedRanks(reordered);
      onChange(next);
      const moved = next[newIndex];
      if (moved) {
        setLastAnnouncement(
          `Moved ${moved.schoolName} to ${RANK_LABELS[moved.rank]}.`,
        );
      }
    },
    [preferences, onChange],
  );

  const handleRemove = useCallback(
    (schoolId: string) => {
      const removed = preferences.find((p) => p.schoolId === schoolId);
      const filtered = preferences.filter((p) => p.schoolId !== schoolId);
      onChange(withDerivedRanks(filtered));
      if (removed) {
        setLastAnnouncement(`Removed ${removed.schoolName} from preferences.`);
      }
      if (grabbedId === schoolId) setGrabbedId(null);
    },
    [grabbedId, onChange, preferences],
  );

  const handleToggleGrab = useCallback(
    (schoolId: string) => {
      if (grabbedId === schoolId) {
        setGrabbedId(null);
        const item = preferences.find((p) => p.schoolId === schoolId);
        if (item) {
          setLastAnnouncement(
            `Dropped ${item.schoolName} at ${RANK_LABELS[item.rank]}.`,
          );
        }
      } else {
        setGrabbedId(schoolId);
        const item = preferences.find((p) => p.schoolId === schoolId);
        if (item) {
          setLastAnnouncement(
            `Picked up ${item.schoolName}. Use arrow up or down to move, space to drop.`,
          );
        }
      }
    },
    [grabbedId, preferences],
  );

  const handleCancelGrab = useCallback(() => {
    if (grabbedId) {
      const item = preferences.find((p) => p.schoolId === grabbedId);
      if (item) {
        setLastAnnouncement(`Cancelled reorder of ${item.schoolName}.`);
      }
    }
    setGrabbedId(null);
  }, [grabbedId, preferences]);

  const handleKeyboardMove = useCallback(
    (schoolId: string, direction: -1 | 1) => {
      const oldIndex = preferences.findIndex((p) => p.schoolId === schoolId);
      if (oldIndex === -1) return;
      const newIndex = oldIndex + direction;
      if (newIndex < 0 || newIndex >= preferences.length) return;
      const reordered = arrayMove(preferences, oldIndex, newIndex);
      const next = withDerivedRanks(reordered);
      onChange(next);
      const moved = next[newIndex];
      if (moved) {
        setLastAnnouncement(
          `Moved ${moved.schoolName} to ${RANK_LABELS[moved.rank]}.`,
        );
      }
    },
    [onChange, preferences],
  );

  return (
    <section
      aria-label={heading ?? 'Ranked school preferences'}
      data-testid="ranked-preference"
    >
      {heading ? (
        <h3 className="mb-2 text-sm font-medium">{heading}</h3>
      ) : null}
      {preferences.length === 0 ? (
        <p
          className="rounded-md border border-dashed p-3 text-sm text-muted-foreground"
          data-testid="ranked-preference-empty"
        >
          Add schools from the search results to rank up to{' '}
          {MAX_RANKED_PREFERENCES} choices.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={ids}
            strategy={verticalListSortingStrategy}
          >
            <ol
              className="space-y-2"
              aria-label="Ranked school preferences"
              data-testid="ranked-preference-list"
            >
              {preferences.map((preference, index) => (
                <SortableRow
                  key={preference.schoolId}
                  preference={preference}
                  index={index}
                  total={preferences.length}
                  disabled={disabled}
                  grabbedId={grabbedId}
                  onRemove={handleRemove}
                  onToggleGrab={handleToggleGrab}
                  onMove={handleKeyboardMove}
                  onCancelGrab={handleCancelGrab}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {/* Live region for reorder + remove announcements. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="ranked-preference-live-region"
      >
        {lastAnnouncement}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {preferences.length} of {MAX_RANKED_PREFERENCES} preferences ranked.
      </p>
    </section>
  );
}

export default RankedPreference;
