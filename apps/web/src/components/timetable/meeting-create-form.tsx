'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@proctira/ui/components';

import { createMeetingAction, unpublishSectionAction } from '@/app/(dashboard)/timetable-actions';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { formatTeacherClash } from '@/lib/timetable/meeting-conflict-label';

/** ISO weekday: 1=Mon … 7=Sun (matches 003 schema). */
const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

export function MeetingCreateForm(props: {
  institutionId: string;
  academicPeriodId: string;
  periodOptions: { id: string; label: string }[];
  sectionOptions?: { id: string; label: string; status?: string }[];
  roomOptions?: { id: string; label: string }[];
  staffOptions?: { id: string; label: string }[];
  initial?: {
    sectionId?: string;
    staffId?: string;
    periodId?: string;
    roomId?: string;
    dayOfWeek?: number;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState(
    props.initial?.sectionId ?? props.sectionOptions?.[0]?.id ?? '',
  );
  const [staffId, setStaffId] = useState(
    props.initial?.staffId ?? props.staffOptions?.[0]?.id ?? '',
  );
  const [periodId, setPeriodId] = useState(
    props.initial?.periodId ?? props.periodOptions[0]?.id ?? '',
  );
  const [roomId, setRoomId] = useState(props.initial?.roomId ?? props.roomOptions?.[0]?.id ?? '');
  const [dayOfWeek, setDayOfWeek] = useState(String(props.initial?.dayOfWeek ?? 1));
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const selectedSection = props.sectionOptions?.find((item) => item.id === sectionId);
  const publishedLocked = selectedSection?.status === 'PUBLISHED';

  function unpublishSelected() {
    if (!sectionId) return;
    setError(null);
    startTransition(async () => {
      const result = await unpublishSectionAction({
        institutionId: props.institutionId,
        sectionId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUnpublishOpen(false);
      router.refresh();
    });
  }

  if (props.periodOptions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Create a bell schedule with periods for this institution before editing the grid.
      </p>
    );
  }

  return (
    <form
      id="add-meeting"
      data-testid="add-meeting-form"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (publishedLocked) {
          setError(
            'This section is published, so meetings are locked. Unpublish it to draft before adding a meeting.',
          );
          return;
        }
        startTransition(async () => {
          const result = await createMeetingAction({
            institutionId: props.institutionId,
            academicPeriodId: props.academicPeriodId,
            sectionId,
            staffId,
            periodId,
            dayOfWeek: Number(dayOfWeek),
            roomId: roomId || null,
          });
          if (!result.ok) {
            const clash = result.conflicts?.find((item) => item.reason === 'staff');
            if (result.status === 409 && clash) {
              const teacher =
                props.staffOptions?.find((item) => item.id === staffId)?.label ?? 'This teacher';
              const section =
                props.sectionOptions?.find((item) => item.id === clash.sectionId)?.label ??
                'another section';
              const period =
                props.periodOptions.find((item) => item.id === clash.periodId)?.label ??
                'that period';
              setError(
                `Conflict (409). ${formatTeacherClash({
                  teacherLabel: teacher,
                  dayOfWeek: clash.dayOfWeek,
                  periodLabel: period,
                  sectionLabel: section,
                })}`,
              );
              return;
            }
            setError(
              /published schedule is locked/i.test(result.error)
                ? 'This section is published, so meetings are locked. Unpublish it to draft before adding a meeting.'
                : result.status === 409
                  ? `Conflict (409). ${result.error}`
                  : result.error,
            );
            return;
          }
          router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          Section<span className="text-destructive"> *</span>
        </span>
        {props.sectionOptions && props.sectionOptions.length > 0 ? (
          <select
            className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            required
          >
            {props.sectionOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            No sections are available yet. Create a section first, then add meetings.
          </p>
        )}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          Staff<span className="text-destructive"> *</span>
        </span>
        {props.staffOptions && props.staffOptions.length > 0 ? (
          <select
            className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            required
          >
            {props.staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            Staff directory is unavailable. Try again when the directory loads.
          </p>
        )}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          Period<span className="text-destructive"> *</span>
        </span>
        <select
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          value={periodId}
          onChange={(e) => setPeriodId(e.target.value)}
          required
        >
          {props.periodOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Room</span>
        <select
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
        >
          <option value="">None</option>
          {(props.roomOptions ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          Day<span className="text-destructive"> *</span>
        </span>
        <select
          className="h-11 min-h-11 rounded-md border border-border bg-background px-3 py-2"
          value={dayOfWeek}
          onChange={(e) => setDayOfWeek(e.target.value)}
        >
          {DAYS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end">
        <Button
          type="submit"
          size="sm"
          disabled={
            pending ||
            publishedLocked ||
            !(props.sectionOptions && props.sectionOptions.length > 0) ||
            !(props.staffOptions && props.staffOptions.length > 0)
          }
          className="w-full"
        >
          {pending ? 'Saving…' : 'Add meeting'}
        </Button>
      </div>
      {publishedLocked && (
        <div
          className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 sm:col-span-2 lg:col-span-3 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
          role="status"
        >
          <p>
            This section is published, so meetings are locked. Unpublish it to draft before adding a
            meeting.
          </p>
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setUnpublishOpen(true)}
            >
              Unpublish to draft
            </Button>
          </div>
        </div>
      )}
      <ConfirmActionDialog
        open={unpublishOpen}
        onOpenChange={setUnpublishOpen}
        title="Unpublish this section?"
        description="The section returns to draft. Students keep their places, and you can add or edit meetings until you publish again."
        confirmLabel="Unpublish to draft"
        destructive
        pending={pending}
        testId="unpublish-section-from-meeting"
        onConfirm={unpublishSelected}
      />
      {error && (
        <p
          className="text-sm text-red-600 dark:text-red-400 sm:col-span-2 lg:col-span-3"
          role="alert"
        >
          {error}
        </p>
      )}
    </form>
  );
}
