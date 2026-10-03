/**
 * G-914 — Students 360 application service.
 */
import { randomUUID } from 'node:crypto';

import { ConflictError, NotFoundError, ValidationError } from '@proctira/common';

import { isStrictIsoDate } from '../date-of-birth.js';
import type { StudentEntity, StudentRepository } from '../student-repository.js';

import type { StudentBlobStore } from './blob-store.js';
import {
  aggregateAttendanceHeatmap,
  defaultHeatmapRange,
  HEATMAP_MAX_DAYS,
  heatmapSpanDays,
  type AttendanceDayInput,
  type HeatmapResult,
} from './heatmap.js';
import { renderStudentIdCardPdf } from './id-card-pdf.js';
import {
  ALLOWED_DOCUMENT_MIMES,
  ALLOWED_PHOTO_MIMES,
  DOCUMENT_MAX_BYTES,
  PHOTO_MAX_BYTES,
  type CreateDisciplineDto,
  type CreateSiblingDto,
  type SetConsentDto,
  type UploadDocumentDto,
  type UploadPhotoDto,
} from './schemas.js';
import type {
  ConsentRecord,
  DisciplineListOptions,
  DisciplineRecord,
  DocumentRecord,
  ListPage,
  ListPageResult,
  PhotoRecord,
  SiblingRecord,
  Students360Store,
} from './store.js';

export interface AttendanceHeatmapSource {
  listStudentAttendanceInRange(
    tenantId: string,
    studentId: string,
    startDate: string,
    endDate: string,
  ): Promise<AttendanceDayInput[]>;
}

export interface Students360ServiceDeps {
  students: StudentRepository;
  store: Students360Store;
  blobs: StudentBlobStore;
  attendance?: AttendanceHeatmapSource;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff]);
const WEBP_SIG = Buffer.from('WEBP');
const RIFF_SIG = Buffer.from('RIFF');
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

/** PRC-L367: WebP = "RIFF" at 0-4 and "WEBP" at 8-12. */
function isWebp(bytes: Buffer): boolean {
  return (
    bytes.subarray(0, 4).compare(RIFF_SIG) === 0 && bytes.subarray(8, 12).compare(WEBP_SIG) === 0
  );
}

/**
 * PRC-L367: strict base64 decode. `Buffer.from(x, 'base64')` never throws and
 * silently drops invalid characters, so validate alphabet and padding first.
 */
export function decodeBase64Strict(raw: string): Buffer | null {
  const body = raw.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (body.length === 0 || body.length % 4 !== 0 || !BASE64_BODY.test(body)) return null;
  return Buffer.from(body, 'base64');
}

/**
 * PRC-L367: strip control characters, path separators and leading dots from an
 * uploaded file name; returns '' when nothing usable remains.
 */
export function sanitizeFileName(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/]/g, '_')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 255)
  );
}

export function decodePhotoPayload(input: UploadPhotoDto): { bytes: Buffer; mimeType: string } {
  const mime = input.mimeType;
  if (!(ALLOWED_PHOTO_MIMES as readonly string[]).includes(mime)) {
    throw new ValidationError('Unsupported photo type', [
      { field: 'mimeType', rule: 'enum', message: 'Photo must be JPEG, PNG, or WebP' },
    ]);
  }
  const bytes = decodeBase64Strict(input.contentBase64);
  if (!bytes) {
    throw new ValidationError('Invalid photo encoding', [
      { field: 'contentBase64', rule: 'base64', message: 'Photo must be valid base64' },
    ]);
  }
  if (bytes.length === 0) {
    throw new ValidationError('Photo is empty', [
      { field: 'contentBase64', rule: 'minLength', message: 'Photo is empty' },
    ]);
  }
  if (bytes.length > PHOTO_MAX_BYTES) {
    throw new ValidationError('Photo exceeds 2 MB', [
      { field: 'contentBase64', rule: 'maxSize', message: 'Photo must be 2 MB or smaller' },
    ]);
  }
  if (mime === 'image/png' && bytes.subarray(0, 4).compare(PNG_SIG) !== 0) {
    throw new ValidationError('Photo bytes do not match the declared MIME type', [
      { field: 'contentBase64', rule: 'magic', message: 'Not a PNG image' },
    ]);
  }
  if (mime === 'image/jpeg' && bytes.subarray(0, 3).compare(JPEG_SIG) !== 0) {
    throw new ValidationError('Photo bytes do not match the declared MIME type', [
      { field: 'contentBase64', rule: 'magic', message: 'Not a JPEG image' },
    ]);
  }
  if (mime === 'image/webp' && !isWebp(bytes)) {
    throw new ValidationError('Photo bytes do not match the declared MIME type', [
      { field: 'contentBase64', rule: 'magic', message: 'Not a WebP image' },
    ]);
  }
  return { bytes, mimeType: mime };
}

function photoObjectKey(tenantId: string, studentId: string): string {
  return `students/${studentId}/photo`;
}

function documentObjectKey(tenantId: string, studentId: string, documentId: string): string {
  return `students/${tenantId}/${studentId}/documents/${documentId}`;
}

const PDF_SIG = Buffer.from('%PDF');

export function decodeDocumentPayload(input: UploadDocumentDto): {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
} {
  const mime = input.mimeType;
  if (!(ALLOWED_DOCUMENT_MIMES as readonly string[]).includes(mime)) {
    throw new ValidationError('Unsupported document type', [
      {
        field: 'mimeType',
        rule: 'enum',
        message: 'Document must be PDF, JPEG, PNG, or WebP',
      },
    ]);
  }
  const fileName = sanitizeFileName(input.fileName);
  if (!fileName) {
    throw new ValidationError('File name is required', [
      { field: 'fileName', rule: 'minLength', message: 'File name is required' },
    ]);
  }
  const bytes = decodeBase64Strict(input.contentBase64);
  if (!bytes) {
    throw new ValidationError('Invalid document encoding', [
      { field: 'contentBase64', rule: 'base64', message: 'Document must be valid base64' },
    ]);
  }
  if (bytes.length === 0) {
    throw new ValidationError('Document is empty', [
      { field: 'contentBase64', rule: 'minLength', message: 'Document is empty' },
    ]);
  }
  if (bytes.length > DOCUMENT_MAX_BYTES) {
    throw new ValidationError('Document exceeds 10 MB', [
      { field: 'contentBase64', rule: 'maxSize', message: 'Document must be 10 MB or smaller' },
    ]);
  }
  if (mime === 'application/pdf' && bytes.subarray(0, 4).compare(PDF_SIG) !== 0) {
    throw new ValidationError('Document bytes do not match the declared MIME type', [
      { field: 'contentBase64', rule: 'magic', message: 'Not a PDF document' },
    ]);
  }
  if (mime === 'image/png' && bytes.subarray(0, 4).compare(PNG_SIG) !== 0) {
    throw new ValidationError('Document bytes do not match the declared MIME type', [
      { field: 'contentBase64', rule: 'magic', message: 'Not a PNG image' },
    ]);
  }
  if (mime === 'image/jpeg' && bytes.subarray(0, 3).compare(JPEG_SIG) !== 0) {
    throw new ValidationError('Document bytes do not match the declared MIME type', [
      { field: 'contentBase64', rule: 'magic', message: 'Not a JPEG image' },
    ]);
  }
  if (mime === 'image/webp' && !isWebp(bytes)) {
    throw new ValidationError('Document bytes do not match the declared MIME type', [
      { field: 'contentBase64', rule: 'magic', message: 'Not a WebP image' },
    ]);
  }
  return { bytes, mimeType: mime, fileName };
}

export class Students360Service {
  constructor(private readonly deps: Students360ServiceDeps) {}

  private async requireStudent(tenantId: string, studentId: string): Promise<StudentEntity> {
    const student = await this.deps.students.findById(studentId, tenantId);
    if (!student) throw new NotFoundError(`Student '${studentId}' not found`);
    return student;
  }

  async uploadPhoto(
    tenantId: string,
    studentId: string,
    input: UploadPhotoDto,
    uploadedBy: string,
  ): Promise<PhotoRecord> {
    await this.requireStudent(tenantId, studentId);
    const { bytes, mimeType } = decodePhotoPayload(input);
    const objectKey = await this.deps.blobs.put(
      photoObjectKey(tenantId, studentId),
      bytes,
      mimeType,
      tenantId,
    );
    return this.deps.store.upsertPhoto({
      id: randomUUID(),
      tenantId,
      studentId,
      objectKey,
      mimeType,
      sizeBytes: bytes.length,
      uploadedBy,
      createdAt: new Date(),
    });
  }

  async getPhotoMeta(tenantId: string, studentId: string): Promise<PhotoRecord> {
    await this.requireStudent(tenantId, studentId);
    const photo = await this.deps.store.getPhoto(tenantId, studentId);
    if (!photo) throw new NotFoundError(`Photo for student '${studentId}' not found`);
    return photo;
  }

  async getPhotoBytes(
    tenantId: string,
    studentId: string,
  ): Promise<{ bytes: Buffer; mimeType: string; signedUrl: string | null }> {
    const photo = await this.getPhotoMeta(tenantId, studentId);
    const signedUrl = this.deps.blobs.getSignedUrl
      ? await this.deps.blobs.getSignedUrl(photo.objectKey)
      : null;
    // PRC-L163: the route redirects to the signed URL; never buffer the blob too.
    if (signedUrl) return { bytes: Buffer.alloc(0), mimeType: photo.mimeType, signedUrl };
    const bytes = await this.deps.blobs.get(photo.objectKey);
    if (!bytes) {
      throw new NotFoundError(`Photo bytes for student '${studentId}' not found`);
    }
    return { bytes: bytes ?? Buffer.alloc(0), mimeType: photo.mimeType, signedUrl };
  }

  async renderIdCardPdf(tenantId: string, studentId: string): Promise<Buffer> {
    const student = await this.requireStudent(tenantId, studentId);
    return renderStudentIdCardPdf({
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      dateOfBirth: student.dateOfBirth,
      gender: student.gender,
      nationalId: student.nationalId,
    });
  }

  async listSiblings(tenantId: string, studentId: string): Promise<SiblingRecord[]> {
    await this.requireStudent(tenantId, studentId);
    return this.deps.store.listSiblings(tenantId, studentId);
  }

  async addSibling(
    tenantId: string,
    studentId: string,
    input: CreateSiblingDto,
  ): Promise<SiblingRecord> {
    await this.requireStudent(tenantId, studentId);
    if (input.siblingId === studentId) {
      throw new ValidationError('A student cannot be their own sibling', [
        { field: 'siblingId', rule: 'self', message: 'A student cannot be their own sibling' },
      ]);
    }
    await this.requireStudent(tenantId, input.siblingId);
    const existing = await this.deps.store.findSiblingLink(tenantId, studentId, input.siblingId);
    if (existing) {
      throw new ConflictError('Sibling link already exists');
    }
    const now = new Date();
    return this.deps.store.createSiblingPair(
      {
        id: randomUUID(),
        tenantId,
        studentId,
        siblingId: input.siblingId,
        createdAt: now,
      },
      {
        id: randomUUID(),
        tenantId,
        studentId: input.siblingId,
        siblingId: studentId,
        createdAt: now,
      },
    );
  }

  async removeSibling(tenantId: string, studentId: string, siblingId: string): Promise<void> {
    await this.requireStudent(tenantId, studentId);
    const removed = await this.deps.store.deleteSiblingPair(tenantId, studentId, siblingId);
    if (!removed) throw new NotFoundError('Sibling link not found');
  }

  async listConsents(tenantId: string, studentId: string): Promise<ConsentRecord[]> {
    await this.requireStudent(tenantId, studentId);
    return this.deps.store.listConsents(tenantId, studentId);
  }

  async setConsent(
    tenantId: string,
    studentId: string,
    input: SetConsentDto,
    actorId: string,
  ): Promise<ConsentRecord> {
    await this.requireStudent(tenantId, studentId);
    const recordedAt = new Date();
    return this.deps.store.appendConsent({
      id: randomUUID(),
      tenantId,
      studentId,
      kind: input.kind,
      granted: input.granted,
      actorId,
      recordedAt,
      version: 1,
      supersedesId: null,
      validFrom: recordedAt,
      validTo: null,
    });
  }

  async listDiscipline(
    tenantId: string,
    studentId: string,
    page?: ListPage,
    options?: DisciplineListOptions,
  ): Promise<ListPageResult<DisciplineRecord>> {
    await this.requireStudent(tenantId, studentId);
    return this.deps.store.listDiscipline(tenantId, studentId, page, options);
  }

  async addDiscipline(
    tenantId: string,
    studentId: string,
    input: CreateDisciplineDto,
    reporterId: string,
  ): Promise<DisciplineRecord> {
    await this.requireStudent(tenantId, studentId);
    return this.deps.store.createDiscipline({
      id: randomUUID(),
      tenantId,
      studentId,
      incidentType: input.incidentType.trim(),
      severity: input.severity,
      description: input.description.trim(),
      actionTaken: input.actionTaken?.trim() || null,
      reporterId,
      incidentDate: input.incidentDate,
      visibleToParent: input.visibleToParent ?? false,
      createdAt: new Date(),
    });
  }

  async removeDiscipline(tenantId: string, studentId: string, incidentId: string): Promise<void> {
    await this.requireStudent(tenantId, studentId);
    const removed = await this.deps.store.deleteDiscipline(tenantId, studentId, incidentId);
    if (!removed) throw new NotFoundError('Discipline incident not found');
  }

  async attendanceHeatmap(
    tenantId: string,
    studentId: string,
    from?: string,
    to?: string,
  ): Promise<HeatmapResult> {
    await this.requireStudent(tenantId, studentId);
    const range = from && to ? { from, to } : defaultHeatmapRange();
    const start = from ?? range.from;
    const end = to ?? range.to;
    // PRC-M385: calendar-valid dates and a bounded span (checked after
    // defaulting, so a lone ancient `from` cannot produce a huge range).
    for (const [field, value] of [
      ['from', start],
      ['to', end],
    ] as const) {
      if (!isStrictIsoDate(value)) {
        throw new ValidationError(`${field} must be a valid calendar date`, [
          { field, rule: 'format', message: `${field} must be a valid calendar date` },
        ]);
      }
    }
    if (start > end) {
      throw new ValidationError('from must be on or before to', [
        { field: 'from', rule: 'range', message: 'from must be on or before to' },
      ]);
    }
    if (heatmapSpanDays(start, end) > HEATMAP_MAX_DAYS) {
      throw new ValidationError(`Range must not exceed ${HEATMAP_MAX_DAYS} days`, [
        { field: 'to', rule: 'range', message: `Range must not exceed ${HEATMAP_MAX_DAYS} days` },
      ]);
    }
    const records = this.deps.attendance
      ? await this.deps.attendance.listStudentAttendanceInRange(tenantId, studentId, start, end)
      : [];
    return aggregateAttendanceHeatmap(records, start, end);
  }

  /** W2-SIS-03 — register a general student document blob (not the profile photo). */
  async uploadDocument(
    tenantId: string,
    studentId: string,
    input: UploadDocumentDto,
    uploadedBy: string,
  ): Promise<DocumentRecord> {
    await this.requireStudent(tenantId, studentId);
    const { bytes, mimeType, fileName } = decodeDocumentPayload(input);
    const id = randomUUID();
    const objectKey = await this.deps.blobs.put(
      documentObjectKey(tenantId, studentId, id),
      bytes,
      mimeType,
      tenantId,
    );
    return this.deps.store.createDocument({
      id,
      tenantId,
      studentId,
      category: input.category,
      fileName,
      objectKey,
      mimeType,
      sizeBytes: bytes.length,
      uploadedBy,
      createdAt: new Date(),
    });
  }

  async listDocuments(
    tenantId: string,
    studentId: string,
    page?: ListPage,
  ): Promise<ListPageResult<DocumentRecord>> {
    await this.requireStudent(tenantId, studentId);
    return this.deps.store.listDocuments(tenantId, studentId, page);
  }

  async getDocumentMeta(
    tenantId: string,
    studentId: string,
    documentId: string,
  ): Promise<DocumentRecord> {
    await this.requireStudent(tenantId, studentId);
    const doc = await this.deps.store.findDocument(tenantId, studentId, documentId);
    if (!doc) throw new NotFoundError(`Document '${documentId}' not found`);
    return doc;
  }

  async getDocumentBytes(
    tenantId: string,
    studentId: string,
    documentId: string,
  ): Promise<{ bytes: Buffer; mimeType: string; fileName: string; signedUrl: string | null }> {
    const doc = await this.getDocumentMeta(tenantId, studentId, documentId);
    const signedUrl = this.deps.blobs.getSignedUrl
      ? await this.deps.blobs.getSignedUrl(doc.objectKey)
      : null;
    // PRC-L163: the route redirects to the signed URL; never buffer the blob too.
    if (signedUrl) {
      return { bytes: Buffer.alloc(0), mimeType: doc.mimeType, fileName: doc.fileName, signedUrl };
    }
    const bytes = await this.deps.blobs.get(doc.objectKey);
    if (!bytes) {
      throw new NotFoundError(`Document bytes for '${documentId}' not found`);
    }
    return {
      bytes: bytes ?? Buffer.alloc(0),
      mimeType: doc.mimeType,
      fileName: doc.fileName,
      signedUrl,
    };
  }

  async removeDocument(tenantId: string, studentId: string, documentId: string): Promise<void> {
    await this.requireStudent(tenantId, studentId);
    const removed = await this.deps.store.deleteDocument(tenantId, studentId, documentId);
    if (!removed) throw new NotFoundError(`Document '${documentId}' not found`);
  }
}
