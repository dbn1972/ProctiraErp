/**
 * PRC-L163: signed-URL downloads never buffer the blob; storage failures are
 * 502, only a genuinely missing object is 404.
 */
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { NotFoundError } from '@proctira/common';
import type { StorageAdapter } from '@proctira/storage';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryStudentRepository } from '../in-memory-repository.js';
import { StudentService } from '../student-service.js';
import {
  SIGNED_URL_TTL_SECONDS,
  StorageAdapterStudentBlobStore,
  StudentBlobStorageError,
  type StudentBlobStore,
} from './blob-store.js';
import { Students360Service } from './service.js';
import { InMemoryStudents360Store } from './store.js';

const TENANT = randomUUID();

function adapter(overrides: Partial<StorageAdapter>): StorageAdapter {
  return {
    upload: vi.fn(async (key: string) => ({ key })),
    download: vi.fn(async () => Readable.from([Buffer.from('%PDF-1.4 x')])),
    getSignedUrl: vi.fn(async () => 'https://signed.example/obj'),
    ...overrides,
  } as unknown as StorageAdapter;
}

describe('students-360 blob download (PRC-L163)', () => {
  let repo: InMemoryStudentRepository;
  let store: InMemoryStudents360Store;
  let studentId: string;

  beforeEach(async () => {
    repo = new InMemoryStudentRepository();
    store = new InMemoryStudents360Store();
    const s = await new StudentService(repo).create(TENANT, {
      firstName: 'A',
      lastName: 'B',
      dateOfBirth: '2010-01-01',
      gender: 'female',
    });
    studentId = s.id;
  });

  async function seedDoc(blobs: StudentBlobStore) {
    const service = new Students360Service({
      students: repo,
      store,
      blobs,
      attendance: { listStudentAttendanceInRange: async () => [] },
    });
    const doc = await service.uploadDocument(
      TENANT,
      studentId,
      {
        category: 'birth_certificate',
        fileName: 'b.pdf',
        mimeType: 'application/pdf',
        contentBase64: Buffer.from('%PDF-1.4 x').toString('base64'),
      },
      'actor-1',
    );
    return { service, doc };
  }

  it('signed-URL path does not call blobs.get', async () => {
    const blobs = new StorageAdapterStudentBlobStore(adapter({}));
    const getSpy = vi.spyOn(blobs, 'get');
    const { service, doc } = await seedDoc(blobs);
    const res = await service.getDocumentBytes(TENANT, studentId, doc.id);
    expect(res.signedUrl).toBe('https://signed.example/obj');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('defaults signed URL TTL to minutes, not an hour', async () => {
    const a = adapter({});
    await new StorageAdapterStudentBlobStore(a).getSignedUrl('k');
    expect(a.getSignedUrl).toHaveBeenCalledWith('k', SIGNED_URL_TTL_SECONDS);
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(900);
  });

  it('adapter outage -> StudentBlobStorageError (502), not 404', async () => {
    const blobs = new StorageAdapterStudentBlobStore(
      adapter({
        getSignedUrl: vi.fn(async () => {
          throw new Error('signing unavailable');
        }),
        download: vi.fn(async () => {
          throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        }),
      }),
    );
    const { service, doc } = await seedDoc(blobs);
    const err = await service.getDocumentBytes(TENANT, studentId, doc.id).catch((e) => e);
    expect(err).toBeInstanceOf(StudentBlobStorageError);
    expect((err as StudentBlobStorageError).statusCode).toBe(502);
  });

  it('missing object (NoSuchKey) -> 404', async () => {
    const blobs = new StorageAdapterStudentBlobStore(
      adapter({
        getSignedUrl: vi.fn(async () => null) as never,
        download: vi.fn(async () => {
          throw Object.assign(new Error('The specified key does not exist.'), {
            name: 'NoSuchKey',
          });
        }),
      }),
    );
    const { service, doc } = await seedDoc(blobs);
    await expect(service.getDocumentBytes(TENANT, studentId, doc.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
