import { createHash, randomUUID } from 'node:crypto';

import { NotFoundError, ValidationError } from '@proctira/common';

import type {
  IssueLifecycleCertificateInput,
  LifecycleCertificate,
  LifecycleCertificateRepository,
  LifecycleCertificateType,
} from './types.js';

const ALLOWED_TYPES: ReadonlySet<LifecycleCertificateType> = new Set([
  'bonafide',
  'transfer',
  'character',
  'leaving',
]);

function checksumFor(parts: Record<string, string>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function serialFor(type: LifecycleCertificateType, now: Date): string {
  const y = now.getUTCFullYear();
  const prefix = type.slice(0, 3).toUpperCase();
  return `${prefix}-${y}-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

export class LifecycleCertificateService {
  constructor(private readonly repository: LifecycleCertificateRepository) {}

  async issue(
    tenantId: string,
    actorId: string,
    input: IssueLifecycleCertificateInput,
  ): Promise<LifecycleCertificate> {
    if (!input.studentId?.trim()) {
      throw new ValidationError('studentId is required', [
        { field: 'studentId', rule: 'required', message: 'studentId is required' },
      ]);
    }
    if (!ALLOWED_TYPES.has(input.type)) {
      throw new ValidationError('Unsupported certificate type', [
        {
          field: 'type',
          rule: 'enum',
          message: 'Must be bonafide, transfer, character, or leaving',
        },
      ]);
    }

    const now = new Date();
    const serialNumber = serialFor(input.type, now);
    const entity: LifecycleCertificate = {
      id: randomUUID(),
      tenantId,
      studentId: input.studentId.trim(),
      type: input.type,
      serialNumber,
      status: 'issued',
      issuedBy: actorId,
      issuedAt: now,
      revokedAt: null,
      revokeReason: null,
      academicYear: input.academicYear?.trim() || null,
      remarks: input.remarks?.trim() || null,
      checksum: checksumFor({
        tenantId,
        studentId: input.studentId.trim(),
        type: input.type,
        serialNumber,
        issuedAt: now.toISOString(),
      }),
    };
    return this.repository.create(entity);
  }

  async get(tenantId: string, id: string): Promise<LifecycleCertificate> {
    const found = await this.repository.findById(tenantId, id);
    if (!found) throw new NotFoundError(`Certificate '${id}' not found`);
    return found;
  }

  async verify(
    tenantId: string,
    serialNumber: string,
  ): Promise<{ valid: boolean; certificate: LifecycleCertificate | null }> {
    const found = await this.repository.findBySerial(tenantId, serialNumber.trim());
    if (!found) return { valid: false, certificate: null };
    return { valid: found.status === 'issued', certificate: found };
  }

  async listForStudent(tenantId: string, studentId: string): Promise<LifecycleCertificate[]> {
    return this.repository.listByStudent(tenantId, studentId);
  }

  async revoke(
    tenantId: string,
    id: string,
    reason: string,
  ): Promise<LifecycleCertificate> {
    const existing = await this.get(tenantId, id);
    if (existing.status === 'revoked') return existing;
    const updated = await this.repository.update(tenantId, id, {
      status: 'revoked',
      revokedAt: new Date(),
      revokeReason: reason.trim() || 'revoked',
    });
    if (!updated) throw new NotFoundError(`Certificate '${id}' not found`);
    return updated;
  }
}
