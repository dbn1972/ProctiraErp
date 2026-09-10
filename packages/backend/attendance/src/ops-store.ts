/**
 * G-919 — regularisation, leave, device keys, ingest events.
 * Raw pg (db/sql/042, RLS via withPgTenant) or in-memory for tests.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { withPgTenant, type PgQueryable } from '@proctira/database';

export type RequestStatus = 'requested' | 'approved' | 'rejected';
export type PunchType = 'IN' | 'OUT';

export function hashDeviceApiKey(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function mintDeviceApiKey(): string {
  return `att_${randomBytes(24).toString('hex')}`;
}

export interface RegularisationRecord {
  id: string;
  tenantId: string;
  attendanceId: string;
  studentId: string;
  institutionId: string;
  classId: string;
  attendanceDate: string;
  fromStatus: string;
  toStatus: string;
  reason: string | null;
  requesterId: string;
  requesterRole: string | null;
  status: RequestStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequestRecord {
  id: string;
  tenantId: string;
  studentId: string;
  institutionId: string;
  classId: string;
  academicPeriodId: string;
  fromDate: string;
  toDate: string;
  reason: string | null;
  attachmentUrl: string | null;
  requesterId: string;
  requesterRole: string | null;
  status: RequestStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceKeyRecord {
  id: string;
  tenantId: string;
  institutionId: string;
  deviceId: string;
  apiKeyHash: string;
  label: string | null;
  status: 'active' | 'revoked';
  createdAt: string;
}

export interface IngestEventRecord {
  id: string;
  tenantId: string;
  institutionId: string;
  deviceId: string;
  eventId: string;
  studentId: string;
  punchedAt: string;
  punchType: PunchType;
  attendanceId: string | null;
  duplicate: boolean;
  createdAt: string;
}

export interface AttendanceOpsStore {
  createRegularisation(row: RegularisationRecord): Promise<RegularisationRecord>;
  listRegularisations(
    tenantId: string,
    filter?: { status?: RequestStatus },
  ): Promise<RegularisationRecord[]>;
  getRegularisation(tenantId: string, id: string): Promise<RegularisationRecord | null>;
  updateRegularisation(
    tenantId: string,
    id: string,
    patch: Partial<RegularisationRecord>,
  ): Promise<RegularisationRecord | null>;

  createLeave(row: LeaveRequestRecord): Promise<LeaveRequestRecord>;
  listLeaves(tenantId: string, filter?: { status?: RequestStatus }): Promise<LeaveRequestRecord[]>;
  getLeave(tenantId: string, id: string): Promise<LeaveRequestRecord | null>;
  updateLeave(
    tenantId: string,
    id: string,
    patch: Partial<LeaveRequestRecord>,
  ): Promise<LeaveRequestRecord | null>;

  createDeviceKey(row: DeviceKeyRecord): Promise<DeviceKeyRecord>;
  findDeviceKeyByHash(tenantId: string, apiKeyHash: string): Promise<DeviceKeyRecord | null>;
  listDeviceKeys(tenantId: string, institutionId?: string): Promise<DeviceKeyRecord[]>;

  findIngestEvent(
    tenantId: string,
    deviceId: string,
    eventId: string,
  ): Promise<IngestEventRecord | null>;
  createIngestEvent(row: IngestEventRecord): Promise<IngestEventRecord>;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

export class InMemoryAttendanceOpsStore implements AttendanceOpsStore {
  private readonly regularisations = new Map<string, RegularisationRecord>();
  private readonly leaves = new Map<string, LeaveRequestRecord>();
  private readonly devices = new Map<string, DeviceKeyRecord>();
  private readonly ingest = new Map<string, IngestEventRecord>();

  async createRegularisation(row: RegularisationRecord) {
    this.regularisations.set(row.id, clone(row));
    return clone(row);
  }
  async listRegularisations(tenantId: string, filter?: { status?: RequestStatus }) {
    return [...this.regularisations.values()]
      .filter((r) => r.tenantId === tenantId && (!filter?.status || r.status === filter.status))
      .map(clone);
  }
  async getRegularisation(tenantId: string, id: string) {
    const row = this.regularisations.get(id);
    return row && row.tenantId === tenantId ? clone(row) : null;
  }
  async updateRegularisation(tenantId: string, id: string, patch: Partial<RegularisationRecord>) {
    const cur = await this.getRegularisation(tenantId, id);
    if (!cur) return null;
    const next = {
      ...cur,
      ...patch,
      id: cur.id,
      tenantId: cur.tenantId,
      updatedAt: new Date().toISOString(),
    };
    this.regularisations.set(id, next);
    return clone(next);
  }

  async createLeave(row: LeaveRequestRecord) {
    this.leaves.set(row.id, clone(row));
    return clone(row);
  }
  async listLeaves(tenantId: string, filter?: { status?: RequestStatus }) {
    return [...this.leaves.values()]
      .filter((r) => r.tenantId === tenantId && (!filter?.status || r.status === filter.status))
      .map(clone);
  }
  async getLeave(tenantId: string, id: string) {
    const row = this.leaves.get(id);
    return row && row.tenantId === tenantId ? clone(row) : null;
  }
  async updateLeave(tenantId: string, id: string, patch: Partial<LeaveRequestRecord>) {
    const cur = await this.getLeave(tenantId, id);
    if (!cur) return null;
    const next = {
      ...cur,
      ...patch,
      id: cur.id,
      tenantId: cur.tenantId,
      updatedAt: new Date().toISOString(),
    };
    this.leaves.set(id, next);
    return clone(next);
  }

  async createDeviceKey(row: DeviceKeyRecord) {
    this.devices.set(row.id, clone(row));
    return clone(row);
  }
  async findDeviceKeyByHash(tenantId: string, apiKeyHash: string) {
    const row = [...this.devices.values()].find(
      (d) => d.tenantId === tenantId && d.apiKeyHash === apiKeyHash && d.status === 'active',
    );
    return row ? clone(row) : null;
  }
  async listDeviceKeys(tenantId: string, institutionId?: string) {
    return [...this.devices.values()]
      .filter(
        (d) => d.tenantId === tenantId && (!institutionId || d.institutionId === institutionId),
      )
      .map(clone);
  }

  async findIngestEvent(tenantId: string, deviceId: string, eventId: string) {
    const row = [...this.ingest.values()].find(
      (e) => e.tenantId === tenantId && e.deviceId === deviceId && e.eventId === eventId,
    );
    return row ? clone(row) : null;
  }
  async createIngestEvent(row: IngestEventRecord) {
    this.ingest.set(row.id, clone(row));
    return clone(row);
  }
}

function str(v: unknown): string {
  return String(v ?? '');
}
function strOrNull(v: unknown): string | null {
  return v == null ? null : String(v);
}
function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
function isoOrNull(v: unknown): string | null {
  if (v == null) return null;
  return iso(v);
}
function dateOnly(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function toReg(row: Record<string, unknown>): RegularisationRecord {
  return {
    id: str(row.id),
    tenantId: str(row.tenant_id),
    attendanceId: str(row.attendance_id),
    studentId: str(row.student_id),
    institutionId: str(row.institution_id),
    classId: str(row.class_id),
    attendanceDate: dateOnly(row.attendance_date),
    fromStatus: str(row.from_status),
    toStatus: str(row.to_status),
    reason: strOrNull(row.reason),
    requesterId: str(row.requester_id),
    requesterRole: strOrNull(row.requester_role),
    status: str(row.status) as RequestStatus,
    decidedBy: strOrNull(row.decided_by),
    decidedAt: isoOrNull(row.decided_at),
    decisionNote: strOrNull(row.decision_note),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toLeave(row: Record<string, unknown>): LeaveRequestRecord {
  return {
    id: str(row.id),
    tenantId: str(row.tenant_id),
    studentId: str(row.student_id),
    institutionId: str(row.institution_id),
    classId: str(row.class_id),
    academicPeriodId: str(row.academic_period_id),
    fromDate: dateOnly(row.from_date),
    toDate: dateOnly(row.to_date),
    reason: strOrNull(row.reason),
    attachmentUrl: strOrNull(row.attachment_url),
    requesterId: str(row.requester_id),
    requesterRole: strOrNull(row.requester_role),
    status: str(row.status) as RequestStatus,
    decidedBy: strOrNull(row.decided_by),
    decidedAt: isoOrNull(row.decided_at),
    decisionNote: strOrNull(row.decision_note),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toDevice(row: Record<string, unknown>): DeviceKeyRecord {
  return {
    id: str(row.id),
    tenantId: str(row.tenant_id),
    institutionId: str(row.institution_id),
    deviceId: str(row.device_id),
    apiKeyHash: str(row.api_key_hash),
    label: strOrNull(row.label),
    status: str(row.status) as 'active' | 'revoked',
    createdAt: iso(row.created_at),
  };
}

function toIngest(row: Record<string, unknown>): IngestEventRecord {
  return {
    id: str(row.id),
    tenantId: str(row.tenant_id),
    institutionId: str(row.institution_id),
    deviceId: str(row.device_id),
    eventId: str(row.event_id),
    studentId: str(row.student_id),
    punchedAt: iso(row.punched_at),
    punchType: str(row.punch_type) as PunchType,
    attendanceId: strOrNull(row.attendance_id),
    duplicate: Boolean(row.duplicate),
    createdAt: iso(row.created_at),
  };
}

export class PgAttendanceOpsStore implements AttendanceOpsStore {
  constructor(private readonly pool: PgQueryable) {}

  private run<T>(tenantId: string, fn: (c: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool as never, tenantId, fn);
  }

  async createRegularisation(row: RegularisationRecord) {
    return this.run(row.tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO attendance_regularisation_requests
           (id, tenant_id, attendance_id, student_id, institution_id, class_id, attendance_date,
            from_status, to_status, reason, requester_id, requester_role, status, decided_by,
            decided_at, decision_note, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.attendanceId,
          row.studentId,
          row.institutionId,
          row.classId,
          row.attendanceDate,
          row.fromStatus,
          row.toStatus,
          row.reason,
          row.requesterId,
          row.requesterRole,
          row.status,
          row.decidedBy,
          row.decidedAt,
          row.decisionNote,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return toReg(rows[0] as Record<string, unknown>);
    });
  }

  async listRegularisations(tenantId: string, filter?: { status?: RequestStatus }) {
    return this.run(tenantId, async (c) => {
      const params: unknown[] = [tenantId];
      let sql = `SELECT * FROM attendance_regularisation_requests WHERE tenant_id = $1`;
      if (filter?.status) {
        params.push(filter.status);
        sql += ` AND status = $2`;
      }
      sql += ` ORDER BY created_at DESC`;
      const { rows } = await c.query(sql, params);
      return rows.map((r) => toReg(r as Record<string, unknown>));
    });
  }

  async getRegularisation(tenantId: string, id: string) {
    return this.run(tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM attendance_regularisation_requests WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id],
      );
      return rows[0] ? toReg(rows[0] as Record<string, unknown>) : null;
    });
  }

  async updateRegularisation(tenantId: string, id: string, patch: Partial<RegularisationRecord>) {
    const cur = await this.getRegularisation(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    return this.run(tenantId, async (c) => {
      const { rows } = await c.query(
        `UPDATE attendance_regularisation_requests SET
           status = $3, decided_by = $4, decided_at = $5, decision_note = $6, updated_at = $7
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [
          tenantId,
          id,
          next.status,
          next.decidedBy,
          next.decidedAt,
          next.decisionNote,
          next.updatedAt,
        ],
      );
      return rows[0] ? toReg(rows[0] as Record<string, unknown>) : null;
    });
  }

  async createLeave(row: LeaveRequestRecord) {
    return this.run(row.tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO attendance_leave_requests
           (id, tenant_id, student_id, institution_id, class_id, academic_period_id, from_date, to_date,
            reason, attachment_url, requester_id, requester_role, status, decided_by, decided_at,
            decision_note, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.studentId,
          row.institutionId,
          row.classId,
          row.academicPeriodId,
          row.fromDate,
          row.toDate,
          row.reason,
          row.attachmentUrl,
          row.requesterId,
          row.requesterRole,
          row.status,
          row.decidedBy,
          row.decidedAt,
          row.decisionNote,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return toLeave(rows[0] as Record<string, unknown>);
    });
  }

  async listLeaves(tenantId: string, filter?: { status?: RequestStatus }) {
    return this.run(tenantId, async (c) => {
      const params: unknown[] = [tenantId];
      let sql = `SELECT * FROM attendance_leave_requests WHERE tenant_id = $1`;
      if (filter?.status) {
        params.push(filter.status);
        sql += ` AND status = $2`;
      }
      sql += ` ORDER BY created_at DESC`;
      const { rows } = await c.query(sql, params);
      return rows.map((r) => toLeave(r as Record<string, unknown>));
    });
  }

  async getLeave(tenantId: string, id: string) {
    return this.run(tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM attendance_leave_requests WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id],
      );
      return rows[0] ? toLeave(rows[0] as Record<string, unknown>) : null;
    });
  }

  async updateLeave(tenantId: string, id: string, patch: Partial<LeaveRequestRecord>) {
    const cur = await this.getLeave(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    return this.run(tenantId, async (c) => {
      const { rows } = await c.query(
        `UPDATE attendance_leave_requests SET
           status = $3, decided_by = $4, decided_at = $5, decision_note = $6, updated_at = $7
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [
          tenantId,
          id,
          next.status,
          next.decidedBy,
          next.decidedAt,
          next.decisionNote,
          next.updatedAt,
        ],
      );
      return rows[0] ? toLeave(rows[0] as Record<string, unknown>) : null;
    });
  }

  async createDeviceKey(row: DeviceKeyRecord) {
    return this.run(row.tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO attendance_device_keys
           (id, tenant_id, institution_id, device_id, api_key_hash, label, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.institutionId,
          row.deviceId,
          row.apiKeyHash,
          row.label,
          row.status,
          row.createdAt,
        ],
      );
      return toDevice(rows[0] as Record<string, unknown>);
    });
  }

  async findDeviceKeyByHash(tenantId: string, apiKeyHash: string) {
    return this.run(tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM attendance_device_keys
          WHERE tenant_id = $1 AND api_key_hash = $2 AND status = 'active' LIMIT 1`,
        [tenantId, apiKeyHash],
      );
      return rows[0] ? toDevice(rows[0] as Record<string, unknown>) : null;
    });
  }

  async listDeviceKeys(tenantId: string, institutionId?: string) {
    return this.run(tenantId, async (c) => {
      const params: unknown[] = [tenantId];
      let sql = `SELECT * FROM attendance_device_keys WHERE tenant_id = $1`;
      if (institutionId) {
        params.push(institutionId);
        sql += ` AND institution_id = $2`;
      }
      const { rows } = await c.query(sql, params);
      return rows.map((r) => toDevice(r as Record<string, unknown>));
    });
  }

  async findIngestEvent(tenantId: string, deviceId: string, eventId: string) {
    return this.run(tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM attendance_ingest_events
          WHERE tenant_id = $1 AND device_id = $2 AND event_id = $3 LIMIT 1`,
        [tenantId, deviceId, eventId],
      );
      return rows[0] ? toIngest(rows[0] as Record<string, unknown>) : null;
    });
  }

  async createIngestEvent(row: IngestEventRecord) {
    return this.run(row.tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO attendance_ingest_events
           (id, tenant_id, institution_id, device_id, event_id, student_id, punched_at, punch_type,
            attendance_id, duplicate, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tenant_id, device_id, event_id) DO UPDATE SET duplicate = true
         RETURNING *`,
        [
          row.id,
          row.tenantId,
          row.institutionId,
          row.deviceId,
          row.eventId,
          row.studentId,
          row.punchedAt,
          row.punchType,
          row.attendanceId,
          row.duplicate,
          row.createdAt,
        ],
      );
      return toIngest(rows[0] as Record<string, unknown>);
    });
  }
}

export function newId(): string {
  return randomUUID();
}
