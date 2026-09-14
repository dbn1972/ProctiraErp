/**
 * Postgres-backed admissions CRM store (G-717).
 *
 * Persists waitlist entries, interview slots and bookings to the tables from
 * db/sql/014_admissions_crm_schema.sql. Every statement runs inside
 * `withPgTenant` (BEGIN + `app.tenant_id` GUC) so RLS from 015/024 applies.
 *
 * Concurrency:
 *  - waitlist position is assigned under a per (tenant, institution) advisory
 *    lock so `UNIQUE (tenant_id, institution_id, position)` cannot race;
 *  - `enqueueWaitlist` is idempotent per application via
 *    `ON CONFLICT (tenant_id, application_id) DO NOTHING`;
 *  - `bookSlot` is idempotent per (slot, application).
 */
import { withPgTenant, type PgQueryable } from '@proctira/database';
import { v4 as uuidv4 } from 'uuid';

import type {
  AdmissionsCrmStore,
  BookSlotInput,
  CreateSlotInput,
  EnqueueWaitlistInput,
  InterviewBooking,
  InterviewSlot,
  WaitlistEntry,
} from './admissions-crm-store.js';
import { ensureRegistrationSchema, type PgPoolLike } from './pg-registration-repository.js';

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function mapWaitlist(row: Record<string, unknown>): WaitlistEntry {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    applicationId: String(row.application_id),
    institutionId: String(row.institution_id),
    position: Number(row.position),
    notes: row.notes == null ? null : String(row.notes),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapSlot(row: Record<string, unknown>): InterviewSlot {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    institutionId: String(row.institution_id),
    startsAt: toDate(row.starts_at),
    endsAt: toDate(row.ends_at),
    capacity: Number(row.capacity),
    location: row.location == null ? null : String(row.location),
    status: String(row.status) as InterviewSlot['status'],
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapBooking(row: Record<string, unknown>): InterviewBooking {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    slotId: String(row.slot_id),
    applicationId: String(row.application_id),
    status: String(row.status) as InterviewBooking['status'],
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class PgAdmissionsCrmStore implements AdmissionsCrmStore {
  constructor(private readonly pool: PgPoolLike) {}

  async ensureSchema(): Promise<void> {
    await ensureRegistrationSchema(this.pool);
  }

  private async withTenant<T>(
    tenantId: string,
    fn: (client: PgQueryable) => Promise<T>,
  ): Promise<T> {
    await this.ensureSchema();
    return withPgTenant(this.pool, tenantId, fn);
  }

  async listWaitlist(tenantId: string, institutionId?: string): Promise<WaitlistEntry[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM admission_waitlist_entries
          WHERE tenant_id = $1 AND ($2::uuid IS NULL OR institution_id = $2)
          ORDER BY position ASC`,
        [tenantId, institutionId ?? null],
      );
      return (result.rows as Record<string, unknown>[]).map(mapWaitlist);
    });
  }

  async enqueueWaitlist(input: EnqueueWaitlistInput): Promise<WaitlistEntry> {
    return this.withTenant(input.tenantId, async (client) => {
      // Serialise position assignment per institution queue.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `waitlist:${input.tenantId}:${input.institutionId}`,
      ]);
      const inserted = await client.query(
        `INSERT INTO admission_waitlist_entries
           (id, tenant_id, application_id, institution_id, position, notes)
         SELECT $1, $2, $3, $4,
                COALESCE(MAX(position), 0) + 1,
                $5
           FROM admission_waitlist_entries
          WHERE tenant_id = $2 AND institution_id = $4
         ON CONFLICT (tenant_id, application_id) DO NOTHING
         RETURNING *`,
        [uuidv4(), input.tenantId, input.applicationId, input.institutionId, input.notes ?? null],
      );
      const row = (inserted.rows as Record<string, unknown>[])[0];
      if (row) return mapWaitlist(row);

      const existing = await client.query(
        `SELECT * FROM admission_waitlist_entries WHERE tenant_id = $1 AND application_id = $2`,
        [input.tenantId, input.applicationId],
      );
      const found = (existing.rows as Record<string, unknown>[])[0];
      if (!found) {
        throw new Error('Waitlist entry insert conflicted but no existing row found');
      }
      return mapWaitlist(found);
    });
  }

  async dequeueWaitlistHead(
    tenantId: string,
    institutionId: string,
  ): Promise<WaitlistEntry | null> {
    return this.withTenant(tenantId, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `waitlist:${tenantId}:${institutionId}`,
      ]);
      const head = await client.query(
        `SELECT * FROM admission_waitlist_entries
          WHERE tenant_id = $1 AND institution_id = $2
          ORDER BY position ASC
          LIMIT 1
          FOR UPDATE`,
        [tenantId, institutionId],
      );
      const row = (head.rows as Record<string, unknown>[])[0];
      if (!row) return null;
      await client.query(`DELETE FROM admission_waitlist_entries WHERE id = $1 AND tenant_id = $2`, [
        row.id,
        tenantId,
      ]);
      return mapWaitlist(row);
    });
  }

  async createSlot(input: CreateSlotInput): Promise<InterviewSlot> {
    return this.withTenant(input.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO admission_interview_slots
           (id, tenant_id, institution_id, starts_at, ends_at, capacity, location, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
         RETURNING *`,
        [
          uuidv4(),
          input.tenantId,
          input.institutionId,
          new Date(input.startsAt),
          new Date(input.endsAt),
          input.capacity ?? 1,
          input.location ?? null,
        ],
      );
      return mapSlot((result.rows as Record<string, unknown>[])[0]!);
    });
  }

  async listSlots(tenantId: string, institutionId?: string): Promise<InterviewSlot[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM admission_interview_slots
          WHERE tenant_id = $1 AND ($2::uuid IS NULL OR institution_id = $2)
          ORDER BY starts_at ASC`,
        [tenantId, institutionId ?? null],
      );
      return (result.rows as Record<string, unknown>[]).map(mapSlot);
    });
  }

  async findSlot(id: string, tenantId: string): Promise<InterviewSlot | null> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM admission_interview_slots WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = (result.rows as Record<string, unknown>[])[0];
      return row ? mapSlot(row) : null;
    });
  }

  async listBookingsForSlot(tenantId: string, slotId: string): Promise<InterviewBooking[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM admission_interview_bookings
          WHERE tenant_id = $1 AND slot_id = $2 AND status = 'booked'
          ORDER BY created_at ASC`,
        [tenantId, slotId],
      );
      return (result.rows as Record<string, unknown>[]).map(mapBooking);
    });
  }

  async bookSlot(input: BookSlotInput): Promise<InterviewBooking> {
    return this.withTenant(input.tenantId, async (client) => {
      // Lock the slot row so concurrent bookings see a consistent count.
      await client.query(
        `SELECT id FROM admission_interview_slots WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [input.slotId, input.tenantId],
      );
      const inserted = await client.query(
        `INSERT INTO admission_interview_bookings
           (id, tenant_id, slot_id, application_id, status)
         VALUES ($1, $2, $3, $4, 'booked')
         ON CONFLICT (slot_id, application_id) DO NOTHING
         RETURNING *`,
        [uuidv4(), input.tenantId, input.slotId, input.applicationId],
      );
      const row = (inserted.rows as Record<string, unknown>[])[0];
      if (row) return mapBooking(row);

      const existing = await client.query(
        `SELECT * FROM admission_interview_bookings
          WHERE tenant_id = $1 AND slot_id = $2 AND application_id = $3`,
        [input.tenantId, input.slotId, input.applicationId],
      );
      const found = (existing.rows as Record<string, unknown>[])[0];
      if (!found) {
        throw new Error('Interview booking insert conflicted but no existing row found');
      }
      return mapBooking(found);
    });
  }

  async listBookingsForApplication(
    tenantId: string,
    applicationId: string,
  ): Promise<InterviewBooking[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM admission_interview_bookings
          WHERE tenant_id = $1 AND application_id = $2
          ORDER BY created_at ASC`,
        [tenantId, applicationId],
      );
      return (result.rows as Record<string, unknown>[]).map(mapBooking);
    });
  }
}
