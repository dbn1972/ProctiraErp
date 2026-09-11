/**
 * G-914 — Students 360 unit tests: consent audit, sibling symmetry,
 * heatmap aggregation, photo size/mime rejection.
 */
import { randomUUID } from 'node:crypto';

import { ConflictError, NotFoundError, ValidationError } from '@proctira/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { isPdfBuffer } from '@proctira/pdf-lite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryStudentRepository } from '../in-memory-repository.js';
import { registerStudentRoutes } from '../routes.js';
import { StudentService } from '../student-service.js';
import { InMemoryStudentBlobStore } from './blob-store.js';
import { aggregateAttendanceHeatmap } from './heatmap.js';
import { registerStudents360Routes } from './routes.js';
import { decodePhotoPayload, Students360Service } from './service.js';
import { InMemoryStudents360Store } from './store.js';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

async function createStudent(repo: InMemoryStudentRepository, tenantId: string, firstName = 'Ada') {
  const service = new StudentService(repo);
  return service.create(tenantId, {
    firstName,
    lastName: 'Lovelace',
    dateOfBirth: '2008-12-10',
    gender: 'female',
  });
}

describe('G-914 students 360', () => {
  let repo: InMemoryStudentRepository;
  let store: InMemoryStudents360Store;
  let blobs: InMemoryStudentBlobStore;
  let attendance: { date: string; status: string }[];
  let service: Students360Service;

  beforeEach(() => {
    repo = new InMemoryStudentRepository();
    store = new InMemoryStudents360Store();
    blobs = new InMemoryStudentBlobStore();
    attendance = [];
    service = new Students360Service({
      students: repo,
      store,
      blobs,
      attendance: {
        async listStudentAttendanceInRange(_t, _s, from, to) {
          return attendance.filter((r) => r.date >= from && r.date <= to);
        },
      },
    });
  });

  describe('photo size/mime rejection', () => {
    it('rejects a non-image MIME type', () => {
      expect(() =>
        decodePhotoPayload({ contentBase64: PNG_1X1, mimeType: 'application/pdf' as never }),
      ).toThrow(ValidationError);
    });

    it('rejects a payload larger than 2 MB', () => {
      const huge = Buffer.alloc(2 * 1024 * 1024 + 12, 0x41).toString('base64');
      expect(() => decodePhotoPayload({ contentBase64: huge, mimeType: 'image/png' })).toThrow(
        ValidationError,
      );
    });

    it('rejects PNG-declared bytes that are not a PNG', () => {
      expect(() =>
        decodePhotoPayload({
          contentBase64: Buffer.from('not-a-png').toString('base64'),
          mimeType: 'image/png',
        }),
      ).toThrow(ValidationError);
    });

    it('accepts a 1x1 PNG and stores it', async () => {
      const student = await createStudent(repo, TENANT_A);
      const photo = await service.uploadPhoto(
        TENANT_A,
        student.id,
        { contentBase64: PNG_1X1, mimeType: 'image/png' },
        'e2e-admin',
      );
      expect(photo.mimeType).toBe('image/png');
      expect(photo.sizeBytes).toBeGreaterThan(0);
      expect(photo.uploadedBy).toBe('e2e-admin');
      const bytes = await service.getPhotoBytes(TENANT_A, student.id);
      expect(bytes.mimeType).toBe('image/png');
      expect(bytes.bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    });
  });

  describe('consent audit fields', () => {
    it('sets actorId and recordedAt on grant and overwrite', async () => {
      const student = await createStudent(repo, TENANT_A);
      const first = await service.setConsent(
        TENANT_A,
        student.id,
        { kind: 'photo', granted: true },
        'registrar-1',
      );
      expect(first.granted).toBe(true);
      expect(first.actorId).toBe('registrar-1');
      expect(first.recordedAt).toBeInstanceOf(Date);

      const second = await service.setConsent(
        TENANT_A,
        student.id,
        { kind: 'photo', granted: false },
        'registrar-2',
      );
      expect(second.granted).toBe(false);
      expect(second.actorId).toBe('registrar-2');
      expect(second.recordedAt.getTime()).toBeGreaterThanOrEqual(first.recordedAt.getTime());

      const listed = await service.listConsents(TENANT_A, student.id);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.actorId).toBe('registrar-2');
    });
  });

  describe('sibling symmetry', () => {
    it('inserts the reverse link in the same tenant and rejects self/cross-tenant', async () => {
      const a = await createStudent(repo, TENANT_A, 'Ada');
      const b = await createStudent(repo, TENANT_A, 'Ben');
      const foreign = await createStudent(repo, TENANT_B, 'Zoe');

      const link = await service.addSibling(TENANT_A, a.id, { siblingId: b.id });
      expect(link.studentId).toBe(a.id);
      expect(link.siblingId).toBe(b.id);

      const fromA = await service.listSiblings(TENANT_A, a.id);
      const fromB = await service.listSiblings(TENANT_A, b.id);
      expect(fromA.map((r) => r.siblingId)).toEqual([b.id]);
      expect(fromB.map((r) => r.siblingId)).toEqual([a.id]);

      await expect(service.addSibling(TENANT_A, a.id, { siblingId: b.id })).rejects.toBeInstanceOf(
        ConflictError,
      );
      await expect(service.addSibling(TENANT_A, a.id, { siblingId: a.id })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        service.addSibling(TENANT_A, a.id, { siblingId: foreign.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('heatmap aggregation', () => {
    it('matches (present + late) / total * 100 and maps daily slots', async () => {
      const student = await createStudent(repo, TENANT_A);
      attendance.push(
        { date: '2026-09-01', status: 'PRESENT' },
        { date: '2026-09-02', status: 'LATE' },
        { date: '2026-09-03', status: 'ABSENT' },
        { date: '2026-09-03', status: 'PRESENT' },
      );
      const heatmap = await service.attendanceHeatmap(
        TENANT_A,
        student.id,
        '2026-09-01',
        '2026-09-03',
      );
      expect(heatmap.totalRecords).toBe(4);
      expect(heatmap.attendancePercentage).toBe(75);
      expect(heatmap.absencePercentage).toBe(25);
      const byDate = Object.fromEntries(heatmap.days.map((d) => [d.date, d]));
      expect(byDate['2026-09-01']?.slot).toBe('present');
      expect(byDate['2026-09-02']?.slot).toBe('half');
      expect(byDate['2026-09-03']?.slot).toBe('absent');
    });

    it('aggregates an empty range to zero without inventing records', () => {
      const result = aggregateAttendanceHeatmap([], '2026-09-01', '2026-09-02');
      expect(result.totalRecords).toBe(0);
      expect(result.attendancePercentage).toBe(0);
      expect(result.days).toHaveLength(2);
      expect(result.days.every((d) => d.slot === 'empty')).toBe(true);
    });
  });

  describe('id-card PDF', () => {
    it('renders a real PDF for an existing student', async () => {
      const student = await createStudent(repo, TENANT_A);
      const pdf = await service.renderIdCardPdf(TENANT_A, student.id);
      expect(isPdfBuffer(pdf)).toBe(true);
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });
  });
});

describe('G-914 students 360 routes', () => {
  let app: FastifyInstance;
  let repo: InMemoryStudentRepository;
  const actor = 'route-actor';

  beforeEach(async () => {
    repo = new InMemoryStudentRepository();
    const store = new InMemoryStudents360Store();
    const blobs = new InMemoryStudentBlobStore();
    const studentService = new StudentService(repo);
    const service = new Students360Service({ students: repo, store, blobs });
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      const header = request.headers['x-tenant-id'];
      (request as unknown as { tenantId: string }).tenantId =
        typeof header === 'string' ? header : TENANT_A;
      // Registrar role required for POST /students after PRD-005 write RBAC.
      (request as unknown as { user: { sub: string; roles: string[] } }).user = {
        sub: actor,
        roles: ['registrar'],
      };
    });
    await registerStudentRoutes(app, { studentService });
    await registerStudents360Routes(app, { service });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('uploads a photo, sets consent with the request actor, and downloads an ID card PDF', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/students',
      payload: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        dateOfBirth: '2008-12-10',
        gender: 'female',
      },
    });
    expect(created.statusCode).toBe(201);
    const studentId = created.json().id as string;

    const photo = await app.inject({
      method: 'POST',
      url: `/students/${studentId}/photo`,
      payload: { contentBase64: PNG_1X1, mimeType: 'image/png' },
    });
    expect(photo.statusCode).toBe(201);

    const consent = await app.inject({
      method: 'PUT',
      url: `/students/${studentId}/consents`,
      payload: { kind: 'trips', granted: true },
    });
    expect(consent.statusCode).toBe(200);
    expect(consent.json()).toMatchObject({ kind: 'trips', granted: true, actorId: actor });

    const card = await app.inject({ method: 'GET', url: `/students/${studentId}/id-card.pdf` });
    expect(card.statusCode).toBe(200);
    expect(card.headers['content-type']).toContain('application/pdf');
    expect(isPdfBuffer(Buffer.from(card.rawPayload))).toBe(true);
  });

  it('returns 404 for tenant B on tenant A student 360 reads', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/students',
      payload: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        dateOfBirth: '2008-12-10',
        gender: 'female',
      },
    });
    const studentId = created.json().id as string;
    const foreign = await app.inject({
      method: 'GET',
      url: `/students/${studentId}/consents`,
      headers: { 'x-tenant-id': TENANT_B },
    });
    expect(foreign.statusCode).toBe(404);
  });
});
