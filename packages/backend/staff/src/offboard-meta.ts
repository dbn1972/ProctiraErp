/**
 * Thin offboard status helpers — metadata stored on staff.customData.__offboard.
 */
export const OFFBOARD_CUSTOM_DATA_KEY = '__offboard';

export interface StaffOffboardMeta {
  status: 'offboarded';
  effectiveDate: string;
  reason: string | null;
  decidedBy: string;
  decidedAt: string;
}

export function readOffboardMeta(
  customData: Record<string, unknown> | null | undefined,
): StaffOffboardMeta | null {
  if (!customData || typeof customData !== 'object') return null;
  const raw = customData[OFFBOARD_CUSTOM_DATA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<StaffOffboardMeta>;
  if (row.status !== 'offboarded') return null;
  if (typeof row.effectiveDate !== 'string' || typeof row.decidedBy !== 'string') return null;
  if (typeof row.decidedAt !== 'string') return null;
  return {
    status: 'offboarded',
    effectiveDate: row.effectiveDate,
    reason: typeof row.reason === 'string' ? row.reason : null,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
  };
}

export function writeOffboardMeta(
  customData: Record<string, unknown> | null | undefined,
  meta: StaffOffboardMeta,
): Record<string, unknown> {
  return {
    ...(customData ?? {}),
    [OFFBOARD_CUSTOM_DATA_KEY]: meta,
  };
}
