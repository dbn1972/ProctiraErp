const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface WeeklySlot {
  id: string;
  sectionName: string | null;
  dayOfWeek: number;
  periodName: string | null;
  startTime: string | null;
  endTime: string | null;
  roomName: string | null;
}

export function TimetableWeeklyGrid({ slots }: { slots: WeeklySlot[] }) {
  const byDay = new Map<number, WeeklySlot[]>();
  for (const slot of slots) {
    const list = byDay.get(slot.dayOfWeek) ?? [];
    list.push(slot);
    byDay.set(slot.dayOfWeek, list);
  }
  const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => (byDay.get(d) ?? []).length > 0);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="timetable-weekly-grid">
      {days.map((day) => (
        <section key={day} className="rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">{DAYS[day] ?? `Day ${day}`}</h3>
          <ul className="mt-2 space-y-2" role="list">
            {(byDay.get(day) ?? [])
              .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
              .map((slot) => (
                <li key={slot.id} className="text-sm">
                  <p className="font-medium">{slot.sectionName ?? 'Class'}</p>
                  <p className="text-xs text-muted-foreground">
                    {slot.periodName ?? 'Period'}
                    {slot.startTime ? ` · ${slot.startTime}` : ''}
                    {slot.endTime ? `–${slot.endTime}` : ''}
                    {slot.roomName ? ` · ${slot.roomName}` : ''}
                  </p>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
