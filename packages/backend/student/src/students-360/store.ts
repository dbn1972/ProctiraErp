/**
 * G-914 — photo / sibling / consent / discipline persistence.
 * Raw pg (db/sql/035, RLS via withPgTenant) or an in-memory map for tests.
 */
import { ConflictError } from '@proctira/common';
import { withPgTenant, type PgQueryable } from '@proctira/database';

import type { ConsentKind, DisciplineSeverity, DocumentCategory } from './schemas.js';

export interface PhotoRecord {
  id: string;
  tenantId: string;
  studentId: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: Date;
}

export interface SiblingRecord {
  id: string;
  tenantId: string;
  studentId: string;
  siblingId: string;
  createdAt: Date;
}

/** PRC-L368: bounded page request / result for per-student lists. */
export interface ListPage {
  limit: number;
  offset: number;
}
/** PRC-C011: portal readers only see incidents marked visibleToParent. */
export interface DisciplineListOptions {
  visibleToParentOnly?: boolean;
}
export interface ListPageResult<T> {
  data: T[];
  total: number;
}
const DEFAULT_LIST_PAGE: ListPage = { limit: 50, offset: 0 };

function pageOf<T>(rows: T[], page: ListPage): ListPageResult<T> {
  return { data: rows.slice(page.offset, page.offset + page.limit), total: rows.length };
}

export interface ConsentRecord {
  id: string;
  tenantId: string;
  studentId: string;
  kind: ConsentKind;
  granted: boolean;
  actorId: string;
  recordedAt: Date;
  /** W1-PRIV-01 append-only version within (tenant, student, kind). */
  version: number;
  supersedesId: string | null;
  validFrom: Date;
  validTo: Date | null;
}

export interface DisciplineRecord {
  id: string;
  tenantId: string;
  studentId: string;
  incidentType: string;
  severity: DisciplineSeverity;
  description: string;
  actionTaken: string | null;
  reporterId: string;
  incidentDate: string;
  visibleToParent: boolean;
  createdAt: Date;
}

/** W2-SIS-03 — registered student document metadata (blob bytes in StudentBlobStore). */
export interface DocumentRecord {
  id: string;
  tenantId: string;
  studentId: string;
  category: DocumentCategory;
  fileName: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: Date;
}

export interface Students360Store {
  upsertPhoto(record: PhotoRecord): Promise<PhotoRecord>;
  getPhoto(tenantId: string, studentId: string): Promise<PhotoRecord | null>;

  listSiblings(tenantId: string, studentId: string): Promise<SiblingRecord[]>;
  findSiblingLink(
    tenantId: string,
    studentId: string,
    siblingId: string,
  ): Promise<SiblingRecord | null>;
  createSiblingPair(forward: SiblingRecord, reverse: SiblingRecord): Promise<SiblingRecord>;
  deleteSiblingPair(tenantId: string, studentId: string, siblingId: string): Promise<boolean>;

  listConsents(tenantId: string, studentId: string): Promise<ConsentRecord[]>;
  /** Append a new open version; closes any prior open row for the same kind. */
  appendConsent(record: ConsentRecord): Promise<ConsentRecord>;
  listConsentHistory(
    tenantId: string,
    studentId: string,
    kind?: ConsentKind,
  ): Promise<ConsentRecord[]>;
  /** @deprecated Use appendConsent — kept name alias for call-site clarity. */
  upsertConsent(record: ConsentRecord): Promise<ConsentRecord>;

  listDiscipline(
    tenantId: string,
    studentId: string,
    page?: ListPage,
    options?: DisciplineListOptions,
  ): Promise<ListPageResult<DisciplineRecord>>;
  createDiscipline(record: DisciplineRecord): Promise<DisciplineRecord>;
  findDiscipline(
    tenantId: string,
    studentId: string,
    incidentId: string,
  ): Promise<DisciplineRecord | null>;
  deleteDiscipline(tenantId: string, studentId: string, incidentId: string): Promise<boolean>;

  createDocument(record: DocumentRecord): Promise<DocumentRecord>;
  listDocuments(
    tenantId: string,
    studentId: string,
    page?: ListPage,
  ): Promise<ListPageResult<DocumentRecord>>;
  findDocument(
    tenantId: string,
    studentId: string,
    documentId: string,
  ): Promise<DocumentRecord | null>;
  deleteDocument(tenantId: string, studentId: string, documentId: string): Promise<boolean>;
}

export class InMemoryStudents360Store implements Students360Store {
  private readonly photos = new Map<string, PhotoRecord>();
  private readonly siblings = new Map<string, SiblingRecord>();
  private readonly consents = new Map<string, ConsentRecord>();
  private readonly discipline = new Map<string, DisciplineRecord>();
  private readonly documents = new Map<string, DocumentRecord>();

  private photoKey(tenantId: string, studentId: string): string {
    return `${tenantId}:${studentId}`;
  }

  async upsertPhoto(record: PhotoRecord): Promise<PhotoRecord> {
    const copy = { ...record };
    this.photos.set(this.photoKey(record.tenantId, record.studentId), copy);
    return { ...copy };
  }

  async getPhoto(tenantId: string, studentId: string): Promise<PhotoRecord | null> {
    const row = this.photos.get(this.photoKey(tenantId, studentId));
    return row ? { ...row } : null;
  }

  async listSiblings(tenantId: string, studentId: string): Promise<SiblingRecord[]> {
    return Array.from(this.siblings.values())
      .filter((r) => r.tenantId === tenantId && r.studentId === studentId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findSiblingLink(
    tenantId: string,
    studentId: string,
    siblingId: string,
  ): Promise<SiblingRecord | null> {
    const row = Array.from(this.siblings.values()).find(
      (r) => r.tenantId === tenantId && r.studentId === studentId && r.siblingId === siblingId,
    );
    return row ? { ...row } : null;
  }

  async createSiblingPair(forward: SiblingRecord, reverse: SiblingRecord): Promise<SiblingRecord> {
    const duplicate = Array.from(this.siblings.values()).some(
      (r) =>
        r.tenantId === forward.tenantId &&
        r.studentId === forward.studentId &&
        r.siblingId === forward.siblingId,
    );
    if (duplicate) throw new ConflictError('Sibling link already exists');
    this.siblings.set(forward.id, { ...forward });
    this.siblings.set(reverse.id, { ...reverse });
    return { ...forward };
  }

  async deleteSiblingPair(
    tenantId: string,
    studentId: string,
    siblingId: string,
  ): Promise<boolean> {
    let removed = false;
    for (const [id, row] of this.siblings) {
      const match =
        row.tenantId === tenantId &&
        ((row.studentId === studentId && row.siblingId === siblingId) ||
          (row.studentId === siblingId && row.siblingId === studentId));
      if (match) {
        this.siblings.delete(id);
        removed = true;
      }
    }
    return removed;
  }

  async listConsents(tenantId: string, studentId: string): Promise<ConsentRecord[]> {
    return Array.from(this.consents.values())
      .filter((r) => r.tenantId === tenantId && r.studentId === studentId && r.validTo == null)
      .sort((a, b) => a.kind.localeCompare(b.kind));
  }

  async listConsentHistory(
    tenantId: string,
    studentId: string,
    kind?: ConsentKind,
  ): Promise<ConsentRecord[]> {
    return Array.from(this.consents.values())
      .filter(
        (r) =>
          r.tenantId === tenantId && r.studentId === studentId && (kind == null || r.kind === kind),
      )
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.version - b.version)
      .map((r) => ({ ...r }));
  }

  async appendConsent(record: ConsentRecord): Promise<ConsentRecord> {
    const open = Array.from(this.consents.values()).find(
      (r) =>
        r.tenantId === record.tenantId &&
        r.studentId === record.studentId &&
        r.kind === record.kind &&
        r.validTo == null,
    );
    const version = open ? open.version + 1 : 1;
    const at = record.recordedAt;
    if (open) {
      this.consents.set(open.id, { ...open, validTo: at });
    }
    const stored: ConsentRecord = {
      ...record,
      version,
      supersedesId: open?.id ?? null,
      validFrom: at,
      validTo: null,
    };
    this.consents.set(stored.id, stored);
    return { ...stored };
  }

  async upsertConsent(record: ConsentRecord): Promise<ConsentRecord> {
    return this.appendConsent(record);
  }

  async listDiscipline(
    tenantId: string,
    studentId: string,
    page: ListPage = DEFAULT_LIST_PAGE,
    options: DisciplineListOptions = {},
  ): Promise<ListPageResult<DisciplineRecord>> {
    const rows = Array.from(this.discipline.values())
      .filter(
        (r) =>
          r.tenantId === tenantId &&
          r.studentId === studentId &&
          (!options.visibleToParentOnly || r.visibleToParent),
      )
      .sort(
        (a, b) =>
          b.incidentDate.localeCompare(a.incidentDate) ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
    return pageOf(rows, page);
  }

  async createDiscipline(record: DisciplineRecord): Promise<DisciplineRecord> {
    this.discipline.set(record.id, { ...record });
    return { ...record };
  }

  async findDiscipline(
    tenantId: string,
    studentId: string,
    incidentId: string,
  ): Promise<DisciplineRecord | null> {
    const row = this.discipline.get(incidentId);
    return row && row.tenantId === tenantId && row.studentId === studentId ? { ...row } : null;
  }

  async deleteDiscipline(
    tenantId: string,
    studentId: string,
    incidentId: string,
  ): Promise<boolean> {
    const row = this.discipline.get(incidentId);
    if (!row || row.tenantId !== tenantId || row.studentId !== studentId) return false;
    this.discipline.delete(incidentId);
    return true;
  }

  async createDocument(record: DocumentRecord): Promise<DocumentRecord> {
    const copy = { ...record };
    this.documents.set(record.id, copy);
    return { ...copy };
  }

  async listDocuments(
    tenantId: string,
    studentId: string,
    page: ListPage = DEFAULT_LIST_PAGE,
  ): Promise<ListPageResult<DocumentRecord>> {
    const rows = Array.from(this.documents.values())
      .filter((row) => row.tenantId === tenantId && row.studentId === studentId)
      .map((row) => ({ ...row }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return pageOf(rows, page);
  }

  async findDocument(
    tenantId: string,
    studentId: string,
    documentId: string,
  ): Promise<DocumentRecord | null> {
    const row = this.documents.get(documentId);
    return row && row.tenantId === tenantId && row.studentId === studentId ? { ...row } : null;
  }

  async deleteDocument(tenantId: string, studentId: string, documentId: string): Promise<boolean> {
    const row = this.documents.get(documentId);
    if (!row || row.tenantId !== tenantId || row.studentId !== studentId) return false;
    this.documents.delete(documentId);
    return true;
  }
}

function isoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

type PhotoRow = {
  id: string;
  tenant_id: string;
  student_id: string;
  object_key: string;
  mime_type: string;
  size_bytes: number | string;
  uploaded_by: string;
  created_at: Date;
};

function toPhoto(row: PhotoRow): PhotoRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    studentId: row.student_id,
    objectKey: row.object_key,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  };
}

type SiblingRow = {
  id: string;
  tenant_id: string;
  student_id: string;
  sibling_id: string;
  created_at: Date;
};

function toSibling(row: SiblingRow): SiblingRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    studentId: row.student_id,
    siblingId: row.sibling_id,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  };
}

type ConsentRow = {
  id: string;
  tenant_id: string;
  student_id: string;
  kind: string;
  granted: boolean;
  actor_id: string;
  recorded_at: Date;
  version?: number;
  supersedes_id?: string | null;
  valid_from?: Date;
  valid_to?: Date | null;
};

function toConsent(row: ConsentRow): ConsentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    studentId: row.student_id,
    kind: row.kind as ConsentKind,
    granted: Boolean(row.granted),
    actorId: row.actor_id,
    recordedAt: row.recorded_at instanceof Date ? row.recorded_at : new Date(row.recorded_at),
    version: Number(row.version ?? 1),
    supersedesId: row.supersedes_id == null ? null : String(row.supersedes_id),
    validFrom:
      row.valid_from instanceof Date ? row.valid_from : new Date(row.valid_from ?? row.recorded_at),
    validTo:
      row.valid_to == null
        ? null
        : row.valid_to instanceof Date
          ? row.valid_to
          : new Date(row.valid_to),
  };
}

type DisciplineRow = {
  id: string;
  tenant_id: string;
  student_id: string;
  incident_type: string;
  severity: string;
  description: string;
  action_taken: string | null;
  reporter_id: string;
  incident_date: string | Date;
  visible_to_parent: boolean;
  created_at: Date;
};

function toDiscipline(row: DisciplineRow): DisciplineRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    studentId: row.student_id,
    incidentType: row.incident_type,
    severity: row.severity as DisciplineSeverity,
    description: row.description,
    actionTaken: row.action_taken,
    reporterId: row.reporter_id,
    incidentDate: isoDate(row.incident_date),
    visibleToParent: Boolean(row.visible_to_parent),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  };
}

type DocumentRow = {
  id: string;
  tenant_id: string;
  student_id: string;
  category: string;
  file_name: string;
  object_key: string;
  mime_type: string;
  size_bytes: number | string;
  uploaded_by: string;
  created_at: Date;
};

function toDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    studentId: row.student_id,
    category: row.category as DocumentCategory,
    fileName: row.file_name,
    objectKey: row.object_key,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  };
}

export type Students360Pool = PgQueryable & { connect?: unknown };

export class PgStudents360Store implements Students360Store {
  constructor(private readonly pool: Students360Pool) {}

  private run<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool as never, tenantId, fn);
  }

  /**
   * PRC-L368: total from the window count; when the page is past the end (no
   * rows) fall back to an explicit COUNT so `total` stays accurate.
   */
  private async totalOf(
    client: PgQueryable,
    rows: unknown[],
    page: ListPage,
    table: 'student_documents' | 'student_discipline_incidents',
    params: [string, string],
  ): Promise<number> {
    const first = rows[0] as { total_count?: unknown } | undefined;
    if (first?.total_count != null) return Number(first.total_count);
    if (page.offset === 0) return 0;
    const { rows: c } = await client.query(
      `SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1 AND student_id = $2`,
      params,
    );
    return Number((c[0] as { n?: unknown } | undefined)?.n ?? 0);
  }

  /** PRC-L162: run, mapping a unique violation (lost race) to 409 instead of 500. */
  private async runUnique<T>(
    tenantId: string,
    conflictMessage: string,
    fn: (client: PgQueryable) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.run(tenantId, fn);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictError(conflictMessage);
      }
      throw err;
    }
  }

  async upsertPhoto(record: PhotoRecord): Promise<PhotoRecord> {
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO student_photos
           (id, tenant_id, student_id, object_key, mime_type, size_bytes, uploaded_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, student_id) DO UPDATE SET
           id = EXCLUDED.id,
           object_key = EXCLUDED.object_key,
           mime_type = EXCLUDED.mime_type,
           size_bytes = EXCLUDED.size_bytes,
           uploaded_by = EXCLUDED.uploaded_by,
           created_at = EXCLUDED.created_at
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.studentId,
          record.objectKey,
          record.mimeType,
          record.sizeBytes,
          record.uploadedBy,
          record.createdAt,
        ],
      );
      return toPhoto(rows[0] as PhotoRow);
    });
  }

  async getPhoto(tenantId: string, studentId: string): Promise<PhotoRecord | null> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM student_photos WHERE tenant_id = $1 AND student_id = $2 LIMIT 1`,
        [tenantId, studentId],
      );
      return rows[0] ? toPhoto(rows[0] as PhotoRow) : null;
    });
  }

  async listSiblings(tenantId: string, studentId: string): Promise<SiblingRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM student_siblings WHERE tenant_id = $1 AND student_id = $2 ORDER BY created_at ASC`,
        [tenantId, studentId],
      );
      return (rows as SiblingRow[]).map(toSibling);
    });
  }

  async findSiblingLink(
    tenantId: string,
    studentId: string,
    siblingId: string,
  ): Promise<SiblingRecord | null> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM student_siblings
          WHERE tenant_id = $1 AND student_id = $2 AND sibling_id = $3 LIMIT 1`,
        [tenantId, studentId, siblingId],
      );
      return rows[0] ? toSibling(rows[0] as SiblingRow) : null;
    });
  }

  async createSiblingPair(forward: SiblingRecord, reverse: SiblingRecord): Promise<SiblingRecord> {
    return this.runUnique(forward.tenantId, 'Sibling link already exists', async (client) => {
      await client.query(
        `INSERT INTO student_siblings (id, tenant_id, student_id, sibling_id, created_at)
         VALUES ($1,$2,$3,$4,$5), ($6,$7,$8,$9,$10)`,
        [
          forward.id,
          forward.tenantId,
          forward.studentId,
          forward.siblingId,
          forward.createdAt,
          reverse.id,
          reverse.tenantId,
          reverse.studentId,
          reverse.siblingId,
          reverse.createdAt,
        ],
      );
      return { ...forward };
    });
  }

  async deleteSiblingPair(
    tenantId: string,
    studentId: string,
    siblingId: string,
  ): Promise<boolean> {
    return this.run(tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM student_siblings
          WHERE tenant_id = $1
            AND ((student_id = $2 AND sibling_id = $3) OR (student_id = $3 AND sibling_id = $2))`,
        [tenantId, studentId, siblingId],
      );
      return Number((result as { rowCount?: number }).rowCount ?? 0) > 0;
    });
  }

  async listConsents(tenantId: string, studentId: string): Promise<ConsentRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM student_consents
          WHERE tenant_id = $1 AND student_id = $2 AND valid_to IS NULL
          ORDER BY kind ASC`,
        [tenantId, studentId],
      );
      return (rows as ConsentRow[]).map(toConsent);
    });
  }

  async listConsentHistory(
    tenantId: string,
    studentId: string,
    kind?: ConsentKind,
  ): Promise<ConsentRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } =
        kind == null
          ? await client.query(
              `SELECT * FROM student_consents
                WHERE tenant_id = $1 AND student_id = $2
                ORDER BY kind ASC, version ASC`,
              [tenantId, studentId],
            )
          : await client.query(
              `SELECT * FROM student_consents
                WHERE tenant_id = $1 AND student_id = $2 AND kind = $3
                ORDER BY version ASC`,
              [tenantId, studentId, kind],
            );
      return (rows as ConsentRow[]).map(toConsent);
    });
  }

  async appendConsent(record: ConsentRecord): Promise<ConsentRecord> {
    const conflict = 'Consent was updated concurrently; reload and retry';
    return this.runUnique(record.tenantId, conflict, async (client) => {
      // PRC-L162: serialise appends per (tenant, student, kind) — FOR UPDATE alone
      // cannot lock a row that does not exist yet (first version race).
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `student_consent:${record.tenantId}:${record.studentId}:${record.kind}`,
      ]);
      const prior = await client.query(
        `SELECT * FROM student_consents
          WHERE tenant_id = $1 AND student_id = $2 AND kind = $3 AND valid_to IS NULL
          LIMIT 1
          FOR UPDATE`,
        [record.tenantId, record.studentId, record.kind],
      );
      const open = prior.rows[0] as ConsentRow | undefined;
      const version = open ? Number(open.version ?? 1) + 1 : 1;
      const supersedesId = open ? String(open.id) : null;
      if (open) {
        await client.query(
          `UPDATE student_consents SET valid_to = $1 WHERE id = $2 AND tenant_id = $3`,
          [record.recordedAt, open.id, record.tenantId],
        );
      }
      const { rows } = await client.query(
        `INSERT INTO student_consents
           (id, tenant_id, student_id, kind, granted, actor_id, recorded_at,
            version, supersedes_id, valid_from, valid_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.studentId,
          record.kind,
          record.granted,
          record.actorId,
          record.recordedAt,
          version,
          supersedesId,
          record.recordedAt,
        ],
      );
      return toConsent(rows[0] as ConsentRow);
    });
  }

  async upsertConsent(record: ConsentRecord): Promise<ConsentRecord> {
    return this.appendConsent(record);
  }

  async listDiscipline(
    tenantId: string,
    studentId: string,
    page: ListPage = DEFAULT_LIST_PAGE,
    options: DisciplineListOptions = {},
  ): Promise<ListPageResult<DisciplineRecord>> {
    // PRC-C011: the visibility predicate applies to both the page and its total.
    const visibleOnly = options.visibleToParentOnly === true;
    const where = `tenant_id = $1 AND student_id = $2${
      visibleOnly ? ' AND visible_to_parent = true' : ''
    }`;
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT *, COUNT(*) OVER() AS total_count FROM student_discipline_incidents
          WHERE ${where}
          ORDER BY incident_date DESC, created_at DESC
          LIMIT $3 OFFSET $4`,
        [tenantId, studentId, page.limit, page.offset],
      );
      let total: number;
      const first = rows[0] as { total_count?: unknown } | undefined;
      if (first?.total_count != null) {
        total = Number(first.total_count);
      } else if (page.offset === 0) {
        total = 0;
      } else {
        const { rows: c } = await client.query(
          `SELECT COUNT(*)::int AS n FROM student_discipline_incidents WHERE ${where}`,
          [tenantId, studentId],
        );
        total = Number((c[0] as { n?: unknown } | undefined)?.n ?? 0);
      }
      return { data: (rows as DisciplineRow[]).map(toDiscipline), total };
    });
  }

  async createDiscipline(record: DisciplineRecord): Promise<DisciplineRecord> {
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO student_discipline_incidents
           (id, tenant_id, student_id, incident_type, severity, description, action_taken,
            reporter_id, incident_date, visible_to_parent, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.studentId,
          record.incidentType,
          record.severity,
          record.description,
          record.actionTaken,
          record.reporterId,
          record.incidentDate,
          record.visibleToParent,
          record.createdAt,
        ],
      );
      return toDiscipline(rows[0] as DisciplineRow);
    });
  }

  async findDiscipline(
    tenantId: string,
    studentId: string,
    incidentId: string,
  ): Promise<DisciplineRecord | null> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM student_discipline_incidents
          WHERE tenant_id = $1 AND student_id = $2 AND id = $3 LIMIT 1`,
        [tenantId, studentId, incidentId],
      );
      return rows[0] ? toDiscipline(rows[0] as DisciplineRow) : null;
    });
  }

  async deleteDiscipline(
    tenantId: string,
    studentId: string,
    incidentId: string,
  ): Promise<boolean> {
    return this.run(tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM student_discipline_incidents
          WHERE tenant_id = $1 AND student_id = $2 AND id = $3`,
        [tenantId, studentId, incidentId],
      );
      return Number((result as { rowCount?: number }).rowCount ?? 0) > 0;
    });
  }

  async createDocument(record: DocumentRecord): Promise<DocumentRecord> {
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO student_documents
           (id, tenant_id, student_id, category, file_name, object_key, mime_type,
            size_bytes, uploaded_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.studentId,
          record.category,
          record.fileName,
          record.objectKey,
          record.mimeType,
          record.sizeBytes,
          record.uploadedBy,
          record.createdAt,
        ],
      );
      return toDocument(rows[0] as DocumentRow);
    });
  }

  async listDocuments(
    tenantId: string,
    studentId: string,
    page: ListPage = DEFAULT_LIST_PAGE,
  ): Promise<ListPageResult<DocumentRecord>> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT *, COUNT(*) OVER() AS total_count FROM student_documents
          WHERE tenant_id = $1 AND student_id = $2
          ORDER BY created_at DESC
          LIMIT $3 OFFSET $4`,
        [tenantId, studentId, page.limit, page.offset],
      );
      return {
        data: (rows as DocumentRow[]).map(toDocument),
        total: await this.totalOf(client, rows, page, 'student_documents', [tenantId, studentId]),
      };
    });
  }

  async findDocument(
    tenantId: string,
    studentId: string,
    documentId: string,
  ): Promise<DocumentRecord | null> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM student_documents
          WHERE tenant_id = $1 AND student_id = $2 AND id = $3 LIMIT 1`,
        [tenantId, studentId, documentId],
      );
      return rows[0] ? toDocument(rows[0] as DocumentRow) : null;
    });
  }

  async deleteDocument(tenantId: string, studentId: string, documentId: string): Promise<boolean> {
    return this.run(tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM student_documents
          WHERE tenant_id = $1 AND student_id = $2 AND id = $3`,
        [tenantId, studentId, documentId],
      );
      return Number((result as { rowCount?: number }).rowCount ?? 0) > 0;
    });
  }
}
