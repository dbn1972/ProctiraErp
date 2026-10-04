'use server';
/**
 * Section coverage lookup for the new-assignment page (PRC-L051).
 *
 * Reads the staff-service assignments for one class + subject so the sidebar
 * shows who already teaches that section, instead of static placeholder copy.
 */
import { z } from 'zod';
import { getStaff, listSectionAssignments } from '@/lib/api/staff';
import { formatPersonLabel } from '@/lib/entity-label';

export interface SectionCoverageRow {
  staffId: string;
  staffLabel: string;
  allocationPercentage: number;
  startDate: string;
  endDate: string | null;
}

export type SectionCoverageState =
  { status: 'ok'; rows: SectionCoverageRow[] } | { status: 'error'; message: string };

const selectionSchema = z.object({ classId: z.string().uuid(), subjectId: z.string().uuid() });

export async function loadSectionCoverageAction(
  classId: string,
  subjectId: string,
): Promise<SectionCoverageState> {
  const parsed = selectionSchema.safeParse({ classId, subjectId });
  if (!parsed.success) return { status: 'error', message: 'Select a valid class and subject.' };
  const result = await listSectionAssignments(parsed.data.classId, parsed.data.subjectId);
  if (!result.ok) {
    return {
      status: 'error',
      message:
        result.kind === 'denied' || result.kind === 'unauthenticated'
          ? 'You do not have access to section coverage.'
          : 'Section coverage is unavailable right now.',
    };
  }
  const active = result.items.filter((row) => row.status === 'ACTIVE');
  const staffIds = [...new Set(active.map((row) => row.staffId))];
  const labels = new Map(
    await Promise.all(
      staffIds.map(async (id) => {
        const staff = await getStaff(id).catch(() => null);
        return [
          id,
          staff ? formatPersonLabel(staff.firstName, staff.lastName, staff.position) : '',
        ] as const;
      }),
    ),
  );
  return {
    status: 'ok',
    rows: active.map((row) => ({
      staffId: row.staffId,
      staffLabel: labels.get(row.staffId) || 'Staff member',
      allocationPercentage: row.allocationPercentage,
      startDate: row.startDate,
      endDate: row.endDate ?? null,
    })),
  };
}
