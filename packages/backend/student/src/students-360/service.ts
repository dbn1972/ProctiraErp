/**
 * G-914 — Students 360 application service.
 */
import { randomUUID } from 'node:crypto';

import { ConflictError, NotFoundError, ValidationError } from '@proctira/common';

import type { StudentEntity, StudentRepository } from '../student-repository.js';

import type { StudentBlobStore } from './blob-store.js';
import {
  aggregateAttendanceHeatmap,
  defaultHeatmapRange,
  type AttendanceDayInput,
  type HeatmapResult,
} from './heatmap.js';
import { renderStudentIdCardPdf } from './id-card-pdf.js';
import {
  ALLOWED_PHOTO_MIMES,
  PHOTO_MAX_BYTES,
  type CreateDisciplineDto,
  type CreateSiblingDto,
  type SetConsentDto,
  type UploadPhotoDto,
} from './schemas.js';
import type {
  ConsentRecord,
  DisciplineRecord,
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

export function decodePhotoPayload(input: UploadPhotoDto): { bytes: Buffer; mimeType: string } {
  const mime = input.mimeType;
  if (!(ALLOWED_PHOTO_MIMES as readonly string[]).includes(mime)) {
    throw new ValidationError('Unsupported photo type', [
      { field: 'mimeType', rule: 'enum', message: 'Photo must be JPEG, PNG, or WebP' },
    ]);
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(input.contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  } catch {
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
  if (mime === 'image/webp' && bytes.subarray(8, 12).compare(WEBP_SIG) !== 0) {
    throw new ValidationError('Photo bytes do not match the declared MIME type', [
      { field: 'contentBase64', rule: 'magic', message: 'Not a WebP image' },
    ]);
  }
  return { bytes, mimeType: mime };
}

function photoObjectKey(tenantId: string, studentId: string): string {
  return `students/${studentId}/photo`;
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
    const bytes = await this.deps.blobs.get(photo.objectKey);
    if (!bytes && !signedUrl) {
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
    return this.deps.store.upsertConsent({
      id: randomUUID(),
      tenantId,
      studentId,
      kind: input.kind,
      granted: input.granted,
      actorId,
      recordedAt,
    });
  }

  async listDiscipline(tenantId: string, studentId: string): Promise<DisciplineRecord[]> {
    await this.requireStudent(tenantId, studentId);
    return this.deps.store.listDiscipline(tenantId, studentId);
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
    if (start > end) {
      throw new ValidationError('from must be on or before to', [
        { field: 'from', rule: 'range', message: 'from must be on or before to' },
      ]);
    }
    const records = this.deps.attendance
      ? await this.deps.attendance.listStudentAttendanceInRange(tenantId, studentId, start, end)
      : [];
    return aggregateAttendanceHeatmap(records, start, end);
  }
}
