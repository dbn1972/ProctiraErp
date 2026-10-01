/**
 * Pure derivations for the staff profile (PRC-L048).
 *
 * Leave usage comes from the leave records (`/staff/leaves`), not from
 * free-form `customData`. Service history in `customData` is validated with zod
 * so malformed entries are dropped rather than rendered as authoritative.
 */
import { z } from 'zod';
import type { Appraisal, StaffLeave } from '@/lib/api/staff';

export interface LeaveUsage {
  leaveType: string;
  approvedDays: number;
  pendingRequests: number;
}

/** Inclusive day count between two `YYYY-MM-DD` dates (matches the leave service). */
export function inclusiveDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${endDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

/** Approved days and pending requests per leave type for `staffId` in `year`. */
export function summariseLeaveUsage(
  leaves: StaffLeave[],
  staffId: string,
  year: number,
): LeaveUsage[] {
  const byType = new Map<string, LeaveUsage>();
  for (const leave of leaves) {
    if (leave.staffId !== staffId) continue;
    if (!leave.startDate.startsWith(String(year))) continue;
    const entry = byType.get(leave.leaveType) ?? {
      leaveType: leave.leaveType,
      approvedDays: 0,
      pendingRequests: 0,
    };
    if (leave.status === 'approved') {
      entry.approvedDays += inclusiveDays(leave.startDate, leave.endDate);
    } else if (leave.status === 'pending') {
      entry.pendingRequests += 1;
    } else {
      continue;
    }
    byType.set(leave.leaveType, entry);
  }
  return [...byType.values()].sort((a, b) => a.leaveType.localeCompare(b.leaveType));
}

/** Newest appraisal first (`appraisalDate`, then `createdAt`). */
export function sortAppraisalsDesc(appraisals: Appraisal[]): Appraisal[] {
  return [...appraisals].sort(
    (a, b) =>
      b.appraisalDate.localeCompare(a.appraisalDate) || b.createdAt.localeCompare(a.createdAt),
  );
}

/** `"7.5 / 10"` using the template scale, or the bare score when the template is unknown. */
export function formatAppraisalScore(
  totalScore: number,
  scoreMax: number | null | undefined,
  digits = 1,
): string {
  const score = totalScore.toFixed(digits);
  return typeof scoreMax === 'number' && scoreMax > 0 ? `${score} / ${scoreMax}` : score;
}

const serviceEventSchema = z.object({
  date: z.string().nullish(),
  title: z.string().min(1),
  detail: z.string().nullish(),
  type: z.string().optional(),
});

export type ServiceEvent = z.infer<typeof serviceEventSchema>;

/** Validated service-history entries from `customData.serviceHistory`. */
export function parseServiceHistory(raw: unknown): ServiceEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = serviceEventSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
