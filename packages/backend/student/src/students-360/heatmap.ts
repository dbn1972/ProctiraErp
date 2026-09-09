/**
 * G-914 — attendance heatmap aggregation from daily records.
 * Formula matches GET /attendance/percentage: (present + late) / total * 100.
 */
export type HeatSlot = 'present' | 'half' | 'absent' | 'empty';

export interface AttendanceDayInput {
  date: string;
  status: string;
}

export interface HeatmapDay {
  date: string;
  status: string | null;
  slot: HeatSlot;
}

export interface HeatmapResult {
  from: string;
  to: string;
  attendancePercentage: number;
  absencePercentage: number;
  totalRecords: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  excusedCount: number;
  days: HeatmapDay[];
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let cur = from; cur <= to; cur = addDays(cur, 1)) out.push(cur);
  return out;
}

function rankStatus(status: string): number {
  switch (status) {
    case 'ABSENT':
      return 3;
    case 'LATE':
      return 2;
    case 'EXCUSED':
      return 1;
    case 'PRESENT':
      return 0;
    default:
      return -1;
  }
}

function slotFor(status: string | null): HeatSlot {
  if (status === 'ABSENT') return 'absent';
  if (status === 'LATE') return 'half';
  if (status === 'PRESENT' || status === 'EXCUSED') return 'present';
  return 'empty';
}

function pickWorst(statuses: string[]): string | null {
  if (statuses.length === 0) return null;
  return statuses.reduce((best, cur) => (rankStatus(cur) > rankStatus(best) ? cur : best));
}

export function defaultHeatmapRange(now = new Date()): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  return { from: addDays(to, -29), to };
}

export function aggregateAttendanceHeatmap(
  records: AttendanceDayInput[],
  from: string,
  to: string,
): HeatmapResult {
  const byDate = new Map<string, string[]>();
  for (const rec of records) {
    if (rec.date < from || rec.date > to) continue;
    const list = byDate.get(rec.date) ?? [];
    list.push(rec.status);
    byDate.set(rec.date, list);
  }

  const days: HeatmapDay[] = eachDate(from, to).map((date) => {
    const status = pickWorst(byDate.get(date) ?? []);
    return { date, status, slot: slotFor(status) };
  });

  const totalRecords = records.filter((r) => r.date >= from && r.date <= to).length;
  const presentCount = records.filter((r) => r.date >= from && r.date <= to && r.status === 'PRESENT').length;
  const absentCount = records.filter((r) => r.date >= from && r.date <= to && r.status === 'ABSENT').length;
  const lateCount = records.filter((r) => r.date >= from && r.date <= to && r.status === 'LATE').length;
  const excusedCount = records.filter((r) => r.date >= from && r.date <= to && r.status === 'EXCUSED').length;
  const attendancePercentage =
    totalRecords === 0 ? 0 : Math.round(((presentCount + lateCount) / totalRecords) * 10000) / 100;
  const absencePercentage =
    totalRecords === 0 ? 0 : Math.round((absentCount / totalRecords) * 10000) / 100;

  return {
    from,
    to,
    attendancePercentage,
    absencePercentage,
    totalRecords,
    presentCount,
    absentCount,
    lateCount,
    excusedCount,
    days,
  };
}
