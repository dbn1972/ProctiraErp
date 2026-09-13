import { describe, expect, it, beforeEach } from 'vitest';
import { ValidationError } from '@proctira/common';

import { InMemoryLifecycleCertificateRepository } from './in-memory-repository.js';
import { LifecycleCertificateService } from './lifecycle-certificate-service.js';

const TENANT = '00000000-0000-4000-8000-0000000000aa';
const STUDENT = '00000000-0000-4000-8000-0000000000bb';

describe('W2-REC-01 lifecycle certificates', () => {
  let repo: InMemoryLifecycleCertificateRepository;
  let service: LifecycleCertificateService;

  beforeEach(() => {
    repo = new InMemoryLifecycleCertificateRepository();
    service = new LifecycleCertificateService(repo);
  });

  it('issues a bonafide certificate with serial + checksum', async () => {
    const cert = await service.issue(TENANT, 'registrar-1', {
      studentId: STUDENT,
      type: 'bonafide',
      academicYear: '2025-26',
    });
    expect(cert.status).toBe('issued');
    expect(cert.serialNumber).toMatch(/^BON-\d{4}-[A-Z0-9]+$/);
    expect(cert.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(cert.academicYear).toBe('2025-26');
  });

  it('verifies issued certificates and rejects unknown serials', async () => {
    const cert = await service.issue(TENANT, 'registrar-1', {
      studentId: STUDENT,
      type: 'transfer',
    });
    const ok = await service.verify(TENANT, cert.serialNumber);
    expect(ok.valid).toBe(true);
    expect(ok.certificate?.id).toBe(cert.id);

    const miss = await service.verify(TENANT, 'NOPE-0000-XXXX');
    expect(miss.valid).toBe(false);
    expect(miss.certificate).toBeNull();
  });

  it('revokes a certificate so verification fails', async () => {
    const cert = await service.issue(TENANT, 'registrar-1', {
      studentId: STUDENT,
      type: 'character',
    });
    const revoked = await service.revoke(TENANT, cert.id, 'issued in error');
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokeReason).toBe('issued in error');
    const check = await service.verify(TENANT, cert.serialNumber);
    expect(check.valid).toBe(false);
    expect(check.certificate?.status).toBe('revoked');
  });

  it('lists certificates for a student', async () => {
    await service.issue(TENANT, 'r', { studentId: STUDENT, type: 'leaving' });
    await service.issue(TENANT, 'r', { studentId: STUDENT, type: 'bonafide' });
    const list = await service.listForStudent(TENANT, STUDENT);
    expect(list).toHaveLength(2);
  });

  it('rejects unsupported types', async () => {
    await expect(
      service.issue(TENANT, 'r', {
        studentId: STUDENT,
        type: 'diploma' as never,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
