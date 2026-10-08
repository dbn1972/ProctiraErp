/**
 * NEW-g4_apps_auth-006 — admission document upload must store the actual file,
 * validate type/size by magic bytes, populate storagePath, and require a stored
 * file for mandatory documents.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ValidationError, AppError } from '@proctira/common';

import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { matchesDeclaredType, sniffDocumentContent } from './document-content-validation.js';
import type { RegistrationDocumentStorage } from './registration-document-storage.js';
import { RegistrationService } from './registration-service.js';
import type { FormConfiguration, SubmitRegistrationInput } from './schemas.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const PNG_B64 = PNG.toString('base64');

const tenantId = 'tenant-001';
const institutionId = '12345678-1234-4123-8123-123456789abc';
const formConfigurationId = '32345678-1234-4123-8123-123456789abc';

class RecordingStorage implements RegistrationDocumentStorage {
  public readonly puts: Array<{ tenantId: string; key: string; byteLength: number }> = [];
  async putDocument(params: {
    tenantId: string;
    key: string;
    bytes: Buffer;
    contentType: string;
  }): Promise<string> {
    this.puts.push({ tenantId: params.tenantId, key: params.key, byteLength: params.bytes.length });
    return `tenants/${params.tenantId}/${params.key}`;
  }
}

function seed(repository: InMemoryRegistrationRepository, requiredFiles: boolean): void {
  repository.seedInstitutions([
    {
      id: institutionId,
      name: 'Springfield Elementary',
      code: 'SPR-001',
      typeId: 'type-primary-001',
      typeName: 'Primary School',
      areaId: 'area-001',
      areaName: 'Springfield District',
      tenantId,
      status: 'ACTIVE',
      latitude: 39.78,
      longitude: -89.65,
      address: '123 School St',
      availableGrades: ['grade-1'],
    },
  ]);
  const config: FormConfiguration = {
    id: formConfigurationId,
    tenantId,
    institutionId,
    version: 1,
    publishedAt: '2026-09-19T00:00:00.000Z',
    fields: [
      {
        id: 'birth_certificate',
        label: 'Birth certificate',
        type: 'file',
        required: requiredFiles,
      },
    ],
  };
  repository.seedFormConfigurations([config]);
}

const baseInput: Omit<SubmitRegistrationInput, 'documents'> = {
  institutionId,
  formConfigurationId,
  formConfigurationVersion: 1,
  firstName: 'Bart',
  lastName: 'Simpson',
  dateOfBirth: '2010-04-01',
  gender: 'male',
  guardianName: 'Homer Simpson',
  guardianPhone: '+1-555-0100',
  guardianEmail: 'homer@springfield.com',
};

describe('NEW-g4_apps_auth-006 document content validation', () => {
  it('matches magic bytes to declared type', () => {
    expect(matchesDeclaredType(PNG, 'image/png')).toBe(true);
    expect(matchesDeclaredType(PNG, 'image/jpeg')).toBe(false);
    expect(matchesDeclaredType(Buffer.from('%PDF-1.4'), 'application/pdf')).toBe(true);
    expect(matchesDeclaredType(Buffer.from('not a png'), 'image/png')).toBe(false);
    expect(matchesDeclaredType(Buffer.alloc(0), 'image/png')).toBe(false);
  });

  it('rejects empty content and type mismatch via sniff', () => {
    expect(sniffDocumentContent('', 'image/png').ok).toBe(false);
    expect(sniffDocumentContent(Buffer.from('hello').toString('base64'), 'image/png').ok).toBe(
      false,
    );
    expect(sniffDocumentContent(PNG_B64, 'image/png').ok).toBe(true);
  });
});

describe('NEW-g4_apps_auth-006 RegistrationService document storage', () => {
  let repository: InMemoryRegistrationRepository;
  let storage: RecordingStorage;

  beforeEach(() => {
    repository = new InMemoryRegistrationRepository();
    storage = new RecordingStorage();
  });

  afterEach(() => {
    delete process.env['NODE_ENV'];
  });

  it('stores the actual bytes and populates storagePath + real byte size', async () => {
    seed(repository, false);
    const service = new RegistrationService(repository, undefined, storage);
    await service.submitRegistration(
      tenantId,
      {
        ...baseInput,
        documents: [
          {
            fileName: 'birth.png',
            fileType: 'image/png',
            fileSize: 999999, // client-declared, must be overwritten by real size
            documentType: 'birth_certificate',
            content: PNG_B64,
          },
        ],
      },
      'submit-store-1',
    );
    const stored = repository.getAll()[0]!;
    expect(stored.documents).toHaveLength(1);
    expect(stored.documents[0]!.storagePath).toBe(`tenants/${tenantId}/${storage.puts[0]!.key}`);
    expect(stored.documents[0]!.fileSize).toBe(PNG.length);
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]!.tenantId).toBe(tenantId);
  });

  it('rejects a document whose content does not match the declared type (magic bytes)', async () => {
    seed(repository, false);
    const service = new RegistrationService(repository, undefined, storage);
    await expect(
      service.submitRegistration(
        tenantId,
        {
          ...baseInput,
          documents: [
            {
              fileName: 'birth.png',
              fileType: 'image/png',
              fileSize: 5,
              documentType: 'birth_certificate',
              content: Buffer.from('plain text, not a png').toString('base64'),
            },
          ],
        },
        'submit-bad-1',
      ),
    ).rejects.toThrow(ValidationError);
    expect(storage.puts).toHaveLength(0);
    expect(repository.getAll()).toHaveLength(0);
  });

  it('requires a stored file for a mandatory document (metadata alone is rejected)', async () => {
    seed(repository, true); // birth_certificate required
    const service = new RegistrationService(repository, undefined, storage);
    await expect(
      service.submitRegistration(
        tenantId,
        {
          ...baseInput,
          documents: [
            {
              fileName: 'birth.png',
              fileType: 'image/png',
              fileSize: 1024,
              documentType: 'birth_certificate',
              // no content → metadata only
            },
          ],
        },
        'submit-nofile-1',
      ),
    ).rejects.toThrow(ValidationError);
    expect(storage.puts).toHaveLength(0);
  });

  it('accepts a mandatory document when the file bytes are provided', async () => {
    seed(repository, true);
    const service = new RegistrationService(repository, undefined, storage);
    const result = await service.submitRegistration(
      tenantId,
      {
        ...baseInput,
        documents: [
          {
            fileName: 'birth.png',
            fileType: 'image/png',
            fileSize: PNG.length,
            documentType: 'birth_certificate',
            content: PNG_B64,
          },
        ],
      },
      'submit-ok-1',
    );
    expect(result.status).toBe('pending');
    expect(repository.getAll()[0]!.documents[0]!.storagePath).toBeDefined();
  });

  it('fails closed in production when content is uploaded without configured storage', async () => {
    seed(repository, false);
    process.env['NODE_ENV'] = 'production';
    const service = new RegistrationService(repository); // no storage injected
    await expect(
      service.submitRegistration(
        tenantId,
        {
          ...baseInput,
          documents: [
            {
              fileName: 'birth.png',
              fileType: 'image/png',
              fileSize: PNG.length,
              documentType: 'birth_certificate',
              content: PNG_B64,
            },
          ],
        },
        'submit-prod-1',
      ),
    ).rejects.toThrow(AppError);
    expect(repository.getAll()).toHaveLength(0);
  });
});
