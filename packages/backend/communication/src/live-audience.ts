/**
 * Optional live audience counts from hostel / transport tables (raw pg).
 * Falls back to null when DATABASE_URL is unset or queries fail.
 */
import { withPgTenant, type PgQueryable } from '@proctira/database';
import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (!pool) pool = new Pool({ connectionString: url });
  return pool;
}

export interface LiveAudienceCounts {
  hostelActiveAssignments: number | null;
  routeActiveAssignments: number | null;
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
    // Tables may be absent in unit tests without schema — keep nulls.
  }

  return { hostelActiveAssignments, routeActiveAssignments };
}
