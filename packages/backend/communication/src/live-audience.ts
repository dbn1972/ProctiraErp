/**
 * Optional live audience counts from hostel / transport tables (raw pg).
 * Counts are null when DATABASE_URL is unset or the scope has no live source.
 * PRC-L089: a failed live query also yields null counts, but sets `liveError`
 * so the preview response tells the caller the live count failed.
 */
import { getSharedPgPool, withPgTenant, type PgQueryable } from '@proctira/database';
import type pg from 'pg';

function getPool(): pg.Pool | null {
  return getSharedPgPool();
}

export interface LiveAudienceCounts {
  hostelActiveAssignments: number | null;
  routeActiveAssignments: number | null;
  /** PRC-L089: set when a live count query failed (the counts are then null). */
  liveError?: boolean;
}

export async function fetchLiveAudienceCounts(
  tenantId: string,
  audienceJson: Record<string, unknown>,
): Promise<LiveAudienceCounts> {
  const rawPool = getPool();
  if (!rawPool) {
    return { hostelActiveAssignments: null, routeActiveAssignments: null };
  }
  // RLS on hostel_* / transport_* would silently return 0 without app.tenant_id.
  const db: PgQueryable = {
    query: (text, values) =>
      withPgTenant(rawPool, tenantId, (client) => client.query(text, values)),
  };

  const scope = String(audienceJson['scope'] ?? 'all').toLowerCase();
  let hostelActiveAssignments: number | null = null;
  let routeActiveAssignments: number | null = null;

  try {
    if (scope === 'hostel') {
      const hostelId =
        typeof audienceJson['hostelId'] === 'string' ? audienceJson['hostelId'] : null;
      if (hostelId) {
        const result = await db.query(
          `SELECT COUNT(*)::int AS c
           FROM hostel_assignments a
           JOIN hostel_beds b ON b.id = a.bed_id
           JOIN hostel_rooms r ON r.id = b.room_id
           JOIN hostel_blocks bl ON bl.id = r.block_id
           WHERE a.tenant_id = $1 AND a.is_active = true AND bl.hostel_id = $2`,
          [tenantId, hostelId],
        );
        hostelActiveAssignments = Number((result.rows[0] as { c?: number } | undefined)?.c ?? 0);
      } else {
        const result = await db.query(
          `SELECT COUNT(*)::int AS c
           FROM hostel_assignments
           WHERE tenant_id = $1 AND is_active = true`,
          [tenantId],
        );
        hostelActiveAssignments = Number((result.rows[0] as { c?: number } | undefined)?.c ?? 0);
      }
    }

    if (scope === 'route') {
      const routeId = typeof audienceJson['routeId'] === 'string' ? audienceJson['routeId'] : null;
      if (routeId) {
        const result = await db.query(
          `SELECT COUNT(*)::int AS c
           FROM transport_student_assignments
           WHERE tenant_id = $1 AND is_active = true AND route_id = $2`,
          [tenantId, routeId],
        );
        routeActiveAssignments = Number((result.rows[0] as { c?: number } | undefined)?.c ?? 0);
      } else {
        const result = await db.query(
          `SELECT COUNT(*)::int AS c
           FROM transport_student_assignments
           WHERE tenant_id = $1 AND is_active = true`,
          [tenantId],
        );
        routeActiveAssignments = Number((result.rows[0] as { c?: number } | undefined)?.c ?? 0);
      }
    }
  } catch {
    // PRC-L089: report the failure instead of silently using the estimator.
    return { hostelActiveAssignments: null, routeActiveAssignments: null, liveError: true };
  }
  return { hostelActiveAssignments, routeActiveAssignments };
}
