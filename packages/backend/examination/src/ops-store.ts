/**
 * G-908 — examination ops persistence: raw pg (db/sql/036, RLS via
 * withPgTenant) or an in-memory map for dev / unit tests.
 */
import { withPgTenant, type PgQueryable } from '@proctira/database';

export type ReevaluationStatus = 'requested' | 'assigned' | 'completed' | 'rejected';

export interface ExamSessionRecord {
  id: string;
  tenantId: string;
  examinationId: string;
  subjectId: string;
  date: string;
  startTime: string;
  endTime: string;
  roomId: string;
  centerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExamInvigilatorRecord {
  id: string;
  tenantId: string;
  sessionId: string;
  staffId: string;
  allocatedAt: Date;
  allocatedBy: string | null;
}

export interface ExamSeatingRecord {
  id: string;
  tenantId: string;
  examinationId: string;
  sessionId: string | null;
  candidateId: string;
  studentId: string | null;
  studentName: string;
  rollNumber: string;
  centerId: string;
  centerName: string;
  roomNumber: string;
  seatNumber: string;
  subjectNames: string[];
  generatedAt: Date;
}

export interface ExamMarksEntryRecord {
  id: string;
  tenantId: string;
  examinationId: string;
  candidateId: string;
  subjectId: string;
  entryNo: 1 | 2;
  marks: number;
  enteredBy: string;
  enteredAt: Date;
  varianceFlag: boolean;
  finalMarks: number | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
}

export interface ExamReevaluationRecord {
  id: string;
  tenantId: string;
  examinationId: string;
  candidateId: string;
  subjectId: string;
  status: ReevaluationStatus;
  requesterId: string;
  requesterRole: string | null;
  evaluatorId: string | null;
  originalMarks: number | null;
  revisedMarks: number | null;
  feeRequired: boolean;
  feeAmount: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExamOpsAuditRecord {
  id: string;
  tenantId: string;
  examinationId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  at: Date;
  details: Record<string, unknown>;
}

export interface ExamOpsStore {
  createSession(record: ExamSessionRecord): Promise<ExamSessionRecord>;
  listSessions(tenantId: string, examinationId: string): Promise<ExamSessionRecord[]>;
  findSession(tenantId: string, sessionId: string): Promise<ExamSessionRecord | null>;
  deleteSession(tenantId: string, sessionId: string): Promise<boolean>;

  createInvigilator(record: ExamInvigilatorRecord): Promise<ExamInvigilatorRecord>;
  listInvigilators(tenantId: string, sessionId: string): Promise<ExamInvigilatorRecord[]>;
  listInvigilatorsForExamination(
    tenantId: string,
    examinationId: string,
  ): Promise<ExamInvigilatorRecord[]>;
  findInvigilator(tenantId: string, allocationId: string): Promise<ExamInvigilatorRecord | null>;
  deleteInvigilator(tenantId: string, allocationId: string): Promise<boolean>;

  replaceSeating(
    tenantId: string,
    examinationId: string,
    seats: ExamSeatingRecord[],
  ): Promise<ExamSeatingRecord[]>;
  listSeating(tenantId: string, examinationId: string): Promise<ExamSeatingRecord[]>;

  createMarksEntry(record: ExamMarksEntryRecord): Promise<ExamMarksEntryRecord>;
  listMarksEntries(tenantId: string, examinationId: string): Promise<ExamMarksEntryRecord[]>;
  findMarksPair(
    tenantId: string,
    examinationId: string,
    candidateId: string,
    subjectId: string,
  ): Promise<ExamMarksEntryRecord[]>;
  updateMarksEntries(
    tenantId: string,
    ids: string[],
    patch: Partial<
      Pick<ExamMarksEntryRecord, 'varianceFlag' | 'finalMarks' | 'resolvedBy' | 'resolvedAt'>
    >,
  ): Promise<void>;

  createReevaluation(record: ExamReevaluationRecord): Promise<ExamReevaluationRecord>;
  listReevaluations(tenantId: string, examinationId: string): Promise<ExamReevaluationRecord[]>;
  findReevaluation(tenantId: string, requestId: string): Promise<ExamReevaluationRecord | null>;
  updateReevaluation(
    tenantId: string,
    requestId: string,
    patch: Partial<ExamReevaluationRecord>,
  ): Promise<ExamReevaluationRecord | null>;

  appendAudit(record: ExamOpsAuditRecord): Promise<ExamOpsAuditRecord>;
  listAudits(tenantId: string, examinationId: string): Promise<ExamOpsAuditRecord[]>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryExamOpsStore implements ExamOpsStore {
  private readonly sessions = new Map<string, ExamSessionRecord>();
  private readonly invigilators = new Map<string, ExamInvigilatorRecord>();
  private readonly seating = new Map<string, ExamSeatingRecord>();
  private readonly marks = new Map<string, ExamMarksEntryRecord>();
  private readonly reevaluations = new Map<string, ExamReevaluationRecord>();
  private readonly audits: ExamOpsAuditRecord[] = [];

  async createSession(record: ExamSessionRecord): Promise<ExamSessionRecord> {
    this.sessions.set(record.id, clone(record));
    return clone(record);
  }

  async listSessions(tenantId: string, examinationId: string): Promise<ExamSessionRecord[]> {
    return [...this.sessions.values()]
      .filter((row) => row.tenantId === tenantId && row.examinationId === examinationId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }

  async findSession(tenantId: string, sessionId: string): Promise<ExamSessionRecord | null> {
    const row = this.sessions.get(sessionId);
    return row && row.tenantId === tenantId ? clone(row) : null;
  }

  async deleteSession(tenantId: string, sessionId: string): Promise<boolean> {
    const row = this.sessions.get(sessionId);
    if (!row || row.tenantId !== tenantId) return false;
    this.sessions.delete(sessionId);
    for (const [id, inv] of this.invigilators) {
      if (inv.sessionId === sessionId && inv.tenantId === tenantId) this.invigilators.delete(id);
    }
    return true;
  }

  async createInvigilator(record: ExamInvigilatorRecord): Promise<ExamInvigilatorRecord> {
    this.invigilators.set(record.id, clone(record));
    return clone(record);
  }

  async listInvigilators(tenantId: string, sessionId: string): Promise<ExamInvigilatorRecord[]> {
    return [...this.invigilators.values()].filter(
      (row) => row.tenantId === tenantId && row.sessionId === sessionId,
    );
  }

  async listInvigilatorsForExamination(
    tenantId: string,
    examinationId: string,
  ): Promise<ExamInvigilatorRecord[]> {
    const sessionIds = new Set(
      [...this.sessions.values()]
        .filter((s) => s.tenantId === tenantId && s.examinationId === examinationId)
        .map((s) => s.id),
    );
    return [...this.invigilators.values()].filter(
      (row) => row.tenantId === tenantId && sessionIds.has(row.sessionId),
    );
  }

  async findInvigilator(
    tenantId: string,
    allocationId: string,
  ): Promise<ExamInvigilatorRecord | null> {
    const row = this.invigilators.get(allocationId);
    return row && row.tenantId === tenantId ? clone(row) : null;
  }

  async deleteInvigilator(tenantId: string, allocationId: string): Promise<boolean> {
    const row = this.invigilators.get(allocationId);
    if (!row || row.tenantId !== tenantId) return false;
    this.invigilators.delete(allocationId);
    return true;
  }

  async replaceSeating(
    tenantId: string,
    examinationId: string,
    seats: ExamSeatingRecord[],
  ): Promise<ExamSeatingRecord[]> {
    for (const [id, row] of this.seating) {
      if (row.tenantId === tenantId && row.examinationId === examinationId) {
        this.seating.delete(id);
      }
    }
    for (const seat of seats) {
      this.seating.set(seat.id, clone(seat));
    }
    return seats.map((s) => clone(s));
  }

  async listSeating(tenantId: string, examinationId: string): Promise<ExamSeatingRecord[]> {
    return [...this.seating.values()]
      .filter((row) => row.tenantId === tenantId && row.examinationId === examinationId)
      .sort(
        (a, b) =>
          a.centerName.localeCompare(b.centerName) ||
          a.roomNumber.localeCompare(b.roomNumber) ||
          a.seatNumber.localeCompare(b.seatNumber),
      );
  }

  async createMarksEntry(record: ExamMarksEntryRecord): Promise<ExamMarksEntryRecord> {
    this.marks.set(record.id, clone(record));
    return clone(record);
  }

  async listMarksEntries(tenantId: string, examinationId: string): Promise<ExamMarksEntryRecord[]> {
    return [...this.marks.values()].filter(
      (row) => row.tenantId === tenantId && row.examinationId === examinationId,
    );
  }

  async findMarksPair(
    tenantId: string,
    examinationId: string,
    candidateId: string,
    subjectId: string,
  ): Promise<ExamMarksEntryRecord[]> {
    return [...this.marks.values()]
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          row.examinationId === examinationId &&
          row.candidateId === candidateId &&
          row.subjectId === subjectId,
      )
      .sort((a, b) => a.entryNo - b.entryNo);
  }

  async updateMarksEntries(
    tenantId: string,
    ids: string[],
    patch: Partial<
      Pick<ExamMarksEntryRecord, 'varianceFlag' | 'finalMarks' | 'resolvedBy' | 'resolvedAt'>
    >,
  ): Promise<void> {
    for (const id of ids) {
      const row = this.marks.get(id);
      if (!row || row.tenantId !== tenantId) continue;
      this.marks.set(id, { ...row, ...patch });
    }
  }

  async createReevaluation(record: ExamReevaluationRecord): Promise<ExamReevaluationRecord> {
    this.reevaluations.set(record.id, clone(record));
    return clone(record);
  }

  async listReevaluations(
    tenantId: string,
    examinationId: string,
  ): Promise<ExamReevaluationRecord[]> {
    return [...this.reevaluations.values()]
      .filter((row) => row.tenantId === tenantId && row.examinationId === examinationId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findReevaluation(
    tenantId: string,
    requestId: string,
  ): Promise<ExamReevaluationRecord | null> {
    const row = this.reevaluations.get(requestId);
    return row && row.tenantId === tenantId ? clone(row) : null;
  }

  async updateReevaluation(
    tenantId: string,
    requestId: string,
    patch: Partial<ExamReevaluationRecord>,
  ): Promise<ExamReevaluationRecord | null> {
    const row = this.reevaluations.get(requestId);
    if (!row || row.tenantId !== tenantId) return null;
    const updated = { ...row, ...patch, updatedAt: new Date() };
    this.reevaluations.set(requestId, updated);
    return clone(updated);
  }

  async appendAudit(record: ExamOpsAuditRecord): Promise<ExamOpsAuditRecord> {
    this.audits.push(clone(record));
    return clone(record);
  }

  async listAudits(tenantId: string, examinationId: string): Promise<ExamOpsAuditRecord[]> {
    return this.audits.filter(
      (row) => row.tenantId === tenantId && row.examinationId === examinationId,
    );
  }
}

type SessionRow = {
  id: string;
  tenant_id: string;
  examination_id: string;
  subject_id: string;
  session_date: string | Date;
  start_time: string;
  end_time: string;
  room_id: string;
  center_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type InvigilatorRow = {
  id: string;
  tenant_id: string;
  session_id: string;
  staff_id: string;
  allocated_at: Date;
  allocated_by: string | null;
};

type SeatingRow = {
  id: string;
  tenant_id: string;
  examination_id: string;
  session_id: string | null;
  candidate_id: string;
  student_id: string | null;
  student_name: string;
  roll_number: string;
  center_id: string;
  center_name: string;
  room_number: string;
  seat_number: string;
  subject_names: string[] | null;
  generated_at: Date;
};

type MarksRow = {
  id: string;
  tenant_id: string;
  examination_id: string;
  candidate_id: string;
  subject_id: string;
  entry_no: number | string;
  marks: string | number;
  entered_by: string;
  entered_at: Date;
  variance_flag: boolean;
  final_marks: string | number | null;
  resolved_by: string | null;
  resolved_at: Date | null;
};

type ReevalRow = {
  id: string;
  tenant_id: string;
  examination_id: string;
  candidate_id: string;
  subject_id: string;
  status: string;
  requester_id: string;
  requester_role: string | null;
  evaluator_id: string | null;
  original_marks: string | number | null;
  revised_marks: string | number | null;
  fee_required: boolean;
  fee_amount: string | number | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

function isoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function isoTime(value: string): string {
  const raw = String(value);
  return raw.length >= 5 ? raw.slice(0, 5) : raw;
}

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toSession(row: SessionRow): ExamSessionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    examinationId: row.examination_id,
    subjectId: row.subject_id,
    date: isoDate(row.session_date),
    startTime: isoTime(row.start_time),
    endTime: isoTime(row.end_time),
    roomId: row.room_id,
    centerId: row.center_id,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
  };
}

function toInvigilator(row: InvigilatorRow): ExamInvigilatorRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sessionId: row.session_id,
    staffId: row.staff_id,
    allocatedAt: row.allocated_at instanceof Date ? row.allocated_at : new Date(row.allocated_at),
    allocatedBy: row.allocated_by,
  };
}

function toSeating(row: SeatingRow): ExamSeatingRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    examinationId: row.examination_id,
    sessionId: row.session_id,
    candidateId: row.candidate_id,
    studentId: row.student_id,
    studentName: row.student_name,
    rollNumber: row.roll_number,
    centerId: row.center_id,
    centerName: row.center_name,
    roomNumber: row.room_number,
    seatNumber: row.seat_number,
    subjectNames: row.subject_names ?? [],
    generatedAt: row.generated_at instanceof Date ? row.generated_at : new Date(row.generated_at),
  };
}

function toMarks(row: MarksRow): ExamMarksEntryRecord {
  const entryNo = Number(row.entry_no) === 2 ? 2 : 1;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    examinationId: row.examination_id,
    candidateId: row.candidate_id,
    subjectId: row.subject_id,
    entryNo,
    marks: num(row.marks) ?? 0,
    enteredBy: row.entered_by,
    enteredAt: row.entered_at instanceof Date ? row.entered_at : new Date(row.entered_at),
    varianceFlag: Boolean(row.variance_flag),
    finalMarks: num(row.final_marks),
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at
      ? row.resolved_at instanceof Date
        ? row.resolved_at
        : new Date(row.resolved_at)
      : null,
  };
}

function toReeval(row: ReevalRow): ExamReevaluationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    examinationId: row.examination_id,
    candidateId: row.candidate_id,
    subjectId: row.subject_id,
    status: row.status as ReevaluationStatus,
    requesterId: row.requester_id,
    requesterRole: row.requester_role,
    evaluatorId: row.evaluator_id,
    originalMarks: num(row.original_marks),
    revisedMarks: num(row.revised_marks),
    feeRequired: Boolean(row.fee_required),
    feeAmount: num(row.fee_amount),
    notes: row.notes,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
  };
}

export type ExamOpsPool = PgQueryable & { connect?: unknown };

export class PgExamOpsStore implements ExamOpsStore {
  constructor(private readonly pool: ExamOpsPool) {}

  private run<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool as never, tenantId, fn);
  }

  async createSession(record: ExamSessionRecord): Promise<ExamSessionRecord> {
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO exam_sessions
           (id, tenant_id, examination_id, subject_id, session_date, start_time, end_time, room_id, center_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5::date,$6::time,$7::time,$8,$9,$10,$11)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.examinationId,
          record.subjectId,
          record.date,
          record.startTime,
          record.endTime,
          record.roomId,
          record.centerId,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return toSession(rows[0] as SessionRow);
    });
  }

  async listSessions(tenantId: string, examinationId: string): Promise<ExamSessionRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM exam_sessions
          WHERE tenant_id = $1 AND examination_id = $2
          ORDER BY session_date ASC, start_time ASC`,
        [tenantId, examinationId],
      );
      return (rows as SessionRow[]).map(toSession);
    });
  }

  async findSession(tenantId: string, sessionId: string): Promise<ExamSessionRecord | null> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM exam_sessions WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, sessionId],
      );
      return rows[0] ? toSession(rows[0] as SessionRow) : null;
    });
  }

  async deleteSession(tenantId: string, sessionId: string): Promise<boolean> {
    return this.run(tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM exam_sessions WHERE tenant_id = $1 AND id = $2`,
        [tenantId, sessionId],
      );
      return Number((result as { rowCount?: number }).rowCount ?? 0) > 0;
    });
  }

  async createInvigilator(record: ExamInvigilatorRecord): Promise<ExamInvigilatorRecord> {
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO exam_invigilators
           (id, tenant_id, session_id, staff_id, allocated_at, allocated_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.sessionId,
          record.staffId,
          record.allocatedAt,
          record.allocatedBy,
        ],
      );
      return toInvigilator(rows[0] as InvigilatorRow);
    });
  }

  async listInvigilators(tenantId: string, sessionId: string): Promise<ExamInvigilatorRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM exam_invigilators WHERE tenant_id = $1 AND session_id = $2`,
        [tenantId, sessionId],
      );
      return (rows as InvigilatorRow[]).map(toInvigilator);
    });
  }

  async listInvigilatorsForExamination(
    tenantId: string,
    examinationId: string,
  ): Promise<ExamInvigilatorRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT i.* FROM exam_invigilators i
           JOIN exam_sessions s ON s.id = i.session_id
          WHERE i.tenant_id = $1 AND s.examination_id = $2`,
        [tenantId, examinationId],
      );
      return (rows as InvigilatorRow[]).map(toInvigilator);
    });
  }

  async findInvigilator(
    tenantId: string,
    allocationId: string,
  ): Promise<ExamInvigilatorRecord | null> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM exam_invigilators WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, allocationId],
      );
      return rows[0] ? toInvigilator(rows[0] as InvigilatorRow) : null;
    });
  }

  async deleteInvigilator(tenantId: string, allocationId: string): Promise<boolean> {
    return this.run(tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM exam_invigilators WHERE tenant_id = $1 AND id = $2`,
        [tenantId, allocationId],
      );
      return Number((result as { rowCount?: number }).rowCount ?? 0) > 0;
    });
  }

  async replaceSeating(
    tenantId: string,
    examinationId: string,
    seats: ExamSeatingRecord[],
  ): Promise<ExamSeatingRecord[]> {
    return this.run(tenantId, async (client) => {
      await client.query(
        `DELETE FROM exam_seating WHERE tenant_id = $1 AND examination_id = $2`,
        [tenantId, examinationId],
      );
      const saved: ExamSeatingRecord[] = [];
      for (const seat of seats) {
        const { rows } = await client.query(
          `INSERT INTO exam_seating
             (id, tenant_id, examination_id, session_id, candidate_id, student_id, student_name,
              roll_number, center_id, center_name, room_number, seat_number, subject_names, generated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING *`,
          [
            seat.id,
            seat.tenantId,
            seat.examinationId,
            seat.sessionId,
            seat.candidateId,
            seat.studentId,
            seat.studentName,
            seat.rollNumber,
            seat.centerId,
            seat.centerName,
            seat.roomNumber,
            seat.seatNumber,
            seat.subjectNames,
            seat.generatedAt,
          ],
        );
        saved.push(toSeating(rows[0] as SeatingRow));
      }
      return saved;
    });
  }

  async listSeating(tenantId: string, examinationId: string): Promise<ExamSeatingRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM exam_seating
          WHERE tenant_id = $1 AND examination_id = $2
          ORDER BY center_name ASC, room_number ASC, seat_number ASC`,
        [tenantId, examinationId],
      );
      return (rows as SeatingRow[]).map(toSeating);
    });
  }

  async createMarksEntry(record: ExamMarksEntryRecord): Promise<ExamMarksEntryRecord> {
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO exam_marks_entries
           (id, tenant_id, examination_id, candidate_id, subject_id, entry_no, marks, entered_by,
            entered_at, variance_flag, final_marks, resolved_by, resolved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.examinationId,
          record.candidateId,
          record.subjectId,
          record.entryNo,
          record.marks,
          record.enteredBy,
          record.enteredAt,
          record.varianceFlag,
          record.finalMarks,
          record.resolvedBy,
          record.resolvedAt,
        ],
      );
      return toMarks(rows[0] as MarksRow);
    });
  }

  async listMarksEntries(tenantId: string, examinationId: string): Promise<ExamMarksEntryRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM exam_marks_entries WHERE tenant_id = $1 AND examination_id = $2`,
        [tenantId, examinationId],
      );
      return (rows as MarksRow[]).map(toMarks);
    });
  }

  async findMarksPair(
    tenantId: string,
    examinationId: string,
    candidateId: string,
    subjectId: string,
  ): Promise<ExamMarksEntryRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM exam_marks_entries
          WHERE tenant_id = $1 AND examination_id = $2 AND candidate_id = $3 AND subject_id = $4
          ORDER BY entry_no ASC`,
        [tenantId, examinationId, candidateId, subjectId],
      );
      return (rows as MarksRow[]).map(toMarks);
    });
  }

  async updateMarksEntries(
    tenantId: string,
    ids: string[],
    patch: Partial<
      Pick<ExamMarksEntryRecord, 'varianceFlag' | 'finalMarks' | 'resolvedBy' | 'resolvedAt'>
    >,
  ): Promise<void> {
    if (ids.length === 0) return;
    return this.run(tenantId, async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (patch.varianceFlag !== undefined) {
        sets.push(`variance_flag = $${i++}`);
        values.push(patch.varianceFlag);
      }
      if (patch.finalMarks !== undefined) {
        sets.push(`final_marks = $${i++}`);
        values.push(patch.finalMarks);
      }
      if (patch.resolvedBy !== undefined) {
        sets.push(`resolved_by = $${i++}`);
        values.push(patch.resolvedBy);
      }
      if (patch.resolvedAt !== undefined) {
        sets.push(`resolved_at = $${i++}`);
        values.push(patch.resolvedAt);
      }
      if (sets.length === 0) return;
      values.push(tenantId, ids);
      await client.query(
        `UPDATE exam_marks_entries SET ${sets.join(', ')}
          WHERE tenant_id = $${i++} AND id = ANY($${i}::uuid[])`,
        values,
      );
    });
  }

  async createReevaluation(record: ExamReevaluationRecord): Promise<ExamReevaluationRecord> {
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO exam_reevaluation_requests
           (id, tenant_id, examination_id, candidate_id, subject_id, status, requester_id,
            requester_role, evaluator_id, original_marks, revised_marks, fee_required, fee_amount,
            notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.examinationId,
          record.candidateId,
          record.subjectId,
          record.status,
          record.requesterId,
          record.requesterRole,
          record.evaluatorId,
          record.originalMarks,
          record.revisedMarks,
          record.feeRequired,
          record.feeAmount,
          record.notes,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return toReeval(rows[0] as ReevalRow);
    });
  }

  async listReevaluations(
    tenantId: string,
    examinationId: string,
  ): Promise<ExamReevaluationRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM exam_reevaluation_requests
          WHERE tenant_id = $1 AND examination_id = $2
          ORDER BY created_at ASC`,
        [tenantId, examinationId],
      );
      return (rows as ReevalRow[]).map(toReeval);
    });
  }

  async findReevaluation(
    tenantId: string,
    requestId: string,
  ): Promise<ExamReevaluationRecord | null> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM exam_reevaluation_requests WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, requestId],
      );
      return rows[0] ? toReeval(rows[0] as ReevalRow) : null;
    });
  }

  async updateReevaluation(
    tenantId: string,
    requestId: string,
    patch: Partial<ExamReevaluationRecord>,
  ): Promise<ExamReevaluationRecord | null> {
    return this.run(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT * FROM exam_reevaluation_requests WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, requestId],
      );
      if (!existing.rows[0]) return null;
      const current = toReeval(existing.rows[0] as ReevalRow);
      const next: ExamReevaluationRecord = {
        ...current,
        ...patch,
        updatedAt: new Date(),
      };
      const { rows } = await client.query(
        `UPDATE exam_reevaluation_requests SET
           status = $3, evaluator_id = $4, original_marks = $5, revised_marks = $6,
           notes = $7, updated_at = $8
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          tenantId,
          requestId,
          next.status,
          next.evaluatorId,
          next.originalMarks,
          next.revisedMarks,
          next.notes,
          next.updatedAt,
        ],
      );
      return rows[0] ? toReeval(rows[0] as ReevalRow) : null;
    });
  }

  async appendAudit(record: ExamOpsAuditRecord): Promise<ExamOpsAuditRecord> {
    return record;
  }

  async listAudits(_tenantId: string, _examinationId: string): Promise<ExamOpsAuditRecord[]> {
    return [];
  }
}
