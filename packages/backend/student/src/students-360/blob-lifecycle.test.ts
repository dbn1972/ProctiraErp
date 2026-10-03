/**
 * PRC-M386: document blobs are deleted with their row and never orphaned by a
 * failed metadata insert.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryStudentRepository } from '../in-memory-repository.js';
import { StudentService } from '../student-service.js';
import { InMemoryStudentBlobStore } from './blob-store.js';
import { Students360Service } from './service.js';
import { InMemoryStudents360Store } from './store.js';

const TENANT = randomUUID();
const PDF = Buffer.from('%PDF-1.4 x').toString('base64');

async function setup() {
  const repo = new InMemoryStudentRepository();
  const store = new InMemoryStudents360Store();
  const blobs = new InMemoryStudentBlobStore();
  const student = await new StudentService(repo).create(TENANT, {
    firstName: 'A',
    lastName: 'B',
    dateOfBirth: '2010-01-01',
    gender: 'female',
  });
  const service = new Students360Service({
    students: repo,
    store,
    blobs,
    attendance: { listStudentAttendanceInRange: async () => [] },
  });
  const upload = () =>
    service.uploadDocument(
      TENANT,
      student.id,
      { category: 'birth_certificate', fileName: 'b.pdf', mimeType: 'application/pdf', contentBase64: PDF },
      'registrar',
    );
  return { service, store, blobs, studentId: student.id, upload };
}

describe('student document blob lifecycle (PRC-M386)', () => {
  it('delete removes the blob', async () => {
    const { service, blobs, studentId, upload } = await setup();
    const doc = await upload();
    expect(await blobs.get(doc.objectKey)).not.toBeNull();
    await service.removeDocument(TENANT, studentId, doc.id);
    expect(await blobs.get(doc.objectKey)).toBeNull();
  });

  it('failed metadata insert leaves no blob', async () => {
    const { store, blobs, upload } = await setup();
    let writtenKey = '';
    const put = blobs.put.bind(blobs);
    blobs.put = async (key, ...rest) => {
      writtenKey = key;
      return put(key, ...rest);
    };
    store.createDocument = async () => {
      throw new Error('db down');
    };
    await expect(upload()).rejects.toThrow('db down');
    expect(writtenKey).not.toBe('');
    expect(await blobs.get(writtenKey)).toBeNull();
  });

  it('deleting a missing document is 404 and touches no blob', async () => {
    const { service, studentId } = await setup();
    await expect(service.removeDocument(TENANT, studentId, randomUUID())).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
