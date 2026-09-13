/**
 * G-914 — photo / sibling / consent / discipline persistence.
 * Raw pg (db/sql/035, RLS via withPgTenant) or an in-memory map for tests.
 */
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

export interface ConsentRecord {
  id: string;
  tenantId: string;
  studentId: string;
  kind: ConsentKind;
  granted: boolean;
  actorId: string;
  recordedAt: Date;
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
  upsertConsent(record: ConsentRecord): Promise<ConsentRecord>;

  listDiscipline(tenantId: string, studentId: string): Promise<DisciplineRecord[]>;
  createDiscipline(record: DisciplineRecord): Promise<DisciplineRecord>;
  findDiscipline(
    tenantId: string,
    studentId: string,
    incidentId: string,
  ): Promise<DisciplineRecord | null>;
  deleteDiscipline(tenantId: string, studentId: string, incidentId: string): Promise<boolean>;

  createDocument(record: DocumentRecord): Promise<DocumentRecord>;
  listDocuments(tenantId: string, studentId: string): Promise<DocumentRecord[]>;
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
      .filter((r) => r.tenantId === tenantId && r.studentId === studentId)
      .sort((a, b) => a.kind.localeCompare(b.kind));
  }

  async upsertConsent(record: ConsentRecord): Promise<ConsentRecord> {
    const existing = Array.from(this.consents.values()).find(
      (r) =>
        r.tenantId === record.tenantId &&
        r.studentId === record.studentId &&
        r.kind === record.kind,
    );
    const stored: ConsentRecord = existing ? { ...record, id: existing.id } : { ...record };
    if (existing) this.consents.delete(existing.id);
    this.consents.set(stored.id, stored);
    return { ...stored };
  }

  async listDiscipline(tenantId: string, studentId: string): Promise<DisciplineRecord[]> {
    return Array.from(this.discipline.values())
      .filter((r) => r.tenantId === tenantId && r.studentId === studentId)
      .sort(
        (a, b) =>
          b.incidentDate.localeCompare(a.incidentDate) ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
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

  async listDocuments(tenantId: string, studentId: string): Promise<DocumentRecord[]> {
    return Array.from(this.documents.values())
      .filter((row) => row.tenantId === tenantId && row.studentId === studentId)
      .map((row) => ({ ...row }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findDocument(
    tenantId: string,
    studentId: string,
    documentId: string,
  ): Promise<DocumentRecord | null> {
    const row = this.documents.get(documentId);
    return row && row.tenantId === tenantId && row.studentId === studentId ? { ...row } : null;
  }

  async deleteDocument(
    tenantId: string,
    studentId: string,
    documentId: string,
  ): Promise<boolean> {
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
    return this.run(forward.tenantId, async (client) => {
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
        `SELECT * FROM student_consents WHERE tenant_id = $1 AND student_id = $2 ORDER BY kind ASC`,
        [tenantId, studentId],
      );
      return (rows as ConsentRow[]).map(toConsent);
    });
  }

  async upsertConsent(record: ConsentRecord): Promise<ConsentRecord> {
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO student_consents
           (id, tenant_id, student_id, kind, granted, actor_id, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, student_id, kind) DO UPDATE SET
           granted = EXCLUDED.granted,
           actor_id = EXCLUDED.actor_id,
           recorded_at = EXCLUDED.recorded_at
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.studentId,
          record.kind,
          record.granted,
          record.actorId,
          record.recordedAt,
        ],
      );
      return toConsent(rows[0] as ConsentRow);
    });
  }

  async listDiscipline(tenantId: string, studentId: string): Promise<DisciplineRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM student_discipline_incidents
          WHERE tenant_id = $1 AND student_id = $2
          ORDER BY incident_date DESC, created_at DESC`,
        [tenantId, studentId],
      );
      return (rows as DisciplineRow[]).map(toDiscipline);
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

  async listDocuments(tenantId: string, studentId: string): Promise<DocumentRecord[]> {
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM student_documents
          WHERE tenant_id = $1 AND student_id = $2
          ORDER BY created_at DESC`,
        [tenantId, studentId],
      );
      return (rows as DocumentRow[]).map(toDocument);
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

  async deleteDocument(
    tenantId: string,
    studentId: string,
    documentId: string,
  ): Promise<boolean> {
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
